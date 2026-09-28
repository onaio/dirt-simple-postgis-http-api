const { describe, test } = require("node:test");
const assert = require("node:assert/strict");

const { readSubmissions } = require("../lib/reading");

const form = { formId: 7, dataviewId: null, mergedDatasetId: null };
const merged = { formId: null, dataviewId: null, mergedDatasetId: 9 };
const statement = { text: "SELECT 1", values: [] };

// Stands in for a database connection: answers each statement in turn, and
// records what happened to it.
const connection = (answers) => {
    let asked = [];
    let released = 0;
    return {
        client: {
            query: async (text) => {
                asked = [...asked, text];
                const { error = null, rows } = answers[asked.length - 1];
                if (error !== null) {
                    throw error;
                }
                return { rows };
            },
            release: () => {
                released += 1;
            },
        },
        asked: () => asked,
        released: () => released,
    };
};

const read = (database, options = {}) =>
    readSubmissions({
        pg: { connect: async () => database.client },
        dataset: form,
        build: () => statement,
        ...options,
    });

describe("readSubmissions", () => {
    test("returns the rows of the statement", async () => {
        const database = connection([{ rows: [{ id: 1 }] }]);

        assert.deepEqual(await read(database), [{ id: 1 }]);
        assert.deepEqual(database.asked(), ["SELECT 1"]);
    });

    test("looks a dataset up before reading it", async () => {
        const database = connection([
            { rows: [{ xform_id: 3 }] },
            { rows: [{ id: 1 }] },
        ]);

        const rows = await read(database, { dataset: merged });

        assert.deepEqual(rows, [{ id: 1 }]);
        assert.equal(database.asked().length, 2);
        assert.match(database.asked()[0], /logger_mergedxform_xforms/);
    });

    test("reads nothing for a dataset without forms", async () => {
        const database = connection([{ rows: [] }]);

        const rows = await read(database, { dataset: merged });

        assert.deepEqual(rows, []);
        assert.equal(database.asked().length, 1);
    });

    test("gives the connection back when it is done", async () => {
        const database = connection([{ rows: [] }]);

        await read(database);

        assert.equal(database.released(), 1);
    });

    test("gives the connection back when the statement fails", async () => {
        const database = connection([{ error: new Error("boom") }]);

        await assert.rejects(() => read(database));

        assert.equal(database.released(), 1);
    });

    test("reports a failing statement without its cause in the message", async () => {
        const database = connection([{ error: new Error("relation missing") }]);

        await assert.rejects(
            () => read(database),
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
                read(connection([]), {
                    pg: { connect: async () => Promise.reject(refused) },
                }),
            (error) =>
                error.message === "Database connection error." &&
                error.cause === refused,
        );
    });
});
