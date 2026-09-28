const { describe, test, before } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const http = require("node:http");
const os = require("node:os");
const path = require("node:path");
const { setTimeout: pause } = require("node:timers/promises");

const { withApp } = require("./helpers/app");
const database = require("./helpers/database");

const { OWN_FORM } = database;

const skip = database.connectionString
    ? false
    : "TEST_POSTGRES_CONNECTION is not set";

const SLOW_SECONDS = 6;
const BRIEF_SECONDS = 0.3;
// Long enough for a second caller to arrive, queue and leave while the
// first still holds the only connection.
const QUEUE_SECONDS = 1.5;
const PROMPT_MS = 2000;
const ERROR_LEVEL = 50;

const env = {
    POSTGRES_CONNECTION: database.connectionString,
    POSTGRES_POOL_MAX: "1",
    TABLE_NAME: "slow_instance",
};

// A copy of the submissions that holds each statement reading it for a
// while, once, and counts the statement.
const heldView = (name, seconds) => `
    CREATE VIEW ${name} AS
        WITH held AS MATERIALIZED (
            SELECT nextval('statements_started'), pg_sleep(${seconds})
        )
        SELECT l.* FROM logger_instance l CROSS JOIN held;
`;

const runningStatements = async () => {
    const { rows } = await database.run(`
        SELECT count(*)::int AS running
        FROM pg_stat_activity
        WHERE state = 'active'
          AND pid <> pg_backend_pid()
          AND query LIKE '%slow_instance%'
    `);
    return rows[0].running;
};

const until = async (condition, timeout = 5000) => {
    const deadline = Date.now() + timeout;
    while (Date.now() < deadline) {
        if (await condition()) {
            return true;
        }
        await pause(50);
    }
    return false;
};

const expectSoon = async (condition, otherwise) =>
    assert.equal(await until(condition), true, otherwise);

const listening = (settings, run) =>
    withApp({ env: { ...env, ...settings } }, async ({ app }) => {
        const address = await app.listen({ port: 0, host: "127.0.0.1" });
        return run({ app, address });
    });

const startRequest = (address, url) => {
    const request = http.get(`${address}${url}`);
    request.on("error", () => {});
    return request;
};

const fetchFrom = (address, url) =>
    new Promise((resolve, reject) => {
        http.get(`${address}${url}`, (response) => {
            const chunks = [];
            response.on("data", (chunk) => chunks.push(chunk));
            response.on("end", () =>
                resolve({
                    statusCode: response.statusCode,
                    body: Buffer.concat(chunks),
                }),
            );
        }).on("error", reject);
    });

const leaveWhileWaiting = async (address, url) => {
    const request = startRequest(address, url);
    assert.equal(
        await until(async () => (await runningStatements()) === 1),
        true,
        "the statement never started",
    );
    request.destroy();
};

const logged = (file) =>
    fs
        .readFileSync(file, "utf8")
        .split("\n")
        .filter(Boolean)
        .map((line) => JSON.parse(line));

