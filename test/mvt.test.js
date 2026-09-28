const { describe, test } = require("node:test");
const assert = require("node:assert/strict");

const { sql } = require("../routes/mvt");
const { placeholders, expectedPlaceholders } = require("./helpers/statements");

const config = { tableName: "logger_instance", geomColumn: "geom" };
const tile = { z: 10, x: 512, y: 511 };
const isBadRequest = (error) => error.statusCode === 400;

describe("mvt statement", () => {
    test("binds the form id and tile coordinates instead of inlining them", () => {
        const { text, values } = sql(tile, { form_id: 842230 }, config);

        assert.doesNotMatch(text, /842230|512|511/);
        for (const value of [842230, 10, 512, 511]) {
            assert.ok(values.includes(value), `missing ${value}`);
        }
    });

    test("binds the merged dataset id", () => {
        const { text, values } = sql(
            tile,
            { merged_dataset_id: 852601 },
            config,
        );

        assert.doesNotMatch(text, /852601/);
        assert.ok(values.includes(852601));
    });

    test("binds the dataview id", () => {
        const { text, values } = sql(tile, { dataview_id: 12345 }, config);

        assert.doesNotMatch(text, /12345/);
        assert.ok(values.includes(12345));
    });

    test("binds the field filter name and value", () => {
        const { text, values } = sql(
            tile,
            { form_id: 1, field_name: "status", field_value: "approved" },
            config,
        );

        assert.doesNotMatch(text, /status|approved/);
        assert.ok(values.includes("status"));
        assert.ok(values.includes("approved"));
    });

    test("keeps hostile field filter text out of the statement", () => {
        const hostile = "x' UNION SELECT 1, to_jsonb(p), geom FROM private_notes p --";

        const { text, values } = sql(
            tile,
            { form_id: 1, field_name: hostile, field_value: hostile },
            config,
        );

        assert.doesNotMatch(text, /private_notes|to_jsonb/);
        assert.equal(values.filter((value) => value === hostile).length, 2);
    });

    test("omits the field filter when no field name is given", () => {
        const { text } = sql(tile, { form_id: 1 }, config);
        const filtered = sql(
            tile,
            { form_id: 1, field_name: "status", field_value: "approved" },
            config,
        ).text;

        assert.notEqual(text, filtered);
    });

    test("ignores a field value given without a field name", () => {
        const unfiltered = sql(tile, { form_id: 1 }, config);
        const valueOnly = sql(tile, { form_id: 1, field_value: "x" }, config);
        const emptyName = sql(
            tile,
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
            const { text, values } = sql(tile, query, config);

            assert.deepEqual(placeholders(text), expectedPlaceholders(values));
        });
    }

    test("quotes the table name", () => {
        const { text } = sql(tile, { form_id: 1 }, config);

        assert.match(text, /"logger_instance" i\b/);
    });

    test("names the layer after the table through a bound value", () => {
        const { values } = sql(
            tile,
            { form_id: 1 },
            { ...config, tableName: "public.logger_instance" },
        );

        assert.ok(values.includes("public.logger_instance"));
    });

    test("quotes a requested id column", () => {
        const { text, values } = sql(
            tile,
            { form_id: 1, id_column: "id" },
            config,
        );

        assert.match(text, /"id"/);
        assert.ok(values.includes("id"));
    });

    test("quotes each requested column", () => {
        const { text } = sql(tile, { form_id: 1, columns: "id, json" }, config);

        assert.match(text, /, "id", "json"/);
    });

    test("reads requested column names without regard to case", () => {
        const { text, values } = sql(
            tile,
            { form_id: 1, columns: "ID,Json", id_column: "Id" },
            config,
        );

        assert.match(text, /, "id", "json", "id"/);
        assert.ok(values.includes("id"));
        assert.ok(!values.includes("Id"));
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
            assert.throws(() => sql(tile, query, config), isBadRequest);
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
            assert.throws(
                () => sql(params, { form_id: 1 }, config),
                isBadRequest,
            );
        });
    }

    test("accepts the last tile of a zoom level", () => {
        assert.doesNotThrow(() =>
            sql({ z: 2, x: 3, y: 3 }, { form_id: 1 }, config),
        );
    });

    test("refuses a table name that is not an identifier", () => {
        assert.throws(
            () =>
                sql(
                    tile,
                    { form_id: 1 },
                    { ...config, tableName: "logger_instance; DROP TABLE x" },
                ),
            /identifier/,
        );
    });
});
