const { describe, test } = require("node:test");
const assert = require("node:assert/strict");

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const { build } = require("../app");
const { PROBE, withApp } = require("./helpers/app");
const { testEnv } = require("./helpers/env");

describe("exposed routes", () => {
    const removed = [
        "/v1/query/logger_instance",
        "/v1/geojson/logger_instance",
        "/v1/geobuf/logger_instance",
        "/v1/bbox/logger_instance",
        "/v1/centroid/logger_instance",
        "/v1/intersect_feature/logger_instance/logger_instance",
        "/v1/intersect_point/logger_instance/36.8,-1.3,4326",
        "/v1/nearest/logger_instance/36.8,-1.3,4326",
        "/v1/list_columns/logger_instance",
        "/v1/list_tables",
        "/v1/transform_point/36.8,-1.3,4326",
    ];

    for (const url of removed) {
        test(`${url} is not served`, async () => {
            await withApp({}, async ({ app }) => {
                const response = await app.inject({ url: `${url}?form_id=7` });

                assert.equal(response.statusCode, 404);
            });
        });
    }

    test("only the tile, bounds and health routes are registered", async () => {
        const app = await build(testEnv());
        try {
            await app.ready();

            const registered = app
                .printRoutes({ commonPrefix: false, method: "GET" })
                .split("\n")
                .map((line) => line.match(/── (\S+) \(GET\)$/))
                .filter(Boolean)
                .map(([, url]) => url)
                .sort();

            assert.deepEqual(registered, [
                "/health-check",
                "/v1/bounds",
                "/v1/mvt/:z/:x/:y",
            ]);
        } finally {
            await app.close();
        }
    });
});

describe("database failures", () => {
    for (const url of ["/v1/mvt/0/0/0?form_id=7", "/v1/bounds?form_id=7"]) {
        test(`an unreachable database makes ${url} a 500 that names nothing internal`, async () => {
            await withApp({}, async ({ app }) => {
                const response = await app.inject({ url });

                assert.equal(response.statusCode, 500);
                assert.deepEqual(response.json(), {
                    error: "Database connection error.",
                });
            });
        });
    }
});

describe("requests that cannot be served", () => {
    test("an impossible tile is a 400 before the database is asked", async () => {
        await withApp({}, async ({ app }) => {
            const response = await app.inject({
                url: "/v1/mvt/0/5/5?form_id=7",
            });

            assert.equal(response.statusCode, 400);
            assert.deepEqual(response.json(), {
                error: "z, x and y must name a tile.",
            });
        });
    });

    test("a tile coordinate that is not a number is a 400", async () => {
        await withApp({}, async ({ app }) => {
            const response = await app.inject({
                url: "/v1/mvt/0/0/abc?form_id=7",
            });

            assert.equal(response.statusCode, 400);
            assert.deepEqual(Object.keys(response.json()), ["error"]);
        });
    });

    test("a field filter longer than the limit is a 400", async () => {
        await withApp({}, async ({ app }) => {
            const response = await app.inject({
                url: `/v1/bounds?form_id=7&field_name=a&field_value=${"v".repeat(4097)}`,
            });

            assert.equal(response.statusCode, 400);
        });
    });
});

