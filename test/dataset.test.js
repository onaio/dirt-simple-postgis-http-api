const { describe, test } = require("node:test");
const assert = require("node:assert/strict");

const { parseDataset } = require("../lib/dataset");

const isBadRequest = (error) => error.statusCode === 400;

describe("parseDataset", () => {
    test("reads a form id", () => {
        assert.deepEqual(parseDataset({ form_id: 7 }), {
            formId: 7,
            dataviewId: null,
            mergedDatasetId: null,
        });
    });

    test("reads a dataview id", () => {
        assert.deepEqual(parseDataset({ dataview_id: 7 }), {
            formId: null,
            dataviewId: 7,
            mergedDatasetId: null,
        });
    });

    test("reads a merged dataset id", () => {
        assert.deepEqual(parseDataset({ merged_dataset_id: 7 }), {
            formId: null,
            dataviewId: null,
            mergedDatasetId: 7,
        });
    });

    test("reads an id given as a digit string", () => {
        assert.equal(parseDataset({ form_id: "842230" }).formId, 842230);
    });

    test("accepts the largest 32-bit integer", () => {
        assert.equal(
            parseDataset({ form_id: "2147483647" }).formId,
            2147483647,
        );
    });

    test("ignores unrelated parameters", () => {
        assert.equal(
            parseDataset({ form_id: 7, temp_token: "abc", field_name: "x" })
                .formId,
            7,
        );
    });

    const invalid = [
        ["no dataset id", {}],
        ["two dataset ids", { form_id: 1, dataview_id: 2 }],
        ["a form and a merged dataset", { form_id: 1, merged_dataset_id: 2 }],
        [
            "all three dataset ids",
            { form_id: 1, dataview_id: 2, merged_dataset_id: 3 },
        ],
        ["a second id that is empty", { form_id: 1, dataview_id: "" }],
        ["a path traversal id", { form_id: "../../users" }],
        ["an id with trailing text", { form_id: "7abc" }],
        ["an id with leading whitespace", { form_id: " 7" }],
        ["a signed id", { form_id: "+7" }],
        ["a negative id", { form_id: -7 }],
        ["a zero id", { form_id: 0 }],
        ["a decimal id", { form_id: 7.5 }],
        ["an exponent id", { form_id: "1e3" }],
        ["a hexadecimal id", { form_id: "0x10" }],
        ["an id beyond the integer range", { form_id: 2147483648 }],
        ["an empty id", { form_id: "" }],
        ["a repeated id", { form_id: ["7", "8"] }],
        ["a single-element array id", { form_id: ["7"] }],
        ["an object id", { form_id: { a: 1 } }],
        ["a boolean id", { form_id: true }],
        ["a null id", { form_id: null }],
        ["a NaN id", { form_id: NaN }],
    ];

    for (const [label, query] of invalid) {
        test(`rejects ${label} as a bad request`, () => {
            assert.throws(() => parseDataset(query), isBadRequest);
        });
    }
});
