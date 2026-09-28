const { describe, test } = require("node:test");
const assert = require("node:assert/strict");

const { sql } = require("../routes/bounds");
const { placeholders, expectedPlaceholders } = require("./helpers/statements");

const config = { tableName: "logger_instance", geomColumn: "geom" };
const isBadRequest = (error) => error.statusCode === 400;

describe("bounds statement", () => {
    const datasets = [
        ["form id", { form_id: 842230 }, 842230],
        ["merged dataset id", { merged_dataset_id: 852601 }, 852601],
        ["dataview id", { dataview_id: 12345 }, 12345],
    ];

    for (const [label, query, id] of datasets) {
        test(`binds the ${label} instead of inlining it`, () => {
            const { text, values } = sql({}, query, config);

            assert.doesNotMatch(text, new RegExp(String(id)));
            assert.ok(values.includes(id));
        });
    }

    test("binds the field filter name and value", () => {
        const { text, values } = sql(
            {},
            { form_id: 1, field_name: "category", field_value: "residential" },
            config,
        );

        assert.doesNotMatch(text, /category|residential/);
        assert.ok(values.includes("category"));
        assert.ok(values.includes("residential"));
    });

    test("keeps hostile field filter text out of the statement", () => {
        const hostile = "x' OR '1'='1";

        const { text, values } = sql(
            {},
            { form_id: 1, field_name: "status", field_value: hostile },
            config,
        );

        assert.doesNotMatch(text, /OR '1'/);
        assert.ok(values.includes(hostile));
    });

    test("ignores a field value given without a field name", () => {
        const unfiltered = sql({}, { form_id: 1 }, config);
        const valueOnly = sql({}, { form_id: 1, field_value: "x" }, config);
        const emptyName = sql(
            {},
            { form_id: 1, field_name: "", field_value: "x" },
            config,
        );

        assert.deepEqual(valueOnly, unfiltered);
        assert.deepEqual(emptyName, unfiltered);
    });

    for (const query of [
        { form_id: 1 },
        { dataview_id: 1 },
        { merged_dataset_id: 1 },
        { form_id: 1, field_name: "a", field_value: "b" },
    ]) {
        test(`supplies one value per placeholder for ${JSON.stringify(query)}`, () => {
            const { text, values } = sql({}, query, config);

            assert.deepEqual(placeholders(text), expectedPlaceholders(values));
        });
    }

    test("quotes the table and geometry column", () => {
        const { text } = sql(
            {},
            { form_id: 1 },
            { tableName: "submissions", geomColumn: "shape" },
        );

        assert.match(text, /"submissions" i\b/);
        assert.match(text, /i\."shape"/);
        assert.doesNotMatch(text, /i\.geom\b/);
    });

    test("ignores the retired limit parameter", () => {
        const { text, values } = sql({}, { form_id: 1, limit: "1000" }, config);

        assert.doesNotMatch(text, /LIMIT/i);
        assert.ok(!values.includes("1000"));
    });

    const invalid = [
        ["a field name without a value", { form_id: 1, field_name: "status" }],
        [
            "a repeated field value",
            { form_id: 1, field_name: "a", field_value: ["x", "y"] },
        ],
        ["no dataset id", {}],
        ["two dataset ids", { form_id: 1, merged_dataset_id: 2 }],
        ["a text dataset id", { form_id: "1 OR 1=1" }],
    ];

    for (const [label, query] of invalid) {
        test(`rejects ${label} as a bad request`, () => {
            assert.throws(() => sql({}, query, config), isBadRequest);
        });
    }

    test("refuses a geometry column that is not an identifier", () => {
        assert.throws(
            () =>
                sql(
                    {},
                    { form_id: 1 },
                    { ...config, geomColumn: "geom) FROM x --" },
                ),
            /identifier/,
        );
    });
});
