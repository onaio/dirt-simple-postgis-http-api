const { describe, test } = require("node:test");
const assert = require("node:assert/strict");

const {
    statement,
    identifier,
    qualifiedName,
    concat,
    render,
} = require("../lib/statement");

describe("statement", () => {
    test("turns an interpolated value into a bound parameter", () => {
        const hostile = "x'; DROP TABLE users; --";

        const { text, values } = render(
            statement`SELECT * FROM t WHERE name = ${hostile}`,
        );

        assert.equal(text, "SELECT * FROM t WHERE name = $1");
        assert.deepEqual(values, [hostile]);
    });

    test("numbers parameters in the order they appear", () => {
        const { text, values } = render(
            statement`SELECT ${"a"}, ${2}, ${null}`,
        );

        assert.equal(text, "SELECT $1, $2, $3");
        assert.deepEqual(values, ["a", 2, null]);
    });

    test("renumbers the parameters of a nested statement", () => {
        const inner = statement`b = ${"two"}`;

        const { text, values } = render(
            statement`SELECT * FROM t WHERE a = ${"one"} AND ${inner} AND c = ${"three"}`,
        );

        assert.equal(text, "SELECT * FROM t WHERE a = $1 AND b = $2 AND c = $3");
        assert.deepEqual(values, ["one", "two", "three"]);
    });

    test("binds a nested statement again each time it is reused", () => {
        const envelope = statement`envelope(${7})`;

        const { text, values } = render(statement`${envelope} && ${envelope}`);

        assert.equal(text, "envelope($1) && envelope($2)");
        assert.deepEqual(values, [7, 7]);
    });

    test("renders an empty statement as nothing", () => {
        const { text, values } = render(statement`SELECT 1 ${statement``}`);

        assert.equal(text, "SELECT 1 ");
        assert.deepEqual(values, []);
    });

    test("binds an object that merely looks like a statement", () => {
        const forged = { segments: ["1; DROP TABLE users"] };

        const { text, values } = render(statement`SELECT ${forged}`);

        assert.equal(text, "SELECT $1");
        assert.deepEqual(values, [forged]);
    });

    test("refuses to render anything that is not a statement", () => {
        assert.throws(
            () => render({ segments: ["SELECT 1; DROP TABLE users"] }),
            /Only statements/,
        );
    });

    test("binds undefined as null", () => {
        const { values } = render(statement`SELECT ${undefined}`);

        assert.deepEqual(values, [null]);
    });
});

describe("identifier", () => {
    test("is written into the text in double quotes", () => {
        const { text, values } = render(
            statement`SELECT ${identifier("geom")} FROM t`,
        );

        assert.equal(text, 'SELECT "geom" FROM t');
        assert.deepEqual(values, []);
    });

    test("throws on text that is not an identifier", () => {
        assert.throws(() => identifier("geom FROM users --"), /identifier/);
    });
});

describe("qualifiedName", () => {
    test("quotes each part of a schema-qualified name", () => {
        const { text } = render(
            statement`SELECT 1 FROM ${qualifiedName("public.logger_instance")}`,
        );

        assert.equal(text, 'SELECT 1 FROM "public"."logger_instance"');
    });

    test("throws on text that is not a name", () => {
        assert.throws(
            () => qualifiedName("logger_instance; DROP TABLE x"),
            /identifier/,
        );
    });
});

describe("concat", () => {
    test("joins statements and keeps their parameters in order", () => {
        const { text, values } = render(
            concat([statement`, ${identifier("a")}`, statement` = ${1}`, statement` AND ${2}`]),
        );

        assert.equal(text, ', "a" = $1 AND $2');
        assert.deepEqual(values, [1, 2]);
    });

    test("joins nothing into an empty statement", () => {
        assert.deepEqual(render(concat([])), { text: "", values: [] });
    });

    test("refuses anything that is not a statement", () => {
        assert.throws(
            () => concat([statement`a`, "; DROP TABLE users"]),
            /Only statements/,
        );
    });
});
