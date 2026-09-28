const { InvalidRequestError } = require("./errors");
const { statement } = require("./statement");

const NO_CONDITION = statement``;

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

const datasetTables = ({ formId, dataviewId, mergedDatasetId }) => statement`
    dataview_filters AS (
      SELECT query
      FROM logger_dataview
      WHERE id = ${dataviewId}::int4
        AND deleted_at IS NULL
    ),
    relevant_xforms AS (
      SELECT xform_id
      FROM logger_dataview
      WHERE id = ${dataviewId}::int4
        AND deleted_at IS NULL

      UNION

      SELECT xform_id
      FROM logger_mergedxform_xforms
      WHERE mergedxform_id = ${mergedDatasetId}::int4

      UNION

      SELECT ${formId}::int4 AS xform_id
      WHERE ${formId}::int4 IS NOT NULL
    )`;

const fieldCondition = (fieldFilter) =>
    fieldFilter === null
        ? NO_CONDITION
        : statement`AND i.json->>${fieldFilter.name}::text = ${fieldFilter.value}::text`;

// IS NOT TRUE, not NOT: a submission without the filtered field compares to
// NULL, and must be dropped the way the dataview itself drops it.
const datasetConditions = ({ dataviewId }, fieldFilter) => statement`
      AND (
        ${dataviewId}::int4 IS NULL
        OR NOT EXISTS (
          SELECT 1
          FROM dataview_filters df,
               jsonb_array_elements(df.query) AS filter
          WHERE (
            CASE filter->>'filter'
              WHEN '=' THEN i.json->>(filter->>'column') = filter->>'value'
              WHEN '>' THEN i.json->>(filter->>'column') > filter->>'value'
              WHEN '<' THEN i.json->>(filter->>'column') < filter->>'value'
              WHEN '>=' THEN i.json->>(filter->>'column') >= filter->>'value'
              WHEN '<=' THEN i.json->>(filter->>'column') <= filter->>'value'
              WHEN '!=' THEN i.json->>(filter->>'column') != filter->>'value'
              ELSE false
            END
          ) IS NOT TRUE
        )
      )
      ${fieldCondition(fieldFilter)}`;

module.exports = { parseFieldFilter, datasetTables, datasetConditions };
