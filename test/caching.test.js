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

describe("how an answer is said to be kept", () => {
    const keptWith = async (env) =>
        (await cachingOf(`${PROBE}?form_id=7`, { env }))[1];

    test("for the configured time", async () => {
        assert.equal(
            await keptWith({ CACHE_EXPIRESIN: "120" }),
            "private, max-age=120",
        );
    });

    test("by anyone, when so configured", async () => {
        assert.equal(
            await keptWith({ CACHE_PRIVACY: "public" }),
            "public, max-age=3600",
        );
    });

    test("by a shared cache for a time of its own", async () => {
        assert.equal(
            await keptWith({
                CACHE_PRIVACY: "public",
                CACHE_SERVERCACHE: "60",
            }),
            "public, max-age=3600, s-maxage=60",
        );
    });

    test("by nobody, when the lifetime is zero", async () => {
        assert.equal(
            await keptWith({ CACHE_EXPIRESIN: "0" }),
            "private, max-age=0",
        );
    });

    test("by nobody sharing, when the shared lifetime is zero", async () => {
        assert.equal(
            await keptWith({ CACHE_PRIVACY: "public", CACHE_SERVERCACHE: "0" }),
            "public, max-age=3600, s-maxage=0",
        );
    });

    test("as by default when the settings are left empty", async () => {
        assert.equal(
            await keptWith({
                CACHE_PRIVACY: "",
                CACHE_EXPIRESIN: "",
                CACHE_SERVERCACHE: "",
            }),
            KEPT,
        );
    });

    const refused = [
        ["CACHE_EXPIRESIN", ["abc", "-1", "1.5", "1h", "2147483648"]],
        ["CACHE_SERVERCACHE", ["abc", "-1", "1.5", "1h", "2147483648"]],
        ["CACHE_PRIVACY", ["secret", "Private", "no-store"]],
    ];

    for (const [name, values] of refused) {
        for (const value of values) {
            test(`build refuses to start with ${name} set to ${JSON.stringify(value)}`, async () => {
                await assert.rejects(
                    () => withApp({ env: { [name]: value } }, async () => {}),
                    new RegExp(`${name} must be`),
                );
            });
        }
    }
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
