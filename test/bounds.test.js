const { describe, test } = require("node:test");
const assert = require("node:assert/strict");

const { parse, sql } = require("../routes/bounds");
const { placeholders, expectedPlaceholders } = require("./helpers/statements");

const config = { tableName: "logger_instance", geomColumn: "geom" };
const oneForm = { xformIds: [1], filters: [] };
const isBadRequest = (error) => error.statusCode === 400;

const build = (query, resolved = oneForm, settings = config) =>
    sql(parse(query), resolved, settings);

describe("bounds request", () => {
    test("names the dataset and the field filter", () => {
        const request = parse({
            merged_dataset_id: 9,
            field_name: "category",
            field_value: "residential",
        });

        assert.deepEqual(request, {
            dataset: { formId: null, dataviewId: null, mergedDatasetId: 9 },
            fieldFilter: { name: "category", value: "residential" },
        });
    });

    for (const [label, query] of [
        ["without a field name", { form_id: 1, field_value: "x" }],
        ["with an empty field name", { form_id: 1, field_name: "", field_value: "x" }],
    ]) {
        test(`rejects a field value ${label}`, () => {
            assert.throws(
                () => parse(query),
                (error) =>
                    error.statusCode === 400 &&
                    /field_name and field_value/.test(error.message),
            );
        });
    }

    test("takes neither given as no filter at all", () => {
        assert.equal(parse({ form_id: 1 }).fieldFilter, null);
    });

    test("ignores the retired limit parameter", () => {
        assert.deepEqual(
            parse({ form_id: 1, limit: "1000" }),
            parse({ form_id: 1 }),
        );
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
            assert.throws(() => parse(query), isBadRequest);
        });
    }
});

describe("bounds statement", () => {
    test("binds the forms instead of inlining them", () => {
        const { text, values } = build(
            { merged_dataset_id: 9 },
            { xformIds: [842230, 842231], filters: [] },
        );

        assert.doesNotMatch(text, /842230|842231/);
        assert.deepEqual(values[0], [842230, 842231]);
    });

    test("reads the submissions table only", () => {
        const { text } = build({ dataview_id: 8 });

        assert.doesNotMatch(text, /logger_dataview|logger_mergedxform_xforms/);
        assert.doesNotMatch(text, /LIMIT/i);
    });

    test("binds the field filter name and value", () => {
        const { text, values } = build({
            form_id: 1,
            field_name: "category",
            field_value: "residential",
        });

        assert.doesNotMatch(text, /category|residential/);
        assert.ok(values.includes("category"));
        assert.ok(values.includes("residential"));
    });

    test("keeps hostile field filter text out of the statement", () => {
        const hostile = "x' OR '1'='1";

        const { text, values } = build({
            form_id: 1,
            field_name: "status",
            field_value: hostile,
        });

        assert.doesNotMatch(text, /OR '1'/);
        assert.ok(values.includes(hostile));
    });

    for (const query of [
        { form_id: 1 },
        { dataview_id: 1 },
        { merged_dataset_id: 1 },
        { form_id: 1, field_name: "a", field_value: "b" },
    ]) {
        test(`supplies one value per placeholder for ${JSON.stringify(query)}`, () => {
            const filters = [{ column: "grade", filter: ">", value: "a" }];

            const { text, values } = build(query, { xformIds: [1, 2], filters });

            assert.deepEqual(placeholders(text), expectedPlaceholders(values));
        });
    }

    test("quotes the table and geometry column", () => {
        const { text } = build({ form_id: 1 }, oneForm, {
            tableName: "submissions",
            geomColumn: "shape",
        });

        assert.match(text, /"submissions" i\b/);
        assert.match(text, /i\."shape"/);
        assert.doesNotMatch(text, /i\.geom\b/);
    });

    test("refuses a geometry column that is not an identifier", () => {
        assert.throws(
            () =>
                build({ form_id: 1 }, oneForm, {
                    ...config,
                    geomColumn: "geom) FROM x --",
                }),
            /identifier/,
        );
    });
});
