const { describe, test } = require("node:test");
const assert = require("node:assert/strict");

const { parse, sql } = require("../routes/mvt");
const { placeholders, expectedPlaceholders } = require("./helpers/statements");

const config = { tableName: "logger_instance", geomColumn: "geom" };
const tile = { z: 10, x: 512, y: 511 };
const oneForm = { xformIds: [1], filters: [] };
const isBadRequest = (error) => error.statusCode === 400;

const build = (params, query, resolved = oneForm, settings = config) =>
    sql(parse(params, query), resolved, settings);

describe("mvt request", () => {
    test("names the dataset, the tile and the optional parts", () => {
        const request = parse(tile, {
            dataview_id: 8,
            field_name: "status",
            field_value: "approved",
            columns: "ID, json",
            id_column: "Id",
        });

        assert.deepEqual(request, {
            tile,
            dataset: { formId: null, dataviewId: 8, mergedDatasetId: null },
            fieldFilter: { name: "status", value: "approved" },
            columns: ["id", "json"],
            idColumn: "id",
        });
    });

    test("leaves the optional parts empty when they are not given", () => {
        const request = parse(tile, { form_id: 1 });

        assert.equal(request.fieldFilter, null);
        assert.deepEqual(request.columns, []);
        assert.equal(request.idColumn, null);
    });

    test("ignores a field value given without a field name", () => {
        const unfiltered = parse(tile, { form_id: 1 });

        assert.deepEqual(parse(tile, { form_id: 1, field_value: "x" }), unfiltered);
        assert.deepEqual(
            parse(tile, { form_id: 1, field_name: "", field_value: "x" }),
            unfiltered,
        );
    });

    const invalid = [
        ["a column the tile does not hold", { form_id: 1, columns: "xml" }],
        ["an id column the tile does not hold", { form_id: 1, id_column: "uuid" }],
        ["a column expression", { form_id: 1, columns: "count(*)" }],
        [
            "a column subquery",
            { form_id: 1, columns: "(SELECT body FROM private_notes)" },
        ],
        ["an empty column in the list", { form_id: 1, columns: "id,,json" }],
        ["a quoted column", { form_id: 1, columns: '"id"' }],
        ["a repeated columns parameter", { form_id: 1, columns: ["id", "json"] }],
        ["an id column expression", { form_id: 1, id_column: "id, json" }],
        ["an id column with a quote", { form_id: 1, id_column: "id'" }],
        ["a field name without a value", { form_id: 1, field_name: "status" }],
        [
            "a repeated field name",
            { form_id: 1, field_name: ["a", "b"], field_value: "x" },
        ],
        [
            "a repeated field value",
            { form_id: 1, field_name: "a", field_value: ["x", "y"] },
        ],
        ["no dataset id", {}],
        ["two dataset ids", { form_id: 1, dataview_id: 2 }],
    ];

    for (const [label, query] of invalid) {
        test(`rejects ${label} as a bad request`, () => {
            assert.throws(() => parse(tile, query), isBadRequest);
        });
    }

    const invalidTiles = [
        ["a negative zoom", { z: -1, x: 0, y: 0 }],
        ["a zoom beyond the supported range", { z: 31, x: 0, y: 0 }],
        ["a column outside the zoom level", { z: 0, x: 1, y: 0 }],
        ["a row outside the zoom level", { z: 1, x: 0, y: 2 }],
        ["a negative column", { z: 3, x: -1, y: 0 }],
        ["a decimal coordinate", { z: 3, x: 1.5, y: 0 }],
        ["a text coordinate", { z: "3; DROP TABLE x", x: 0, y: 0 }],
        ["a missing coordinate", { z: 3, x: 0 }],
    ];

    for (const [label, params] of invalidTiles) {
        test(`rejects ${label} as a bad request`, () => {
            assert.throws(() => parse(params, { form_id: 1 }), isBadRequest);
        });
    }

    test("accepts the last tile of a zoom level", () => {
        assert.doesNotThrow(() => parse({ z: 2, x: 3, y: 3 }, { form_id: 1 }));
    });
});

