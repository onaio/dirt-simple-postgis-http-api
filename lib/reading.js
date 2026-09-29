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

const watchForDisconnect = (reply, client, cancel) => {
    let gone = reply.raw.destroyed === true;
    let current = null;
    let cancelling = Promise.resolve();
    let reusable = true;

    const stopCurrent = async () => {
        for (const wait of CANCEL_AGAIN_AFTER_MS) {
            const running = current;
            if (running === null) {
                return;
            }
            reusable = (await cancel(client, running.query)) && reusable;
            await Promise.race([
                running.settled,
                pause(wait, undefined, { ref: false }),
            ]);
        }
    };

    const onClose = () => {
        if (reply.raw.writableFinished) {
            return;
        }
        gone = true;
        cancelling = stopCurrent().catch(() => {
            reusable = false;
        });
    };
    reply.raw.once("close", onClose);

    // The pool stops listening to a connection it has handed out, and a
    // connection lost with nobody listening ends the process.
    const onLost = () => {
        reusable = false;
    };
    client.on("error", onLost);

    const run = async (statement) => {
        if (gone) {
            throw new CallerGoneError();
        }
        const { query, ended } = submit(client, statement);
        current = { query, settled: ended.then(noop, noop) };
        try {
            return await ended;
        } catch (error) {
            reusable = STATEMENT_FAILED.test(error.code) && reusable;
            throw error;
        } finally {
            current = null;
        }
    };

    return {
        run,
        isGone: () => gone,
        // Waits for a cancel on its way, and resolves to whether the
        // connection can be handed to another request: a cancel that may
        // still arrive would land on whichever statement it then runs.
        stop: async () => {
            reply.raw.off("close", onClose);
            await cancelling;
            client.off("error", onLost);
            return reusable;
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
    const watch = watchForDisconnect(reply, client, cancel);
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
