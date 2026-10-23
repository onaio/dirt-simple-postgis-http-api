const assert = require("node:assert/strict");
const { setTimeout: pause } = require("node:timers/promises");

const database = require("./database");

// A copy of the submissions that holds each statement reading it for a
// while, once, and counts the statement.
const heldView = (name, seconds) => `
    CREATE VIEW ${name} AS
        WITH held AS MATERIALIZED (
            SELECT nextval('statements_started'), pg_sleep(${seconds})
        )
        SELECT l.* FROM logger_instance l CROSS JOIN held;
`;

const runningStatements = async (view = "slow_instance") => {
    const { rows } = await database.run(
        `SELECT count(*)::int AS running
         FROM pg_stat_activity
         WHERE state = 'active'
           AND pid <> pg_backend_pid()
           AND query LIKE $1`,
        [`%${view}%`],
    );
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

module.exports = { heldView, runningStatements, until, expectSoon };
