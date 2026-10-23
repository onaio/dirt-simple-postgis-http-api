const { test } = require("node:test");
const assert = require("node:assert/strict");

const { build } = require("../app");
const { testEnv } = require("./helpers/env");

test("health check answers without a permission check", async () => {
    const app = await build(testEnv());
    try {
        const response = await app.inject({ url: "/health-check" });

        assert.equal(response.statusCode, 200);
        assert.equal(response.body, "healthy");
    } finally {
        await app.close();
    }
});

test("building the app does not start listening", async () => {
    const app = await build(testEnv());
    try {
        assert.equal(app.server.listening, false);
    } finally {
        await app.close();
    }
});

for (const name of [
    "POSTGRES_CONNECTION",
    "TABLE_NAME",
    "TABLE_COLUMN",
    "ONADATA_URL",
    "FORMS_ENDPOINT",
    "DATAVIEWS_ENDPOINT",
    "MERGED_DATASETS_ENDPOINT",
]) {
    test(`build refuses to start without ${name}`, async () => {
        const { [name]: removed, ...env } = testEnv();

        await assert.rejects(() => build(env), new RegExp(name));
    });

    test(`build refuses to start with an empty ${name}`, async () => {
        await assert.rejects(
            () => build(testEnv({ [name]: "" })),
            new RegExp(name),
        );
    });
}

for (const [name, value] of [
    ["TABLE_NAME", "logger_instance; DROP TABLE x"],
    ["TABLE_NAME", "a.b.c"],
    ["TABLE_COLUMN", "geom) FROM x --"],
    ["TABLE_COLUMN", "public.geom"],
]) {
    test(`build refuses to start with ${name} set to ${value}`, async () => {
        await assert.rejects(
            () => build(testEnv({ [name]: value })),
            /TABLE_NAME must be a table name/,
        );
    });
}

test("build accepts a schema-qualified table name", async () => {
    const app = await build(testEnv({ TABLE_NAME: "public.logger_instance" }));

    await app.close();
});

test("an unexpected failure is a 500 that names nothing internal", async () => {
    const app = await build(testEnv());
    app.get("/v1/broken", { config: { public: true } }, () => {
        throw new Error("secret-internal-detail");
    });
    try {
        const response = await app.inject({ url: "/v1/broken" });

        assert.equal(response.statusCode, 500);
        assert.deepEqual(response.json(), { error: "Internal server error." });
    } finally {
        await app.close();
    }
});

test("a client error raised by the framework does not repeat the request", async () => {
    const app = await build(testEnv());
    app.get("/v1/teapot", { config: { public: true } }, () => {
        throw Object.assign(new Error("echoed <input>"), { statusCode: 418 });
    });
    try {
        const response = await app.inject({ url: "/v1/teapot" });

        assert.equal(response.statusCode, 418);
        assert.deepEqual(response.json(), {
            error: "The request could not be processed.",
        });
    } finally {
        await app.close();
    }
});

test("a route is not public unless it says so", async () => {
    const app = await build(testEnv());
    app.get("/v1/unmarked", (request, reply) => reply.send("reached"));
    try {
        const response = await app.inject({ url: "/v1/unmarked" });

        assert.equal(response.statusCode, 400);
        assert.doesNotMatch(response.body, /reached/);
    } finally {
        await app.close();
    }
});
