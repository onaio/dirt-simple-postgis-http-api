const { describe, test } = require("node:test");
const assert = require("node:assert/strict");

const { statement, render } = require("../lib/statement");
const {
    datasetLookup,
    readDataset,
    submissionConditions,
} = require("../lib/submissions");
const { placeholders, expectedPlaceholders } = require("./helpers/statements");

const form = { formId: 7, dataviewId: null, mergedDatasetId: null };
const dataview = { formId: null, dataviewId: 8, mergedDatasetId: null };
const merged = { formId: null, dataviewId: null, mergedDatasetId: 9 };

const conditions = (resolved, fieldFilter = null) =>
    render(statement`WHERE ${submissionConditions(resolved, fieldFilter)}`);

describe("datasetLookup", () => {
    test("needs no statement for a form", () => {
        assert.equal(datasetLookup(form), null);
    });

    test("reads the member forms of a merged dataset", () => {
        const { text, values } = datasetLookup(merged);

        assert.match(text, /logger_mergedxform_xforms/);
        assert.doesNotMatch(text, /\b9\b/);
        assert.deepEqual(values, [9]);
    });

    test("reads the form and filters of a dataview that is not deleted", () => {
        const { text, values } = datasetLookup(dataview);

        assert.match(text, /logger_dataview/);
        assert.match(text, /deleted_at IS NULL/);
        assert.doesNotMatch(text, /\b8\b/);
        assert.deepEqual(values, [8]);
    });

    test("reads the types of the fields from the definition of the dataview's form", () => {
        const { text } = datasetLookup(dataview);

        assert.match(text, /logger_xform/);
        assert.match(text, /'type'/);
    });
});

describe("readDataset", () => {
    test("a form is its own only member and has no filters", () => {
        assert.deepEqual(readDataset(form, []), { xformIds: [7], filters: [] });
    });

    test("a merged dataset holds each member form", () => {
        const rows = [{ xform_id: 3 }, { xform_id: 4 }];

        assert.deepEqual(readDataset(merged, rows), {
            xformIds: [3, 4],
            filters: [],
        });
    });

    test("an unknown merged dataset holds no forms", () => {
        assert.deepEqual(readDataset(merged, []), { xformIds: [], filters: [] });
    });

    test("an unknown dataview holds no forms", () => {
        assert.deepEqual(readDataset(dataview, []), {
            xformIds: [],
            filters: [],
        });
    });

    test("a dataview holds its form and its filters", () => {
        const filters = [{ column: "status", filter: "=", value: "approved" }];
        const rows = [{ xform_id: 5, readable: true, filters }];

        assert.deepEqual(readDataset(dataview, rows), {
            xformIds: [5],
            filters,
        });
    });

    test("a dataview whose filters cannot be read holds no forms", () => {
        const rows = [{ xform_id: 5, readable: false, filters: [] }];

        assert.deepEqual(readDataset(dataview, rows), {
            xformIds: [],
            filters: [],
        });
    });
});