describe("mvt statement", () => {
    test("binds the forms and tile coordinates instead of inlining them", () => {
        const { text, values } = build(
            tile,
            { form_id: 842230 },
            { xformIds: [842230, 842231], filters: [] },
        );

        assert.doesNotMatch(text, /842230|842231|512|511/);
        assert.deepEqual(values[0], [842230, 842231]);
        for (const value of [10, 512, 511]) {
            assert.ok(values.includes(value), `missing ${value}`);
        }
    });

    test("reads the submissions table only", () => {
        const { text } = build(tile, { dataview_id: 8 });

        assert.doesNotMatch(text, /logger_dataview|logger_mergedxform_xforms/);
    });

    test("applies the dataview filters it is given", () => {
        const filters = [{ column: "status", filter: "=", value: "approved" }];

        const { values } = build(
            tile,
            { dataview_id: 8 },
            { xformIds: [5], filters },
        );

        assert.ok(values.includes("status"));
        assert.ok(values.includes("approved"));
    });

    test("binds the field filter name and value", () => {
        const { text, values } = build(tile, {
            form_id: 1,
            field_name: "status",
            field_value: "approved",
        });

        assert.doesNotMatch(text, /status|approved/);
        assert.ok(values.includes("status"));
        assert.ok(values.includes("approved"));
    });

    test("keeps hostile field filter text out of the statement", () => {
        const hostile = "x' UNION SELECT 1, to_jsonb(p), geom FROM private_notes p --";

        const { text, values } = build(tile, {
            form_id: 1,
            field_name: hostile,
            field_value: hostile,
        });

        assert.doesNotMatch(text, /private_notes|to_jsonb/);
        assert.equal(values.filter((value) => value === hostile).length, 2);
    });

    test("omits the field filter when no field name is given", () => {
        const plain = build(tile, { form_id: 1 });
        const filtered = build(tile, {
            form_id: 1,
            field_name: "status",
            field_value: "approved",
        });

        assert.equal(filtered.values.length, plain.values.length + 2);
    });

    for (const query of [
        { form_id: 1 },
        { dataview_id: 1 },
        { merged_dataset_id: 1 },
        { form_id: 1, field_name: "a", field_value: "b" },
        { form_id: 1, id_column: "id" },
        { form_id: 1, columns: "id, json" },
        {
            form_id: 1,
            field_name: "a",
            field_value: "b",
            id_column: "id",
            columns: "json",
        },
    ]) {
        test(`supplies one value per placeholder for ${JSON.stringify(query)}`, () => {
            const filters = [{ column: "grade", filter: ">", value: "a" }];

            const { text, values } = build(tile, query, {
                xformIds: [1, 2],
                filters,
            });

            assert.deepEqual(placeholders(text), expectedPlaceholders(values));
        });
    }

    test("quotes the table name", () => {
        const { text } = build(tile, { form_id: 1 });

        assert.match(text, /"logger_instance" i\b/);
    });

    test("names the layer after the table through a bound value", () => {
        const { values } = build(tile, { form_id: 1 }, oneForm, {
            ...config,
            tableName: "public.logger_instance",
        });

        assert.ok(values.includes("public.logger_instance"));
    });

    test("quotes a requested id column", () => {
        const { text, values } = build(tile, { form_id: 1, id_column: "id" });

        assert.match(text, /"id"/);
        assert.ok(values.includes("id"));
    });

    test("quotes each requested column", () => {
        const { text } = build(tile, { form_id: 1, columns: "id, json" });

        assert.match(text, /, "id", "json"/);
    });

    test("refuses a table name that is not an identifier", () => {
        assert.throws(
            () =>
                build(tile, { form_id: 1 }, oneForm, {
                    ...config,
                    tableName: "logger_instance; DROP TABLE x",
                }),
            /identifier/,
        );
    });
});
