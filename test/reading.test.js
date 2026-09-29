const { describe, test } = require("node:test");
const assert = require("node:assert/strict");
const { EventEmitter } = require("node:events");
const net = require("node:net");
const { setTimeout: pause } = require("node:timers/promises");

const { readSubmissions, sendCancel } = require("../lib/reading");

const form = { formId: 7, dataviewId: null, mergedDatasetId: null };
const merged = { formId: null, dataviewId: null, mergedDatasetId: 9 };
const statement = { text: "SELECT 1", values: [] };

const CANCELLED = Object.assign(new Error("canceling statement"), {
    code: "57014",
});

const recorder = () => {
    let entries = [];
    return {
        note: (entry) => (entries = [...entries, entry]),
        entries: () => entries,
    };
};

const logger = (events = recorder()) => ({
    info: (message) => events.note(`info: ${message}`),
    warn: (details, message) =>
        events.note(`warn: ${message} ${JSON.stringify(details)}`),
});

const response = ({ destroyed = false } = {}) => ({
    raw: Object.assign(new EventEmitter(), {
        destroyed,
        writableFinished: false,
    }),
});

// Stands in for a database connection: answers each statement in turn after
// the given delay, and records what happened to it.
const connection = (answers, events = recorder()) => {
    let asked = [];
    const client = Object.assign(new EventEmitter(), {
        activeQuery: null,
        connectionParameters: { host: "127.0.0.1", port: 1 },
        query: (submitted) => {
            asked = [...asked, submitted.text];
            const { after = 20, error = null, rows } = answers[asked.length - 1];
            client.activeQuery = submitted;
            setTimeout(() => {
                client.activeQuery = null;
                events.note("statement ended");
                submitted.callback(error, { rows });
            }, after);
        },
        release: (discard) =>
            events.note(discard ? "connection discarded" : "connection kept"),
    });
    return { client, asked: () => asked };
};

const neverCalled = () => {
    throw new Error("no cancel was expected");
};

const read = (database, reply, options = {}) =>
    readSubmissions({
        pg: { connect: async () => database.client },
        request: { log: logger() },
        reply,
        dataset: form,
        build: () => statement,
        cancel: neverCalled,
        ...options,
    });

const leave = async (reply, after = 5) => {
    await pause(after);
    reply.raw.emit("close");
};

describe("readSubmissions", () => {
    test("returns the rows of the statement", async () => {
        const database = connection([{ rows: [{ id: 1 }] }]);

        assert.deepEqual(await read(database, response()), [{ id: 1 }]);
        assert.deepEqual(database.asked(), ["SELECT 1"]);
    });

    test("looks a dataset up before reading it", async () => {
        const database = connection([
            { rows: [{ xform_id: 3 }] },
            { rows: [{ id: 1 }] },
        ]);

        const rows = await read(database, response(), { dataset: merged });

        assert.deepEqual(rows, [{ id: 1 }]);
        assert.equal(database.asked().length, 2);
        assert.match(database.asked()[0], /logger_mergedxform_xforms/);
    });

    test("reads nothing for a dataset without forms", async () => {
        const database = connection([{ rows: [] }]);

        const rows = await read(database, response(), { dataset: merged });

        assert.deepEqual(rows, []);
        assert.equal(database.asked().length, 1);
    });

    test("keeps the connection when it is done", async () => {
        const events = recorder();
        const database = connection([{ rows: [] }], events);

        await read(database, response());

        assert.deepEqual(events.entries(), [
            "statement ended",
            "connection kept",
        ]);
    });

    const failed = (code) => Object.assign(new Error("boom"), { code });

    for (const [label, code] of [
        ["was wrong", "42P01"],
        ["took too long", "57014"],
        ["could not read a value", "22P02"],
    ]) {
        test(`keeps the connection when the statement ${label}`, async () => {
            const events = recorder();
            const database = connection([{ error: failed(code) }], events);

            await assert.rejects(() => read(database, response()));

            assert.deepEqual(events.entries(), [
                "statement ended",
                "connection kept",
            ]);
        });
    }

    for (const [label, error] of [
        ["the database ended the connection", failed("57P01")],
        ["the database went down", failed("57P02")],
        ["the connection failed", failed("08006")],
        ["the database reported a fault of its own", failed("XX000")],
        ["the connection was reset", failed("ECONNRESET")],
        ["nothing says why", new Error("Connection terminated unexpectedly")],
    ]) {
        test(`discards the connection when ${label}`, async () => {
            const events = recorder();
            const database = connection([{ error }], events);

            await assert.rejects(
                () => read(database, response()),
                /Query failed\./,
            );

            assert.deepEqual(events.entries(), [
                "statement ended",
                "connection discarded",
            ]);
        });
    }

    test("reports a failing statement without its cause in the message", async () => {
        const database = connection([{ error: new Error("relation missing") }]);

        await assert.rejects(
            () => read(database, response()),
            (error) =>
                error.message === "Query failed." &&
                error.statusCode === 500 &&
                error.cause.message === "relation missing",
        );
    });

    test("reports a connection that cannot be made", async () => {
        const refused = new Error("ECONNREFUSED");

        await assert.rejects(
            () =>
                read(connection([]), response(), {
                    pg: { connect: async () => Promise.reject(refused) },
                }),
            (error) =>
                error.message === "Database connection error." &&
                error.cause === refused,
        );
    });

    test("takes the end of its own response for nothing unusual", async () => {
        const database = connection([{ rows: [{ id: 1 }] }]);
        const reply = response();

        const reading = read(database, reply);
        await pause(5);
        reply.raw.writableFinished = true;
        reply.raw.emit("close");

        assert.deepEqual(await reading, [{ id: 1 }]);
    });

    test("stops listening to the response once it is done", async () => {
        const reply = response();

        await read(connection([{ rows: [] }]), reply);

        assert.equal(reply.raw.listenerCount("close"), 0);
    });

    test("discards a connection that was lost while it was held", async () => {
        const events = recorder();
        const database = connection([{ rows: [{ id: 1 }] }], events);

        const reading = read(database, response());
        await pause(5);
        database.client.emit("error", new Error("Connection terminated"));

        assert.deepEqual(await reading, [{ id: 1 }]);
        assert.deepEqual(events.entries(), [
            "statement ended",
            "connection discarded",
        ]);
    });

    test("stops listening to the connection once it is done", async () => {
        const database = connection([{ rows: [] }]);

        await read(database, response());

        assert.equal(database.client.listenerCount("error"), 0);
    });
});

