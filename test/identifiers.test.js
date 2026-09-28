const { describe, test } = require("node:test");
const assert = require("node:assert/strict");

const {
    isIdentifier,
    quoteIdentifier,
    quoteQualifiedName,
} = require("../lib/identifiers");

describe("isIdentifier", () => {
    for (const name of ["geom", "logger_instance", "_private", "Col9", "a"]) {
        test(`accepts ${name}`, () => {
            assert.equal(isIdentifier(name), true);
        });
    }

    const invalid = [
        ["an empty string", ""],
        ["a leading digit", "9lives"],
        ["a space", "id name"],
        ["a double quote", 'id"'],
        ["a single quote", "id'"],
        ["a semicolon", "id;"],
        ["a comment marker", "id--"],
        ["a parenthesis", "count(id)"],
        ["a dot", "public.table"],
        ["a comma", "id,json"],
        ["a line break", "id\n"],
        ["a non-ASCII letter", "idé"],
        ["more than 63 characters", "a".repeat(64)],
        ["a number", 7],
        ["an array", ["id"]],
        ["null", null],
        ["undefined", undefined],
    ];

    for (const [label, value] of invalid) {
        test(`rejects ${label}`, () => {
            assert.equal(isIdentifier(value), false);
        });
    }

    test("accepts exactly 63 characters", () => {
        assert.equal(isIdentifier("a".repeat(63)), true);
    });
});

describe("quoteIdentifier", () => {
    test("wraps a valid identifier in double quotes", () => {
        assert.equal(quoteIdentifier("geom"), '"geom"');
    });

    test("folds case the way an unquoted identifier is folded", () => {
        assert.equal(quoteIdentifier("GeoM"), '"geom"');
    });

    test("throws on an invalid identifier", () => {
        assert.throws(() => quoteIdentifier('geom" FROM x --'), /identifier/i);
    });
});

describe("quoteQualifiedName", () => {
    test("quotes a bare table name", () => {
        assert.equal(quoteQualifiedName("logger_instance"), '"logger_instance"');
    });

    test("quotes each part of a schema-qualified name", () => {
        assert.equal(
            quoteQualifiedName("public.logger_instance"),
            '"public"."logger_instance"',
        );
    });

    test("folds the case of each part", () => {
        assert.equal(
            quoteQualifiedName("Public.Logger_Instance"),
            '"public"."logger_instance"',
        );
    });

    for (const name of [
        "a.b.c",
        ".logger_instance",
        "public.",
        "public.logger instance",
        "",
        undefined,
    ]) {
        test(`throws on ${JSON.stringify(name)}`, () => {
            assert.throws(() => quoteQualifiedName(name), /identifier|name/i);
        });
    }
});