describe("database connection", () => {
    const poolOptions = async (env) => {
        const app = await build(testEnv(env));
        try {
            await app.ready();
            return app.pg.pool.options;
        } finally {
            await app.close();
        }
    };

    const sslOptions = async (env) => (await poolOptions(env)).ssl;

    test("gives a statement a minute and the wait for a connection half of one unless configured", async () => {
        const options = await poolOptions({});

        assert.equal(options.statement_timeout, 60000);
        assert.equal(options.connectionTimeoutMillis, 30000);
    });

    for (const name of [
        "POSTGRES_STATEMENT_TIMEOUT",
        "POSTGRES_CONNECTION_TIMEOUT",
        "POSTGRES_POOL_MAX",
    ]) {
        test(`${name} left empty is taken as not configured`, async () => {
            assert.deepEqual(
                await poolOptions({ [name]: "" }),
                await poolOptions({}),
            );
        });
    }

    test("a statement timeout of 0 lifts the limit", async () => {
        const options = await poolOptions({
            POSTGRES_STATEMENT_TIMEOUT: "0",
        });

        assert.equal(options.statement_timeout, undefined);
        assert.equal(options.connectionTimeoutMillis, 30000);
    });

    test("a connection timeout of 0 lifts the limit", async () => {
        const options = await poolOptions({
            POSTGRES_CONNECTION_TIMEOUT: "0",
        });

        assert.equal(options.connectionTimeoutMillis, undefined);
        assert.equal(options.statement_timeout, 60000);
    });

    test("takes the longest time a timer can hold", async () => {
        const options = await poolOptions({
            POSTGRES_STATEMENT_TIMEOUT: "2147483647",
            POSTGRES_CONNECTION_TIMEOUT: "2147483647",
        });

        assert.equal(options.statement_timeout, 2147483647);
        assert.equal(options.connectionTimeoutMillis, 2147483647);
    });

    test("keeps the default number of connections unless configured", async () => {
        const options = await poolOptions({});

        assert.equal(options.max, 10);
    });

    test("holds as many connections as configured", async () => {
        const options = await poolOptions({ POSTGRES_POOL_MAX: "20" });

        assert.equal(options.max, 20);
    });

    test("limits how long a statement may run", async () => {
        const options = await poolOptions({
            POSTGRES_STATEMENT_TIMEOUT: "30000",
        });

        assert.equal(options.statement_timeout, 30000);
    });

    test("limits how long a request waits for a connection", async () => {
        const options = await poolOptions({
            POSTGRES_CONNECTION_TIMEOUT: "5000",
        });

        assert.equal(options.connectionTimeoutMillis, 5000);
    });

    const refused = [
        ["POSTGRES_STATEMENT_TIMEOUT", ["abc", "-1", "1.5", "30s", "2147483648", "3000000000"]],
        ["POSTGRES_CONNECTION_TIMEOUT", ["abc", "-1", "1.5", "30s", "2147483648", "3000000000"]],
        ["POSTGRES_POOL_MAX", ["abc", "0", "-1", "1.5", "30s", "2147483648"]],
    ];

    for (const [name, values] of refused) {
        for (const value of values) {
            test(`build refuses to start with ${name} set to ${JSON.stringify(value)}`, async () => {
                await assert.rejects(
                    () => build(testEnv({ [name]: value })),
                    new RegExp(`${name} must be`),
                );
            });
        }
    }

    test("connects without a certificate authority by default", async () => {
        assert.equal(await sslOptions({}), undefined);
    });

    test("trusts the certificate authority given inline", async () => {
        const ssl = await sslOptions({ SSL_ROOT_CERT: "inline-certificate" });

        assert.deepEqual(ssl, { ca: "inline-certificate" });
    });

    test("trusts the certificate authority given as a file", async () => {
        const directory = fs.mkdtempSync(path.join(os.tmpdir(), "dirt-ca-"));
        const file = path.join(directory, "ca.crt");
        fs.writeFileSync(file, "file-certificate");
        try {
            const ssl = await sslOptions({ SSL_ROOT_CERT_PATH: file });

            assert.deepEqual(ssl, { ca: "file-certificate" });
        } finally {
            fs.rmSync(directory, { recursive: true, force: true });
        }
    });

    const overriding = [
        "sslmode=require",
        "sslmode=verify-full",
        "sslmode=disable",
        "ssl=true",
        "sslrootcert=/etc/ca.crt",
        "sslcert=/etc/client.crt",
        "sslkey=/etc/client.key",
        "application_name=tiles&sslmode=require",
    ];

    for (const parameter of overriding) {
        test(`build refuses a certificate authority beside ${parameter} in the connection string`, async () => {
            const env = testEnv({
                POSTGRES_CONNECTION: `postgres://u:p@127.0.0.1:1/none?${parameter}`,
                SSL_ROOT_CERT: "inline-certificate",
            });

            await assert.rejects(
                () => build(env),
                /SSL_ROOT_CERT.*POSTGRES_CONNECTION/,
            );
        });
    }

    test("build does not repeat the connection string when it refuses it", async () => {
        const env = testEnv({
            POSTGRES_CONNECTION:
                "postgres://u:hunter2@127.0.0.1:1/none?sslmode=require",
            SSL_ROOT_CERT: "inline-certificate",
        });

        await assert.rejects(
            () => build(env),
            (error) => !/hunter2|127\.0\.0\.1/.test(error.message),
        );
    });

    test("takes a connection string with other parameters beside a certificate authority", async () => {
        const ssl = await sslOptions({
            POSTGRES_CONNECTION:
                "postgres://u:p@127.0.0.1:1/none?application_name=sslmode",
            SSL_ROOT_CERT: "inline-certificate",
        });

        assert.deepEqual(ssl, { ca: "inline-certificate" });
    });

    test("takes sslmode in the connection string when no certificate authority is given", async () => {
        const app = await build(
            testEnv({
                POSTGRES_CONNECTION:
                    "postgres://u:p@127.0.0.1:1/none?sslmode=require",
            }),
        );
        await app.close();
    });

    test("prefers the inline certificate authority over the file", async () => {
        const ssl = await sslOptions({
            SSL_ROOT_CERT: "inline-certificate",
            SSL_ROOT_CERT_PATH: "/nonexistent/ca.crt",
        });

        assert.deepEqual(ssl, { ca: "inline-certificate" });
    });
});