describe("readSubmissions for a caller that leaves", () => {
    const confirmed = async () => true;

    test("starts no statement for a caller that has already left", async () => {
        const events = recorder();
        const database = connection([{ rows: [{ id: 1 }] }], events);

        const rows = await read(database, response({ destroyed: true }));

        assert.deepEqual(rows, []);
        assert.deepEqual(database.asked(), []);
        assert.deepEqual(events.entries(), ["connection kept"]);
    });

    test("withholds rows that were ready just as the caller left", async () => {
        const database = connection([{ rows: [{ id: 1 }] }]);
        const reply = response();

        const reading = read(database, reply, { cancel: confirmed });
        await leave(reply);

        assert.deepEqual(await reading, []);
    });

    test("does not read a dataset whose caller left during the lookup", async () => {
        const database = connection([
            { rows: [{ xform_id: 3 }] },
            { rows: [{ id: 1 }] },
        ]);
        const reply = response();

        const reading = read(database, reply, {
            dataset: merged,
            cancel: confirmed,
        });
        await leave(reply);

        assert.deepEqual(await reading, []);
        assert.equal(database.asked().length, 1);
    });

    test("does not report the cancelled statement as a failure", async () => {
        const events = recorder();
        const database = connection([{ error: CANCELLED }]);
        const reply = response();

        const reading = read(database, reply, {
            cancel: confirmed,
            request: { log: logger(events) },
        });
        await leave(reply);

        assert.deepEqual(await reading, []);
        assert.deepEqual(events.entries(), [
            "info: caller left before the answer was ready",
        ]);
    });

    test("notes a statement that failed for another reason", async () => {
        const events = recorder();
        const broken = Object.assign(new Error("disk full"), { code: "53100" });
        const database = connection([{ error: broken }]);
        const reply = response();

        const reading = read(database, reply, {
            cancel: confirmed,
            request: { log: logger(events) },
        });
        await leave(reply);

        assert.deepEqual(await reading, []);
        assert.deepEqual(events.entries(), [
            'warn: statement failed after the caller left {"code":"53100"}',
            "info: caller left before the answer was ready",
        ]);
    });

    test("asks for the running statement to be cancelled", async () => {
        const database = connection([{ rows: [], after: 30 }]);
        const reply = response();
        const cancelled = recorder();
        const cancel = async (client, query) => {
            cancelled.note([client === database.client, query.text]);
            return true;
        };

        const reading = read(database, reply, { cancel });
        await leave(reply);
        await reading;

        assert.deepEqual(cancelled.entries(), [[true, "SELECT 1"]]);
    });

    test("asks again while the statement keeps running", async () => {
        const database = connection([{ rows: [], after: 400 }]);
        const reply = response();
        const cancelled = recorder();
        const cancel = async () => {
            cancelled.note(Date.now());
            return true;
        };

        const reading = read(database, reply, { cancel });
        await leave(reply);
        await reading;

        const [first, second, third, fourth] = cancelled.entries();
        assert.ok(
            cancelled.entries().length >= 4,
            `asked ${cancelled.entries().length} times`,
        );
        assert.ok(second - first >= 45, `second came after ${second - first} ms`);
        assert.ok(third - second >= 95, `third came after ${third - second} ms`);
        assert.ok(fourth - third >= 195, `fourth came after ${fourth - third} ms`);
    });

    test("says so when the statement outlasts every attempt", async () => {
        const events = recorder();
        const database = connection([{ rows: [], after: 3000 }], events);
        const reply = response();
        const cancel = async () => true;

        const reading = read(database, reply, {
            cancel,
            request: { log: logger(events) },
        });
        await leave(reply);
        await reading;

        assert.ok(
            events
                .entries()
                .includes("warn: statement still running after every cancel {}"),
            JSON.stringify(events.entries()),
        );
    });

    test("stops asking once the statement has ended", async () => {
        const database = connection([{ rows: [], after: 30 }]);
        const reply = response();
        const cancelled = recorder();
        const cancel = async () => {
            cancelled.note("cancel");
            return true;
        };

        const reading = read(database, reply, { cancel });
        await leave(reply);
        await reading;
        await pause(200);

        assert.equal(cancelled.entries().length, 1);
    });

    test("holds the connection until the cancel has finished", async () => {
        const events = recorder();
        const database = connection([{ rows: [], after: 20 }], events);
        const reply = response();
        const cancel = async () => {
            events.note("cancel sent");
            await pause(100);
            events.note("cancel finished");
            return true;
        };

        const reading = read(database, reply, { cancel });
        await leave(reply);
        await reading;

        assert.deepEqual(events.entries(), [
            "cancel sent",
            "statement ended",
            "cancel finished",
            "connection kept",
        ]);
    });

    test("discards the connection when a cancel may still arrive", async () => {
        const events = recorder();
        const database = connection([{ rows: [], after: 20 }], events);
        const reply = response();

        const reading = read(database, reply, { cancel: async () => false });
        await leave(reply);
        await reading;

        assert.deepEqual(events.entries(), [
            "statement ended",
            "connection discarded",
        ]);
    });

    test("discards the connection when the cancel could not be sent", async () => {
        const events = recorder();
        const database = connection([{ rows: [], after: 20 }], events);
        const reply = response();
        const cancel = async () => {
            throw new Error("no route to host");
        };

        const reading = read(database, reply, { cancel });
        await leave(reply);

        assert.deepEqual(await reading, []);
        assert.deepEqual(events.entries(), [
            "statement ended",
            "connection discarded",
        ]);
    });
});

