const { setTimeout: pause } = require("node:timers/promises");

const { Client, Query } = require("pg");

const { ServiceError } = require("./errors");
const { datasetLookup, readDataset } = require("./submissions");

const CANCEL_WAIT_MS = 2000;

// PostgreSQL drops a cancel that reaches it before the statement has begun
// to execute, so one is sent again until the statement has ended.
const CANCEL_AGAIN_AFTER_MS = [50, 100, 200, 400, 800];

const QUERY_CANCELED = "57014";

// What PostgreSQL answers with when a statement has failed and the
// connection has not: five characters, outside the classes it keeps for a
// connection that failed, was ended, or met a fault of its own.
const STATEMENT_FAILED = /^(?!08|57P|58|XX)[0-9A-Z]{5}$/;

class CallerGoneError extends Error {}

const noop = () => {};

const deliver = (client, query, waitMs, resolve) => {
    const canceller = new Client(client.connectionParameters);
    const timer = setTimeout(() => {
        canceller.connection.stream.destroy();
        resolve(false);
    }, waitMs);
    const finish = (delivered) => () => {
        clearTimeout(timer);
        resolve(delivered);
    };
    canceller.connection.on("end", finish(true));
    canceller.connection.on("error", finish(false));
    canceller.cancel(client, query);
};

// Sent the way psql sends Ctrl-C: over a connection of its own and in the
// clear, so it needs no place in the pool. Resolves to whether the cancel is
// known to have been dealt with; one that is not may still arrive later.
const sendCancel = (client, query, waitMs = CANCEL_WAIT_MS) =>
    new Promise((resolve) => {
        if (client.activeQuery !== query) {
            resolve(true);
            return;
        }
        try {
            deliver(client, query, waitMs, resolve);
        } catch (error) {
            resolve(false);
        }
    });

const submit = (client, { text, values }) => {
    const running = {};
    const ended = new Promise((resolve, reject) => {
        running.query = new Query(text, values, (error, result) =>
            error ? reject(error) : resolve(result.rows),
        );
        client.query(running.query);
    });
    return { query: running.query, ended };
};

// The statement now running, so that a cancel knows what to aim at.
const trackRunning = () => {
    let current = null;

    return {
        of: () => current,
        while: async (query, ended) => {
            current = { query, settled: ended.then(noop, noop) };
            try {
                return await ended;
            } finally {
                current = null;
            }
        },
    };
};

// Resolves to whether every cancel it sent is known to have been dealt with.
const cancelUntilEnded = (client, cancel, log, running) => async () => {
    let delivered = true;
    for (const wait of CANCEL_AGAIN_AFTER_MS) {
        const statement = running.of();
        if (statement === null) {
            return delivered;
        }
        delivered = (await cancel(client, statement.query)) && delivered;
        await Promise.race([
            statement.settled,
            pause(wait, undefined, { ref: false }),
        ]);
    }
    if (running.of() !== null) {
        log.warn({}, "statement still running after every cancel");
    }
    return delivered;
};

// Whether the connection can be handed to another request: a cancel that may
// still arrive would land on whichever statement it then runs, and a
// connection lost with nobody listening ends the process.
const trackFitness = (client) => {
    let fit = true;
    const unless = (sound) => {
        fit = sound && fit;
    };
    const onLost = () => unless(false);
    client.on("error", onLost);

    return {
        unless,
        settle: () => {
            client.off("error", onLost);
            return fit;
        },
    };
};

const watchForDisconnect = (reply, client, cancel, log) => {
    const running = trackRunning();
    const fitness = trackFitness(client);
    const stopCurrent = cancelUntilEnded(client, cancel, log, running);
    let gone = reply.raw.destroyed === true;
    let cancelling = Promise.resolve();

    const onClose = () => {
        if (reply.raw.writableFinished) {
            return;
        }
        gone = true;
        cancelling = stopCurrent().then(fitness.unless, () =>
            fitness.unless(false),
        );
    };
    reply.raw.once("close", onClose);

    const run = async (statement) => {
        if (gone) {
            throw new CallerGoneError();
        }
        const { query, ended } = submit(client, statement);
        try {
            return await running.while(query, ended);
        } catch (error) {
            fitness.unless(STATEMENT_FAILED.test(error.code));
            throw error;
        }
    };

    return {
        run,
        isGone: () => gone,
        // Waits for a cancel that is on its way before letting the
        // connection go.
        stop: async () => {
            reply.raw.off("close", onClose);
            await cancelling;
            return fitness.settle();
        },
    };
};

const connect = async (pg) => {
    try {
        return await pg.connect();
    } catch (error) {
        throw new ServiceError("Database connection error.", error);
    }
};

const readRows = async (run, dataset, build) => {
    const lookup = datasetLookup(dataset);
    const found = lookup === null ? [] : await run(lookup);
    const resolved = readDataset(dataset, found);

    return resolved.xformIds.length === 0 ? [] : run(build(resolved));
};

const isOwnDoing = (error) =>
    error instanceof CallerGoneError || error.code === QUERY_CANCELED;

const afterDeparture = (log, error) => {
    if (!isOwnDoing(error)) {
        log.warn({ code: error.code }, "statement failed after the caller left");
    }
    return [];
};

const giveBack = async (client, watch) => {
    let reusable = false;
    try {
        reusable = await watch.stop();
    } finally {
        client.release(
            reusable ? undefined : new Error("A cancel may still arrive."),
        );
    }
};

// Resolves to the rows, or to none when the caller left before they were
// ready: there is nobody to answer, and nothing worth sending after them.
const readSubmissions = async ({
    pg,
    request,
    reply,
    dataset,
    build,
    cancel = sendCancel,
}) => {
    const client = await connect(pg);
    const watch = watchForDisconnect(reply, client, cancel, request.log);
    try {
        const rows = await readRows(watch.run, dataset, build);
        return watch.isGone() ? [] : rows;
    } catch (error) {
        if (watch.isGone()) {
            return afterDeparture(request.log, error);
        }
        throw new ServiceError("Query failed.", error);
    } finally {
        await giveBack(client, watch);
        if (watch.isGone()) {
            request.log.info("caller left before the answer was ready");
        }
    }
};

module.exports = { readSubmissions, sendCancel };
