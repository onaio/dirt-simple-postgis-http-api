const { describe, test } = require("node:test");
const assert = require("node:assert/strict");

const { PROBE, withApp } = require("./helpers/app");

const KEPT = "private, max-age=3600";
const NOT_KEPT = "no-store";

const cachingOf = async (url, options = {}) =>
    withApp(options, async ({ app }) => {
        const response = await app.inject({ url });
        return [response.statusCode, response.headers["cache-control"]];
    });

describe("how long an answer may be kept", () => {
    test("an answer that was served may be kept", async () => {
        assert.deepEqual(await cachingOf(`${PROBE}?form_id=7`), [200, KEPT]);
    });

    test("the health check may be kept", async () => {
        assert.deepEqual(await cachingOf("/health-check"), [200, KEPT]);
    });

    const failures = [
        ["a request without a dataset", `${PROBE}`, {}, 400],
        ["a tile request the route refuses", "/v1/mvt/0/0/0?form_id=7&columns=xml", {}, 400],
        ["a route that does not exist", "/v1/nothing?form_id=7", {}, 404],
        [
            "a refused caller",
            `${PROBE}?form_id=7`,
            { respond: () => ({ status: 403 }) },
            403,
        ],
        [
            "a failing permission service",
            `${PROBE}?form_id=7`,
            { respond: () => ({ status: 503 }) },
            503,
        ],
        [
            "a permission service that cannot be reached",
            `${PROBE}?form_id=7`,
            { env: { ONADATA_URL: "http://127.0.0.1:1" } },
            500,
        ],
        [
            "a database that cannot be reached",
            "/v1/bounds?form_id=7",
            { env: { POSTGRES_CONNECTION: "postgres://u:p@127.0.0.1:1/none" } },
            500,
        ],
    ];

    for (const [label, url, options, status] of failures) {
        test(`${label} is not to be kept`, async () => {
            assert.deepEqual(await cachingOf(url, options), [status, NOT_KEPT]);
        });
    }
});