describe("rate limiting", () => {
    const statuses = async (app, count) => {
        const responses = [];
        for (let sent = 0; sent < count; sent += 1) {
            responses.push(await app.inject({ url: `${PROBE}?form_id=7` }));
        }
        return responses.map(({ statusCode }) => statusCode);
    };

    test("is off unless a limit is configured", async () => {
        await withApp({}, async ({ app }) => {
            assert.deepEqual(await statuses(app, 4), [200, 200, 200, 200]);
        });
    });

    test("refuses requests beyond the configured limit", async () => {
        await withApp({ env: { RATE_MAX: "2" } }, async ({ app }) => {
            assert.deepEqual(await statuses(app, 4), [200, 200, 429, 429]);
        });
    });

    test("refuses them before asking whether the caller may read the dataset", async () => {
        await withApp({ env: { RATE_MAX: "2" } }, async ({ app, onadata }) => {
            await statuses(app, 4);

            assert.equal(onadata.requests().length, 2);
        });
    });

    test("counts requests for routes that do not exist", async () => {
        await withApp({ env: { RATE_MAX: "2" } }, async ({ app }) => {
            const responses = [];
            for (let sent = 0; sent < 3; sent += 1) {
                responses.push(await app.inject({ url: "/v1/nope" }));
            }

            assert.deepEqual(
                responses.map(({ statusCode }) => statusCode),
                [404, 404, 429],
            );
        });
    });

    const statusFor = (app, client) =>
        app
            .inject({
                url: `${PROBE}?form_id=7`,
                headers: { "x-forwarded-for": client },
            })
            .then(({ statusCode }) => statusCode);

    for (const [label, proxy] of [
        ["is not configured", {}],
        ["is set to false", { TRUST_PROXY: "false" }],
        ["is left empty", { TRUST_PROXY: "" }],
    ]) {
        test(`counts every caller together when the proxy ${label}`, async () => {
            const env = { RATE_MAX: "1", ...proxy };

            await withApp({ env }, async ({ app }) => {
                assert.equal(await statusFor(app, "203.0.113.1"), 200);
                assert.equal(await statusFor(app, "203.0.113.2"), 429);
            });
        });
    }

    test("counts each caller separately behind one trusted hop", async () => {
        const env = { RATE_MAX: "1", TRUST_PROXY: "1" };

        await withApp({ env }, async ({ app }) => {
            assert.equal(await statusFor(app, "203.0.113.1"), 200);
            assert.equal(await statusFor(app, "203.0.113.2"), 200);
        });
    });

    test("counts each caller separately behind a trusted proxy address", async () => {
        const env = { RATE_MAX: "1", TRUST_PROXY: "127.0.0.1" };

        await withApp({ env }, async ({ app }) => {
            assert.equal(await statusFor(app, "203.0.113.1"), 200);
            assert.equal(await statusFor(app, "203.0.113.2"), 200);
        });
    });

    test("ignores the forwarded address from a proxy that is not the trusted one", async () => {
        const env = { RATE_MAX: "1", TRUST_PROXY: "10.9.9.9" };

        await withApp({ env }, async ({ app }) => {
            assert.equal(await statusFor(app, "203.0.113.1"), 200);
            assert.equal(await statusFor(app, "203.0.113.2"), 429);
        });
    });

    test("counts each caller separately when the proxy is trusted", async () => {
        const env = { RATE_MAX: "1", TRUST_PROXY: "true" };

        await withApp({ env }, async ({ app }) => {
            assert.equal(await statusFor(app, "203.0.113.1"), 200);
            assert.equal(await statusFor(app, "203.0.113.2"), 200);
            assert.equal(await statusFor(app, "203.0.113.1"), 429);
        });
    });

    test("never refuses the health check", async () => {
        await withApp({ env: { RATE_MAX: "1" } }, async ({ app }) => {
            const responses = [];
            for (let sent = 0; sent < 3; sent += 1) {
                responses.push(await app.inject({ url: "/health-check" }));
            }

            assert.deepEqual(
                responses.map(({ statusCode }) => statusCode),
                [200, 200, 200],
            );
        });
    });

    test("is off when the limit is left empty", async () => {
        const app = await build(testEnv({ RATE_MAX: "" }));
        try {
            await app.ready();
            assert.equal(app.hasDecorator("rateLimit"), false);
        } finally {
            await app.close();
        }
    });

    for (const value of ["abc", "0", "-1", "1.5", "10 requests"]) {
        test(`build refuses to start with a limit of ${JSON.stringify(value)}`, async () => {
            await assert.rejects(
                () => build(testEnv({ RATE_MAX: value })),
                /RATE_MAX must be a positive integer/,
            );
        });
    }
});

