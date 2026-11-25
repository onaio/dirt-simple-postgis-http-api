const { InvalidRequestError } = require("./errors");

const MAX_ID = 2147483647;
const POSITIVE_INTEGER = /^[1-9][0-9]{0,9}$/;

const PARAMETERS = {
    formId: "form_id",
    dataviewId: "dataview_id",
    mergedDatasetId: "merged_dataset_id",
};

const parseId = (name, value) => {
    const text = typeof value === "number" ? String(value) : value;
    if (
        typeof text !== "string" ||
        !POSITIVE_INTEGER.test(text) ||
        Number(text) > MAX_ID
    ) {
        throw new InvalidRequestError(`${name} must be a positive integer.`);
    }
    return Number(text);
};

// Exactly one id, because the permission check covers one dataset and the
// statement would otherwise read every dataset it is handed.
const parseDataset = (query) => {
    const given = Object.entries(PARAMETERS).filter(
        ([, name]) => query[name] !== undefined,
    );
    if (given.length !== 1) {
        throw new InvalidRequestError(
            "Exactly one of form_id, dataview_id or merged_dataset_id is required.",
        );
    }
    const [[key, name]] = given;

    return {
        formId: null,
        dataviewId: null,
        mergedDatasetId: null,
        [key]: parseId(name, query[name]),
    };
};

module.exports = { parseDataset };
