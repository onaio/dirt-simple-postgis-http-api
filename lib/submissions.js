const { InvalidRequestError } = require("./errors");
const { statement, concat, render } = require("./statement");

const NO_CONDITION = statement``;
const NEVER = statement`
      AND false`;
const NO_FORMS = { xformIds: [], filters: [] };

const COMPARISONS = {
    "=": (column, value) =>
        statement`
      AND i.json->>${column}::text = ${value}::text`,
    ">": (column, value) =>
        statement`
      AND i.json->>${column}::text > ${value}::text`,
    "<": (column, value) =>
        statement`
      AND i.json->>${column}::text < ${value}::text`,
    ">=": (column, value) =>
        statement`
      AND i.json->>${column}::text >= ${value}::text`,
    "<=": (column, value) =>
        statement`
      AND i.json->>${column}::text <= ${value}::text`,
    "!=": (column, value) =>
        statement`
      AND i.json->>${column}::text != ${value}::text`,
};

const parseFieldFilter = ({ field_name: name, field_value: value }) => {
    if (name === undefined || name === "") {
        return null;
    }
    if (typeof name !== "string" || typeof value !== "string") {
        throw new InvalidRequestError(
            "field_name and field_value must each be given once, together.",
        );
    }
    return { name, value };
};

// Filters are read as text, the way ->> reads them, and a query that is
// neither a list nor an empty object is reported as unreadable.
const dataviewLookup = (dataviewId) => statement`
    SELECT
      xform_id,
      (jsonb_typeof(query) = 'array' OR query = '{}'::jsonb) AS readable,
      (
        SELECT coalesce(
          jsonb_agg(
            jsonb_build_object(
              'column', filter->>'column',
              'filter', filter->>'filter',
              'value', filter->>'value'
            )
            ORDER BY position
          ),
          '[]'::jsonb
        )
        FROM jsonb_array_elements(
          CASE WHEN jsonb_typeof(query) = 'array' THEN query ELSE '[]'::jsonb END
        ) WITH ORDINALITY AS listed (filter, position)
      ) AS filters
    FROM logger_dataview
    WHERE id = ${dataviewId}::int4
      AND deleted_at IS NULL`;

const mergedDatasetLookup = (mergedDatasetId) => statement`
    SELECT xform_id
    FROM logger_mergedxform_xforms
    WHERE mergedxform_id = ${mergedDatasetId}::int4`;

const datasetLookup = ({ dataviewId, mergedDatasetId }) => {
    if (dataviewId !== null) {
        return render(dataviewLookup(dataviewId));
    }
    if (mergedDatasetId !== null) {
        return render(mergedDatasetLookup(mergedDatasetId));
    }
    return null;
};

const readDataview = ([dataview]) =>
    dataview !== undefined && dataview.readable === true
        ? { xformIds: [dataview.xform_id], filters: dataview.filters }
        : NO_FORMS;

const readDataset = ({ formId, dataviewId }, rows) => {
    if (formId !== null) {
        return { xformIds: [formId], filters: [] };
    }
    if (dataviewId !== null) {
        return readDataview(rows);
    }
    return { xformIds: rows.map((row) => row.xform_id), filters: [] };
};

const isUsable = (filter) =>
    filter !== null &&
    typeof filter === "object" &&
    typeof filter.column === "string" &&
    typeof filter.value === "string" &&
    typeof filter.filter === "string" &&
    Object.hasOwn(COMPARISONS, filter.filter);

// A filter that cannot be applied hides every submission instead of none.
const comparison = (filter) =>
    isUsable(filter)
        ? COMPARISONS[filter.filter](filter.column, filter.value)
        : NEVER;

const fieldCondition = (fieldFilter) =>
    fieldFilter === null
        ? NO_CONDITION
        : statement`
      AND i.json->>${fieldFilter.name}::text = ${fieldFilter.value}::text`;

// The forms are bound as values the planner can see, which is what lets it
// read only their partitions.
const submissionConditions = ({ xformIds, filters }, fieldFilter) => statement`
      i.xform_id = ANY(${xformIds}::int4[])
      AND i.deleted_at is null${concat(filters.map(comparison))}${fieldCondition(fieldFilter)}`;

module.exports = {
    parseFieldFilter,
    datasetLookup,
    readDataset,
    submissionConditions,
};