describe("submissionConditions", () => {
    test("binds the forms as one array", () => {
        const { text, values } = conditions({ xformIds: [3, 4], filters: [] });

        assert.match(text, /i\.xform_id = ANY\(\$1::int4\[\]\)/);
        assert.deepEqual(values, [[3, 4]]);
    });

    test("leaves out deleted submissions", () => {
        const { text } = conditions({ xformIds: [3], filters: [] });

        assert.match(text, /i\.deleted_at is null/i);
    });

    test("does not look the forms up again", () => {
        const { text } = conditions({ xformIds: [3], filters: [] });

        assert.doesNotMatch(text, /logger_dataview|logger_mergedxform_xforms/);
        assert.doesNotMatch(text, /jsonb_array_elements/);
    });

    const operators = [
        ["=", "="],
        [">", ">"],
        ["<", "<"],
        [">=", ">="],
        ["<=", "<="],
        ["!=", "!="],
    ];

    for (const [filter, operator] of operators) {
        test(`writes the ${filter} filter as a comparison with bound operands`, () => {
            const filters = [{ column: "grade", filter, value: "b" }];

            const { text, values } = conditions({ xformIds: [3], filters });

            assert.ok(
                text.includes(`i.json->>$2::text ${operator} $3::text`),
                text,
            );
            assert.deepEqual(values, [[3], "grade", "b"]);
        });
    }

    test("writes every filter, in order", () => {
        const filters = [
            { column: "grade", filter: ">=", value: "b" },
            { column: "site", filter: "=", value: "north" },
        ];

        const { text, values } = conditions({ xformIds: [3], filters });

        assert.deepEqual(values, [[3], "grade", "b", "site", "north"]);
        assert.doesNotMatch(text, /\SAND\b/);
    });

    test("keeps each condition apart from the one before it", () => {
        const filters = [
            { column: "grade", filter: ">=", value: "b" },
            { column: "grade", filter: "unknown", value: "b" },
            { column: "site", filter: "=", value: "north" },
        ];

        const { text } = conditions(
            { xformIds: [3], filters },
            { name: "status", value: "approved" },
        );

        assert.equal(text.match(/\sAND\s/g).length, 5);
        assert.doesNotMatch(text, /\SAND\b/);
    });

    const unusable = [
        ["an unknown operator", { column: "grade", filter: "LIKE", value: "%" }],
        ["an operator that is SQL", { column: "a", filter: "= 'a' OR true --", value: "a" }],
        ["an operator named after an object property", { column: "grade", filter: "constructor", value: "b" }],
        ["an operator named __proto__", { column: "grade", filter: "__proto__", value: "b" }],
        ["an operator named toString", { column: "grade", filter: "toString", value: "b" }],
        ["an operator that is not text", { column: "grade", filter: ["="], value: "b" }],
        ["a missing operator", { column: "grade", value: "b" }],
        ["a missing column", { filter: "=", value: "b" }],
        ["a missing value", { column: "grade", filter: "=" }],
        ["a null value", { column: "grade", filter: "=", value: null }],
        ["a filter that is not an object", "grade = b"],
        ["a null filter", null],
    ];

    for (const [label, filter] of unusable) {
        test(`${label} matches nothing and adds no SQL of its own`, () => {
            const { text, values } = conditions({
                xformIds: [3],
                filters: [filter],
            });

            assert.match(text, /AND false/);
            assert.doesNotMatch(text, /LIKE|OR true/);
            assert.deepEqual(values, [[3]]);
        });
    }

    const patternsIn = (values) =>
        values.filter(
            (held) => typeof held === "string" && held.startsWith("^"),
        );

    const typed = (type, comparison = ">", value = "10") => ({
        column: "age",
        filter: comparison,
        value,
        type,
    });

    const castTo = [
        ["integer", "10", "10", /::numeric/],
        ["integer", "-10", "-10", /::numeric/],
        ["decimal", "10.5", "10.5", /::numeric/],
        ["decimal", ".5", ".5", /::numeric/],
        ["decimal", "1e3", "1e3", /::numeric/],
        ["decimal", "1e999", "1e999", /::numeric/],
        ["decimal", "5.", "5.", /::numeric/],
        ["decimal", `${"1".repeat(97)}.55`, `${"1".repeat(97)}.55`, /::numeric/],
        ["integer", "1".repeat(100), "1".repeat(100), /::numeric/],
        ["integer", `-${"1".repeat(99)}`, `-${"1".repeat(99)}`, /::numeric/],
        ["date", "2024-02-01", "2024-02-01", /::timestamp/],
        ["date", "2024-02-29", "2024-02-29", /::timestamp/],
        ["date", "2000-02-29", "2000-02-29", /::timestamp/],
        ["date", "2400-02-29", "2400-02-29", /::timestamp/],
        ["date", "2023-02-28", "2023-02-28", /::timestamp/],
        ["date", "2024-01-31", "2024-01-31", /::timestamp/],
        ["date", "2024-06-30", "2024-06-30", /::timestamp/],
        ["date", "2024-12-31", "2024-12-31", /::timestamp/],
        ["date", "9999-12-31", "9999-12-31", /::timestamp/],
        ["date", "1000-01-01", "1000-01-01", /::timestamp/],
        ["date", "2024-02-01 10:20:30", "2024-02-01 10:20:30", /::timestamp/],
        ["date", "2024-02-01T10:20:30.125+03:00", "2024-02-01T10:20:30.125+03:00", /::timestamp/],
        ["date", "9999-12-31T23:59:59.999999-15:59", "9999-12-31T23:59:59.999999-15:59", /::timestamp/],
        ["date", "2024-02-01T10:20:30Z", "2024-02-01T10:20:30Z", /::timestamp/],
        ["date", "2024-02-01T10:20:30+0330", "2024-02-01T10:20:30+0330", /::timestamp/],
    ];

    for (const [type, value, bound, cast] of castTo) {
        test(`compares ${value} with a field of type ${type} as that type`, () => {
            const { text, values } = conditions({
                xformIds: [3],
                filters: [typed(type, ">", value)],
            });

            assert.match(text, cast);
            assert.doesNotMatch(text, /AND false/);
            assert.deepEqual([values[1], values.at(-1)], ["age", bound]);
            assert.deepEqual(patternsIn(values).length, 1);
            assert.match(value, new RegExp(patternsIn(values)[0]));
            assert.deepEqual(
                values.filter((held) => held === value).length,
                1,
            );
            assert.deepEqual(placeholders(text), expectedPlaceholders(values));
        });
    }

    const unsuited = [
        ["integer", "ten"],
        ["integer", "10.5"],
        ["integer", "1e3"],
        ["integer", ""],
        ["integer", " 10"],
        ["integer", "10\n"],
        ["integer", "10 OR true"],
        ["integer", "1".repeat(101)],
        ["integer", `-${"1".repeat(100)}`],
        ["decimal", `${"1".repeat(98)}.55`],
        ["decimal", `${"1".repeat(98)}e10`],
        ["decimal", "heavy"],
        ["decimal", "."],
        ["decimal", "1e1000"],
        ["decimal", "NaN"],
        ["decimal", "10; DROP TABLE logger_instance"],
        ["date", "yesterday"],
        ["date", "01/02/2024"],
        ["date", "2024-02-01T10:20"],
        ["date", "2024-02-01T10:20:30 OR true"],
        ["date", "2024-2-1"],
        ["date", "2024-02-30"],
        ["date", "2023-02-29"],
        ["date", "2100-02-29"],
        ["date", "1900-02-29"],
        ["date", "2024-02-31"],
        ["date", "2024-06-31"],
        ["date", "2024-09-31"],
        ["date", "2024-11-31"],
        ["date", "2024-01-32"],
        ["date", "2024-04-31"],
        ["date", "2024-13-01"],
        ["date", "2024-00-10"],
        ["date", "2024-01-00"],
        ["date", "9999-99-99"],
        ["date", "0000-01-01"],
        ["date", "0999-12-31"],
        ["date", "2024-02-29T24:00:00"],
        ["date", "2024-02-29T23:60:00"],
        ["date", "2024-02-29T23:59:60"],
        ["date", "2024-02-29T10:20:30.1234567"],
        ["date", "2024-02-29T10:20:30."],
        ["date", "2024-02-29T10:20:30+16:00"],
        ["date", "2024-02-29T10:20:30+03:60"],
        ["date", "2024-02-29Z"],
        ["date", " 2024-02-29"],
        ["date", "2024-02-29\n"],
    ];

    for (const [type, value] of unsuited) {
        test(`${JSON.stringify(value)} does not suit a field of type ${type}, matches nothing and binds nothing`, () => {
            const { text, values } = conditions({
                xformIds: [3],
                filters: [typed(type, ">", value)],
            });

            assert.match(text, /AND false/);
            assert.deepEqual(values, [[3]]);
        });
    }

    const alwaysTyped = [
        ["_id", "text", "700", "700", /::numeric/],
        ["_id", undefined, "700", "700", /::numeric/],
        ["_submission_time", "integer", "2024-06-01", "2024-06-01", /::timestamp/],
        ["_submission_time", undefined, "2024-06-01", "2024-06-01", /::timestamp/],
    ];

    for (const [column, type, value, bound, cast] of alwaysTyped) {
        test(`compares ${column} the same way whatever type ${type} it is given`, () => {
            const { text, values } = conditions({
                xformIds: [3],
                filters: [{ column, filter: ">", value, type }],
            });

            assert.match(text, cast);
            assert.equal(values.at(-1), bound);
        });
    }

    const comparedAsText = [
        "text",
        "int",
        "INTEGER",
        "select one",
        "constructor",
        "__proto__",
        "toString",
        null,
        undefined,
        5,
        ["integer"],
    ];

    for (const type of comparedAsText) {
        test(`compares a field of type ${JSON.stringify(type)} as text`, () => {
            const { text, values } = conditions({
                xformIds: [3],
                filters: [typed(type)],
            });

            assert.ok(text.includes("i.json->>$2::text > $3::text"), text);
            assert.deepEqual(values, [[3], "age", "10"]);
        });
    }

    for (const column of ["constructor", "__proto__", "toString"]) {
        test(`a field named ${column} keeps its type`, () => {
            const { text, values } = conditions({
                xformIds: [3],
                filters: [{ column, filter: ">", value: "10", type: "integer" }],
            });

            assert.match(text, /::numeric/);
            assert.deepEqual([values[1], values.at(-1)], [column, "10"]);
        });
    }

    test("writes the <> filter as a comparison with bound operands", () => {
        const filters = [{ column: "grade", filter: "<>", value: "b" }];

        const { text, values } = conditions({ xformIds: [3], filters });

        assert.ok(text.includes("i.json->>$2::text <> $3::text"), text);
        assert.deepEqual(values, [[3], "grade", "b"]);
    });

    const either = (column, value, condition = "or") => ({
        column,
        filter: "=",
        value,
        condition,
    });

    test("joins the filters marked as alternatives into one condition", () => {
        const filters = [
            either("grade", "a"),
            { column: "site", filter: "=", value: "north" },
            either("grade", "c", "OR"),
        ];

        const { text, values } = conditions({ xformIds: [3], filters });

        assert.match(
            text,
            /AND i\.json->>\$2::text = \$3::text\s+AND \(\s*i\.json->>\$4::text = \$5::text\s+OR i\.json->>\$6::text = \$7::text\s*\)/,
        );
        assert.deepEqual(values, [[3], "site", "north", "grade", "a", "grade", "c"]);
        assert.equal(text.match(/\sOR\s/g).length, 1);
    });

    test("a single alternative is a condition of its own", () => {
        const { text, values } = conditions({
            xformIds: [3],
            filters: [either("grade", "a")],
        });

        assert.match(text, /AND \(\s*i\.json->>\$2::text = \$3::text\s*\)/);
        assert.doesNotMatch(text, /\sOR\s/);
        assert.deepEqual(values, [[3], "grade", "a"]);
    });

    for (const condition of ["and", "", "or ", "nor", null, ["or"], { or: true }, 1]) {
        test(`a filter whose condition is ${JSON.stringify(condition)} is no alternative`, () => {
            const { text } = conditions({
                xformIds: [3],
                filters: [either("grade", "a", condition), either("grade", "c", condition)],
            });

            assert.doesNotMatch(text, /\sOR\s/);
            assert.equal(text.match(/\sAND\s/g).length, 3);
        });
    }

    test("an alternative that cannot be applied matches nothing, whatever the others match", () => {
        const filters = [
            either("grade", "a"),
            { column: "grade", filter: "LIKE", value: "%", condition: "or" },
        ];

        const { text, values } = conditions({ xformIds: [3], filters });

        assert.match(text, /AND false/);
        assert.doesNotMatch(text, /\(\s*false|OR\s+false|false\s+OR/);
        assert.doesNotMatch(text, /LIKE/);
        assert.deepEqual(values, [[3], "grade", "a"]);
    });

    test("adds the field filter after the alternatives", () => {
        const { text, values } = conditions(
            { xformIds: [3], filters: [either("grade", "a")] },
            { name: "status", value: "approved" },
        );

        assert.match(text, /\)\s+AND i\.json->>\$4::text = \$5::text/);
        assert.deepEqual(values, [[3], "grade", "a", "status", "approved"]);
    });

    test("adds the field filter after the dataview filters", () => {
        const filters = [{ column: "grade", filter: "=", value: "b" }];

        const { text, values } = conditions(
            { xformIds: [3], filters },
            { name: "status", value: "approved" },
        );

        assert.ok(text.includes("i.json->>$4::text = $5::text"), text);
        assert.deepEqual(values, [[3], "grade", "b", "status", "approved"]);
    });

    test("supplies one value per placeholder", () => {
        const filters = [
            { column: "grade", filter: ">=", value: "b" },
            { column: "grade", filter: "unknown", value: "b" },
            { column: "site", filter: "=", value: "north" },
        ];

        const { text, values } = conditions(
            { xformIds: [3, 4], filters },
            { name: "status", value: "approved" },
        );

        assert.deepEqual(placeholders(text), expectedPlaceholders(values));
    });
});
