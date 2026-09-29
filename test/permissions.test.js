const { describe, test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const { PROBE, withApp, query } = require("./helpers/app");

const outboundUrls = (onadata) => onadata.requests().map(({ url }) => url);

describe("permission check: allowed requests", () => {
    const datasets = [
        ["form_id", "/api/v1/forms/7.json"],
        ["dataview_id", "/api/v1/dataviews/7.json"],
        ["merged_dataset_id", "/api/v1/merged-datasets/7.json"],
    ];

    for (const [parameter, endpoint] of datasets) {
        test(`${parameter} is checked against ${endpoint}`, async () => {
            await withApp({}, async ({ app, onadata }) => {
                const response = await app.inject({
                    url: `${PROBE}?${parameter}=7`,
                });

                assert.equal(response.statusCode, 200);
                assert.equal(response.body, "reached");
                assert.deepEqual(outboundUrls(onadata), [endpoint]);
            });
        });
    }

    test("forwards the temp token as a TempToken authorization header", async () => {
        await withApp({}, async ({ app, onadata }) => {
            const response = await app.inject({
                url: `${PROBE}?form_id=7&temp_token=abc123DEF`,
            });

            assert.equal(response.statusCode, 200);
            assert.equal(
                onadata.requests()[0].authorization,
                "TempToken abc123DEF",
            );
        });
    });

    test("sends no authorization header without a temp token", async () => {
        await withApp({}, async ({ app, onadata }) => {
            const response = await app.inject({ url: `${PROBE}?form_id=7` });

            assert.equal(response.statusCode, 200);
            assert.equal(onadata.requests().length, 1);
            assert.equal(onadata.requests()[0].authorization, undefined);
        });
    });

    test("treats an empty temp token as absent", async () => {
        await withApp({}, async ({ app, onadata }) => {
            const response = await app.inject({
                url: `${PROBE}?form_id=7&temp_token=`,
            });

            assert.equal(response.statusCode, 200);
            assert.equal(onadata.requests()[0].authorization, undefined);
        });
    });
});

describe("permission check: denied requests", () => {
    const denials = [
        [401, "Permission denied."],
        [403, "Permission denied."],
        [404, "Permission denied."],
        [500, "Permission check failed."],
        [503, "Permission check failed."],
    ];

    for (const [status, error] of denials) {
        test(`an upstream ${status} stops the request with ${status}`, async () => {
            const respond = () => ({
                status,
                body: { detail: "upstream-detail" },
            });

            await withApp({ respond }, async ({ app, onadata }) => {
                const response = await app.inject({
                    url: `${PROBE}?form_id=7`,
                });

                assert.equal(onadata.requests().length, 1);
                assert.equal(response.statusCode, status);
                assert.deepEqual(response.json(), { error });
            });
        });
    }

    for (const status of [301, 302, 303, 307, 308]) {
        test(`an upstream ${status} stops the request and is not followed`, async () => {
            const respond = ({ url }) =>
                url === "/signed-in"
                    ? { status: 200 }
                    : { status, headers: { Location: "/signed-in" } };

            await withApp({ respond }, async ({ app, onadata }) => {
                const response = await app.inject({
                    url: `${PROBE}?form_id=7&temp_token=abc`,
                });

                assert.equal(response.statusCode, 500);
                assert.deepEqual(response.json(), {
                    error: "Permission check failed.",
                });
                assert.deepEqual(outboundUrls(onadata), [
                    "/api/v1/forms/7.json",
                ]);
            });
        });
    }

    test("an upstream success other than 200 stops the request", async () => {
        const respond = () => ({ status: 202 });

        await withApp({ respond }, async ({ app }) => {
            const response = await app.inject({ url: `${PROBE}?form_id=7` });

            assert.equal(response.statusCode, 403);
            assert.deepEqual(response.json(), { error: "Permission denied." });
        });
    });

    test("an unreachable upstream stops the request without naming the host", async () => {
        const env = { ONADATA_URL: "http://127.0.0.1:1" };

        await withApp({ env }, async ({ app }) => {
            const response = await app.inject({ url: `${PROBE}?form_id=7` });

            assert.equal(response.statusCode, 500);
            assert.deepEqual(response.json(), {
                error: "Permission check failed.",
            });
        });
    });

    test("a denied request can still be read by an allowed origin", async () => {
        const respond = () => ({ status: 403 });

        await withApp({ respond }, async ({ app }) => {
            const response = await app.inject({
                url: `${PROBE}?form_id=7`,
                headers: { origin: "https://maps.example.test" },
            });

            assert.equal(response.statusCode, 403);
            assert.equal(
                response.headers["access-control-allow-origin"],
                "https://maps.example.test",
            );
        });
    });
});

describe("permission check: the routes that serve submissions", () => {
    const serving = [
        ["a tile", "/v1/mvt/0/0/0"],
        ["bounds", "/v1/bounds"],
    ];

    for (const [label, url] of serving) {
        test(`${label} is asked about before anything is read`, async () => {
            await withApp({}, async ({ app, onadata }) => {
                await app.inject({ url: `${url}?form_id=7&temp_token=abc` });

                assert.deepEqual(onadata.requests(), [
                    {
                        method: "GET",
                        url: "/api/v1/forms/7.json",
                        authorization: "TempToken abc",
                    },
                ]);
            });
        });

        test(`${label} is refused to a caller the upstream denies`, async () => {
            const respond = () => ({ status: 403 });

            await withApp({ respond }, async ({ app }) => {
                const response = await app.inject({ url: `${url}?form_id=7` });

                assert.equal(response.statusCode, 403);
                assert.deepEqual(response.json(), {
                    error: "Permission denied.",
                });
            });
        });

        test(`${label} is refused when the upstream cannot be reached`, async () => {
            const env = { ONADATA_URL: "http://127.0.0.1:1" };

            await withApp({ env }, async ({ app }) => {
                const response = await app.inject({ url: `${url}?form_id=7` });

                assert.equal(response.statusCode, 500);
                assert.deepEqual(response.json(), {
                    error: "Permission check failed.",
                });
            });
        });
    }
});

describe("permission check: other request methods", () => {
    const preflight = (url) => ({
        method: "OPTIONS",
        url,
        headers: {
            origin: "https://maps.example.test",
            "access-control-request-method": "GET",
        },
    });

    test("a HEAD request is checked like a GET", async () => {
        await withApp({}, async ({ app, onadata }) => {
            const response = await app.inject({
                method: "HEAD",
                url: `${PROBE}?form_id=7`,
            });

            assert.equal(response.statusCode, 200);
            assert.deepEqual(
                onadata.requests().map(({ url }) => url),
                ["/api/v1/forms/7.json"],
            );
        });
    });

    test("a denied HEAD request is stopped", async () => {
        const respond = () => ({ status: 403 });

        await withApp({ respond }, async ({ app }) => {
            const response = await app.inject({
                method: "HEAD",
                url: `${PROBE}?form_id=7`,
            });

            assert.equal(response.statusCode, 403);
        });
    });

    test("a HEAD request without a dataset id is a 400", async () => {
        await withApp({}, async ({ app, onadata }) => {
            const response = await app.inject({ method: "HEAD", url: PROBE });

            assert.equal(response.statusCode, 400);
            assert.equal(onadata.requests().length, 0);
        });
    });

    test("a preflight is answered without asking about the dataset", async () => {
        const respond = () => ({ status: 403 });

        await withApp({ respond }, async ({ app, onadata }) => {
            const response = await app.inject(
                preflight(`${PROBE}?form_id=7`),
            );

            assert.equal(response.statusCode, 204);
            assert.equal(response.body, "");
            assert.equal(
                response.headers["access-control-allow-origin"],
                "https://maps.example.test",
            );
            assert.equal(onadata.requests().length, 0);
        });
    });

    test("an OPTIONS request that is not a preflight is refused", async () => {
        await withApp({}, async ({ app }) => {
            const response = await app.inject({
                method: "OPTIONS",
                url: `${PROBE}?form_id=7`,
            });

            assert.equal(response.statusCode, 400);
            assert.doesNotMatch(response.body, /reached/);
        });
    });

    test("a method the route does not serve is a 404", async () => {
        await withApp({}, async ({ app, onadata }) => {
            const response = await app.inject({
                method: "POST",
                url: `${PROBE}?form_id=7`,
            });

            assert.equal(response.statusCode, 404);
            assert.equal(onadata.requests().length, 0);
        });
    });
});

describe("permission check: rejected before any upstream call", () => {
    const rejected = [
        ["no dataset id", {}],
        ["two dataset ids", { dataview_id: 12, form_id: 2 }],
        [
            "three dataset ids",
            { dataview_id: 12, form_id: 2, merged_dataset_id: 3 },
        ],
        ["a path traversal id", { form_id: "../../users" }],
        ["an id with a query string", { form_id: "7?format=xls" }],
        ["an id with trailing SQL", { form_id: "7;DROP TABLE x" }],
        ["a decimal id", { form_id: "7.5" }],
        ["a negative id", { form_id: "-7" }],
        ["a zero id", { form_id: "0" }],
        ["an id beyond the integer range", { form_id: "2147483648" }],
        ["an empty id", { form_id: "" }],
        ["a temp token with a space", { form_id: 7, temp_token: "abc def" }],
        [
            "a temp token with a line break",
            { form_id: 7, temp_token: "abc\r\nX-Injected: 1" },
        ],
        ["an oversized temp token", { form_id: 7, temp_token: "a".repeat(300) }],
    ];

    for (const [label, parameters] of rejected) {
        test(`${label} is a 400`, async () => {
            await withApp({}, async ({ app, onadata }) => {
                const response = await app.inject({
                    url: `${PROBE}?${query(parameters)}`,
                });

                assert.equal(response.statusCode, 400);
                assert.deepEqual(Object.keys(response.json()), ["error"]);
                assert.deepEqual(outboundUrls(onadata), []);
            });
        });
    }

    test("a rejected request says what was wrong with it", async () => {
        await withApp({}, async ({ app }) => {
            const response = await app.inject({
                url: `${PROBE}?form_id=7&dataview_id=8`,
            });

            assert.deepEqual(response.json(), {
                error: "Exactly one of form_id, dataview_id or merged_dataset_id is required.",
            });
        });
    });

    test("a rejected request does not repeat the value it rejected", async () => {
        await withApp({}, async ({ app }) => {
            const response = await app.inject({
                url: `${PROBE}?${query({ form_id: "7<script>alert(1)</script>" })}`,
            });

            assert.equal(response.statusCode, 400);
            assert.doesNotMatch(response.body, /script|alert/);
        });
    });

    test("a repeated dataset id is a 400", async () => {
        await withApp({}, async ({ app, onadata }) => {
            const response = await app.inject({
                url: `${PROBE}?form_id=7&form_id=8`,
            });

            assert.equal(response.statusCode, 400);
            assert.deepEqual(outboundUrls(onadata), []);
        });
    });

    test("a repeated temp token is a 400", async () => {
        await withApp({}, async ({ app, onadata }) => {
            const response = await app.inject({
                url: `${PROBE}?form_id=7&temp_token=a&temp_token=b`,
            });

            assert.equal(response.statusCode, 400);
            assert.deepEqual(outboundUrls(onadata), []);
        });
    });

    test("an unknown route is a 404 that does not repeat the request", async () => {
        await withApp({}, async ({ app, onadata }) => {
            const response = await app.inject({
                url: "/v1/nope?form_id=7&temp_token=abc123",
            });

            assert.equal(response.statusCode, 404);
            assert.deepEqual(response.json(), { error: "Not found." });
            assert.deepEqual(outboundUrls(onadata), []);
        });
    });
});

describe("permission check: logging", () => {
    const TOKEN = "s3cretT0kenValue";

    const loggedDuring = async (respond) => {
        const directory = fs.mkdtempSync(path.join(os.tmpdir(), "dirt-log-"));
        const logFile = path.join(directory, "server.log");
        const env = { SERVER_LOGGER: "info", SERVER_LOGGER_PATH: logFile };
        try {
            await withApp({ respond, env }, ({ app }) =>
                app.inject({
                    url: `${PROBE}?form_id=7&temp_token=${TOKEN}`,
                }),
            );
            return fs.readFileSync(logFile, "utf8");
        } finally {
            fs.rmSync(directory, { recursive: true, force: true });
        }
    };

    test("an allowed request is logged without the temp token", async () => {
        const logged = await loggedDuring(() => ({ status: 200 }));

        assert.match(logged, /form_id=7/);
        assert.doesNotMatch(logged, new RegExp(TOKEN));
    });

    test("a denied request is logged without the temp token", async () => {
        const logged = await loggedDuring(() => ({ status: 403 }));

        assert.match(logged, /form_id=7/);
        assert.doesNotMatch(logged, new RegExp(TOKEN));
    });
});
