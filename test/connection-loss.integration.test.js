const { describe, test, before } = require("node:test");
const assert = require("node:assert/strict");

const { withApp } = require("./helpers/app");
const database = require("./helpers/database");
const { heldView, runningStatements, expectSoon } = require("./helpers/held");

const { OWN_FORM } = database;

const skip = database.connectionString
    ? false
    : "TEST_POSTGRES_CONNECTION is not set";

const env = { POSTGRES_CONNECTION: database.connectionString };
const HELD_SECONDS = 0.5;
const ATTEMPTS = 5;
const BOUNDS = `/v1/bounds?form_id=${OWN_FORM}`;

const endConnections = async (state) => {
    const { rows } = await database.run(
        `SELECT count(pg_terminate_backend(pid))::int AS ended
         FROM pg_stat_activity
         WHERE datname = current_database()
           AND pid <> pg_backend_pid()
           AND state = $1`,
        [state],
    );
    return rows[0].ended;
};

describe("a database connection that is lost", { skip }, () => {
    before(async () => {
        await database.resetDatabase();
        await database.run(`
            CREATE SEQUENCE statements_started;
            ${heldView("held_instance", HELD_SECONDS)}
        `);
    });

    test("while it waits to be used, is replaced by the next request", async () => {
        await withApp({ env }, async ({ app }) => {
            const before = await app.inject({ url: BOUNDS });
            assert.equal(before.statusCode, 200);
            assert.equal(app.pg.pool.idleCount, 1);

            assert.equal(await endConnections("idle"), 1);
            await expectSoon(
                () => app.pg.pool.totalCount === 0,
                "the pool kept the lost connection",
            );
            const after = await app.inject({ url: BOUNDS });

            assert.equal(after.statusCode, 200);
            assert.deepEqual(after.json(), before.json());
        });
    });

    // The next request follows at once, and several times over, because
    // the connection is only sometimes known to be lost by then.
    test("while a statement runs, fails that request and no other", async () => {
        const held = { ...env, TABLE_NAME: "held_instance" };

        await withApp({ env: held }, async ({ app }) => {
            for (let attempt = 1; attempt <= ATTEMPTS; attempt += 1) {
                const interrupted = app.inject({ url: BOUNDS });
                await expectSoon(
                    async () =>
                        (await runningStatements("held_instance")) === 1,
                    "the statement never started",
                );

                assert.equal(await endConnections("active"), 1);
                const response = await interrupted;
                const after = await app.inject({ url: BOUNDS });

                assert.equal(response.statusCode, 500, `attempt ${attempt}`);
                assert.deepEqual(response.json(), { error: "Query failed." });
                assert.equal(after.statusCode, 200, `attempt ${attempt}`);
            }
        });
    });
});
