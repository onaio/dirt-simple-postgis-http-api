const { describe, test } = require("node:test");
const assert = require("node:assert/strict");

const { redactUrl, loggerOptions } = require("../lib/logging");

describe("redactUrl", () => {
    test("leaves a url without a temp token untouched", () => {
        assert.equal(
            redactUrl("/v1/mvt/0/0/0?form_id=7"),
            "/v1/mvt/0/0/0?form_id=7",
        );
    });

    test("leaves a url without a query string untouched", () => {
        assert.equal(redactUrl("/health-check"), "/health-check");
    });

    test("hides the temp token and keeps the other parameters", () => {
        const redacted = redactUrl("/v1/bounds?form_id=7&temp_token=abc123&x=1");

        assert.doesNotMatch(redacted, /abc123/);
        assert.match(redacted, /^\/v1\/bounds\?/);
        assert.match(redacted, /form_id=7/);
        assert.match(redacted, /x=1/);
    });

    test("hides every occurrence of a repeated temp token", () => {
        const redacted = redactUrl("/v1/bounds?temp_token=first1&temp_token=second2");

        assert.doesNotMatch(redacted, /first1|second2/);
    });

    test("hides a temp token whose parameter name is percent-encoded", () => {
        const redacted = redactUrl("/v1/bounds?form_id=7&temp%5Ftoken=abc123");

        assert.doesNotMatch(redacted, /abc123/);
    });

    for (const [label, url] of [
        ["a semicolon", "/v1/bounds;form_id=7&temp_token=abc123"],
        ["a hash", "/v1/bounds#form_id=7&temp_token=abc123"],
        ["a semicolon after a question mark", "/v1/bounds?form_id=7;temp_token=abc123"],
        ["a semicolon, its name percent-encoded", "/v1/bounds;temp%5Ftoken=abc123"],
        ["a semicolon, its name in capitals", "/v1/bounds;TEMP_TOKEN=abc123"],
        ["a path", "/v1/bounds/temp_token=abc123"],
    ]) {
        test(`hides a temp token that follows ${label}`, () => {
            assert.doesNotMatch(redactUrl(url), /abc123/);
        });
    }

    test("hides a temp token whose name cannot be decoded", () => {
        const redacted = redactUrl("/v1/bounds?temp_token%ZZ=abc123&temp_token=def456");

        assert.doesNotMatch(redacted, /def456/);
    });

    test("leaves a name that cannot be decoded and is no secret alone", () => {
        const url = "/v1/bounds?form%ZZ=7";

        assert.equal(redactUrl(url), url);
    });

    test("keeps what is not the temp token when the query follows a semicolon", () => {
        const redacted = redactUrl("/v1/bounds;form_id=7&temp_token=abc123");

        assert.match(redacted, /^\/v1\/bounds;/);
        assert.match(redacted, /form_id=7/);
    });

    const alongside = [
        ["a path that holds a pair", "/v1/foo=bar?temp_token=abc123&form_id=7"],
        ["a path of several pairs", "/a=1/b=2?temp_token=abc123"],
        ["a path that ends in an equals sign", "/v1/x=?temp_token=abc123"],
        ["a value that holds a question mark before the query", "/v1/a=b?c=d?temp_token=abc123"],
    ];

    for (const [label, url] of alongside) {
        test(`hides a temp token beside ${label}`, () => {
            assert.doesNotMatch(redactUrl(url), /abc123/);
        });
    }

    test("leaves a path that holds a pair as it is", () => {
        const redacted = redactUrl("/v1/foo=bar?temp_token=abc123");

        assert.match(redacted, /^\/v1\/foo=bar\?/);
    });

    test("hides a temp token that contains a question mark", () => {
        const redacted = redactUrl("/v1/bounds?temp_token=abc?def123");

        assert.doesNotMatch(redacted, /abc|def123/);
    });
});

describe("loggerOptions", () => {
    test("turns logging off when no level is configured", () => {
        assert.equal(loggerOptions({}), false);
    });

    test("reads true as the info level", () => {
        assert.equal(loggerOptions({ SERVER_LOGGER: "true" }).level, "info");
    });

    for (const level of ["fatal", "error", "warn", "info", "debug", "trace", "silent"]) {
        test(`uses the configured level ${level}`, () => {
            assert.equal(loggerOptions({ SERVER_LOGGER: level }).level, level);
        });
    }

    for (const value of ["false", ""]) {
        test(`turns logging off when the level is ${JSON.stringify(value)}`, () => {
            assert.equal(loggerOptions({ SERVER_LOGGER: value }), false);
        });
    }

    for (const value of ["yes", "INFO", "verbose", "1", "warn "]) {
        test(`refuses the level ${JSON.stringify(value)}`, () => {
            assert.throws(
                () => loggerOptions({ SERVER_LOGGER: value }),
                /SERVER_LOGGER must be one of/,
            );
        });
    }

    test("logs to the configured file", () => {
        const options = loggerOptions({
            SERVER_LOGGER: "info",
            SERVER_LOGGER_PATH: "/tmp/dirt.log",
        });

        assert.equal(options.file, "/tmp/dirt.log");
    });

    test("serializes a request without its temp token", () => {
        const { serializers } = loggerOptions({ SERVER_LOGGER: "info" });

        const logged = serializers.req({
            method: "GET",
            url: "/v1/bounds?form_id=7&temp_token=abc123",
            headers: { "accept-version": "1.x" },
            hostname: "tiles.example.test",
            ip: "10.0.0.1",
            socket: { remotePort: 4000 },
        });

        assert.doesNotMatch(JSON.stringify(logged), /abc123/);
        assert.equal(logged.method, "GET");
        assert.match(logged.url, /form_id=7/);
        assert.equal(logged.remoteAddress, "10.0.0.1");
        assert.equal(logged.remotePort, 4000);
        assert.equal(logged.hostname, "tiles.example.test");
        assert.equal(logged.version, "1.x");
    });

    test("serializes a request that has no socket", () => {
        const { serializers } = loggerOptions({ SERVER_LOGGER: "info" });

        const logged = serializers.req({
            method: "GET",
            url: "/health-check",
            headers: {},
        });

        assert.equal(logged.remotePort, undefined);
        assert.equal(logged.url, "/health-check");
    });
});
