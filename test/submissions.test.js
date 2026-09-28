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