describe("cross-origin configuration", () => {
    const allowedOrigin = (app, origin) =>
        app
            .inject({ url: "/health-check", headers: { origin } })
            .then(
                (response) => response.headers["access-control-allow-origin"],
            );

    test("a listed origin is allowed", async () => {
        const env = { CORS_ORIGINS: "https://a.example.test,https://b.example.test" };

        await withApp({ env }, async ({ app }) => {
            assert.equal(
                await allowedOrigin(app, "https://b.example.test"),
                "https://b.example.test",
            );
        });
    });

    test("an unlisted origin is not allowed", async () => {
        const env = { CORS_ORIGINS: "https://a.example.test" };

        await withApp({ env }, async ({ app }) => {
            assert.equal(
                await allowedOrigin(app, "https://evil.example.test"),
                undefined,
            );
        });
    });

    test("a wildcard allows any origin", async () => {
        const env = { CORS_ORIGINS: "*" };

        await withApp({ env }, async ({ app }) => {
            assert.equal(await allowedOrigin(app, "https://any.example.test"), "*");
        });
    });

    test("no origin is allowed when none is configured", async () => {
        const env = { CORS_ORIGINS: undefined };

        await withApp({ env }, async ({ app }) => {
            const response = await app.inject({
                url: "/health-check",
                headers: { origin: "https://a.example.test" },
            });

            assert.equal(response.statusCode, 200);
            assert.equal(
                response.headers["access-control-allow-origin"],
                undefined,
            );
        });
    });
});