describe("sendCancel", () => {
    const CANCEL_REQUEST = 80877102;

    const running = { text: "SELECT pg_sleep(60)" };

    // Closes the server and whatever is still connected to it, so that a
    // failing test cannot leave the process waiting.
    const withServer = async (onConnection, run) => {
        let sockets = [];
        const server = net.createServer((socket) => {
            sockets = [...sockets, socket];
            socket.on("error", () => {});
            onConnection(socket);
        });
        await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
        try {
            return await run(server.address().port);
        } finally {
            sockets.forEach((socket) => socket.destroy());
            await new Promise((resolve) => server.close(resolve));
        }
    };

    const clientOn = (port, activeQuery = running) => ({
        activeQuery,
        processID: 4242,
        secretKey: 987654,
        connectionParameters: { host: "127.0.0.1", port },
    });

    test("sends the backend's id and key and reports delivery", async () => {
        const received = recorder();
        const answer = (socket) =>
            socket.once("data", (packet) => {
                received.note([
                    packet.readInt32BE(0),
                    packet.readInt32BE(4),
                    packet.readInt32BE(8),
                    packet.readInt32BE(12),
                ]);
                socket.end();
            });

        const delivered = await withServer(answer, (port) =>
            sendCancel(clientOn(port), running),
        );

        assert.equal(delivered, true);
        assert.deepEqual(received.entries(), [[16, CANCEL_REQUEST, 4242, 987654]]);
    });

    test("sends nothing for a statement that is no longer running", async () => {
        const connections = recorder();
        const count = () => connections.note("connection");

        const delivered = await withServer(count, (port) =>
            sendCancel(clientOn(port, null), running),
        );

        assert.equal(delivered, true);
        assert.deepEqual(connections.entries(), []);
    });

    test("gives up on a cancel that gets no answer and closes its connection", async () => {
        const sockets = recorder();
        const stayOpen = (socket) => {
            socket.on("close", () => sockets.note("closed by the sender"));
            socket.resume();
        };

        const delivered = await withServer(stayOpen, async (port) => {
            const outcome = await sendCancel(clientOn(port), running, 100);
            await pause(50);
            return outcome;
        });

        assert.equal(delivered, false);
        assert.deepEqual(sockets.entries(), ["closed by the sender"]);
    });

    test("reports a cancel that could not be delivered", async () => {
        const port = await withServer(() => {}, async (listening) => listening);

        assert.equal(await sendCancel(clientOn(port), running), false);
    });

    test("reports a cancel that could not be attempted", async () => {
        assert.equal(await sendCancel(clientOn(70000), running, 100), false);
    });
});