describe("a caller that leaves before the answer is ready", { skip }, () => {
    before(async () => {
        await database.resetDatabase();
        await database.run(`
            CREATE SEQUENCE statements_started;
            ${heldView("slow_instance", SLOW_SECONDS)}
            ${heldView("counted_instance", QUEUE_SECONDS)}
        `);
    });

    for (const url of [
        `/v1/mvt/0/0/0?form_id=${OWN_FORM}`,
        `/v1/bounds?form_id=${OWN_FORM}`,
    ]) {
        test(`has the statement for ${url} stopped`, async () => {
            await listening({}, async ({ address }) => {
                await leaveWhileWaiting(address, url);

                const stopped = await until(
                    async () => (await runningStatements()) === 0,
                    PROMPT_MS,
                );

                assert.equal(stopped, true, "the statement kept running");
            });
        });
    }

    test("has the statement stopped however early it leaves", async () => {
        await listening({}, async ({ address }) => {
            for (let attempt = 0; attempt < 8; attempt += 1) {
                await leaveWhileWaiting(
                    address,
                    `/v1/bounds?form_id=${OWN_FORM}`,
                );

                const stopped = await until(
                    async () => (await runningStatements()) === 0,
                    PROMPT_MS,
                );

                assert.equal(stopped, true, `attempt ${attempt} kept running`);
            }
        });
    });

    test("starts no statement for a caller that left while waiting its turn", async () => {
        const settings = { TABLE_NAME: "counted_instance" };
        const url = `/v1/bounds?form_id=${OWN_FORM}`;
        await database.run("SELECT setval('statements_started', 1, false)");

        await listening(settings, async ({ app, address }) => {
            const first = fetchFrom(address, url);
            await expectSoon(() => app.pg.pool.totalCount === 1, "first caller never connected");
            const second = startRequest(address, url);
            await expectSoon(() => app.pg.pool.waitingCount === 1, "second caller never queued");
            second.destroy();

            assert.equal((await first).statusCode, 200);
            await expectSoon(() => app.pg.pool.idleCount === 1, "connection never came back");
        });

        const { rows } = await database.run(
            "SELECT last_value::int AS started FROM statements_started",
        );
        assert.deepEqual(rows, [{ started: 1 }]);
    });

    test("counts a statement for each caller that stays", async () => {
        const settings = { TABLE_NAME: "counted_instance" };
        const url = `/v1/bounds?form_id=${OWN_FORM}`;
        await database.run("SELECT setval('statements_started', 1, false)");

        await listening(settings, async ({ address }) => {
            const answers = await Promise.all([
                fetchFrom(address, url),
                fetchFrom(address, url),
            ]);

            assert.deepEqual(
                answers.map(({ statusCode }) => statusCode),
                [200, 200],
            );
        });

        const { rows } = await database.run(
            "SELECT last_value::int AS started FROM statements_started",
        );
        assert.deepEqual(rows, [{ started: 2 }]);
    });

    test("leaves the connection fit for the next caller", async () => {
        await listening({}, async ({ app, address }) => {
            await leaveWhileWaiting(address, `/v1/mvt/0/0/0?form_id=${OWN_FORM}`);
            await expectSoon(
                async () => (await runningStatements()) === 0,
                "the statement kept running",
            );

            const { rows } = await app.pg.query("SELECT 1 AS usable");

            assert.deepEqual(rows, [{ usable: 1 }]);
            assert.equal(app.pg.pool.totalCount, 1);
        });
    });

    test("is noted in the log without an error", async () => {
        const directory = fs.mkdtempSync(path.join(os.tmpdir(), "dirt-log-"));
        const file = path.join(directory, "server.log");
        const logging = { SERVER_LOGGER: "info", SERVER_LOGGER_PATH: file };
        try {
            await listening(logging, async ({ address }) => {
                await leaveWhileWaiting(
                    address,
                    `/v1/mvt/0/0/0?form_id=${OWN_FORM}`,
                );
                await expectSoon(
                    async () => (await runningStatements()) === 0,
                    "the statement kept running",
                );
                await expectSoon(
                    () => logged(file).some(({ msg }) => /caller left/.test(msg)),
                    "the departure was never logged",
                );
            });

            const entries = logged(file);
            assert.deepEqual(
                entries.filter(({ level }) => level >= ERROR_LEVEL),
                [],
            );
            assert.equal(
                entries.filter(({ msg }) => /caller left/.test(msg)).length,
                1,
            );
        } finally {
            fs.rmSync(directory, { recursive: true, force: true });
        }
    });
});

describe("a caller that waits for a slow answer", { skip }, () => {
    before(async () => {
        await database.resetDatabase();
        await database.run(`
            CREATE SEQUENCE statements_started;
            ${heldView("brief_instance", BRIEF_SECONDS)}
        `);
    });

    test("gets its tile", async () => {
        const settings = { TABLE_NAME: "brief_instance" };

        await listening(settings, async ({ address }) => {
            const response = await fetchFrom(
                address,
                `/v1/mvt/0/0/0?form_id=${OWN_FORM}`,
            );

            assert.equal(response.statusCode, 200);
            assert.ok(response.body.length > 0);
        });
    });

    test("gets its bounds", async () => {
        const settings = { TABLE_NAME: "brief_instance" };

        await listening(settings, async ({ address }) => {
            const response = await fetchFrom(
                address,
                `/v1/bounds?form_id=${OWN_FORM}`,
            );

            assert.equal(response.statusCode, 200);
            assert.deepEqual(Object.keys(JSON.parse(response.body)), [
                "xmin",
                "ymin",
                "xmax",
                "ymax",
            ]);
        });
    });
});
