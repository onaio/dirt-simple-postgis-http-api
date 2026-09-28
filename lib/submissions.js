const { InvalidRequestError } = require("./errors");
const { statement, render } = require("./statement");
const { filterConditions } = require("./filters");

const NO_CONDITION = statement``;
const NO_FORMS = { xformIds: [], filters: [] };

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

// Filters are read as text, the way ->> reads them, each with the type its
// field has in the definition of the form. A field is found by its path: its
// own name after those of the groups around it.
//
// A query that is neither a list nor an empty object is reported as
// unreadable. So are filters whose form has no definition to read the types
// from, because a number compared as text keeps rows the filter leaves out.
//
// Only the fields the filters name are looked for. Walking the whole
// definition is costed so highly that PostgreSQL compiles the statement
// first, which takes longer than running it.
//
// The definition is read when it is first asked for, so whether there are
// filters is asked before whether it can be read.
const dataviewLookup = (dataviewId) => statement`
    WITH dataview AS (
      SELECT xform_id, query
      FROM logger_dataview
      WHERE id = ${dataviewId}::int4
        AND deleted_at IS NULL
    ), listed AS (
      SELECT filter, position
      FROM dataview, jsonb_array_elements(
        CASE WHEN jsonb_typeof(query) = 'array' THEN query ELSE '[]'::jsonb END
      ) WITH ORDINALITY AS listed (filter, position)
    ), stored AS MATERIALIZED (
      SELECT form.json::jsonb AS definition
      FROM logger_xform form
      JOIN dataview ON dataview.xform_id = form.id
    ), survey AS MATERIALIZED (
      SELECT
        CASE WHEN jsonb_typeof(definition) = 'string'
          THEN (definition #>> '{}')::jsonb
          ELSE definition
        END -> 'children' AS fields
      FROM stored
    )
    SELECT
      dataview.xform_id,
      CASE WHEN jsonb_typeof(dataview.query) = 'array'
        THEN NOT EXISTS (SELECT FROM listed)
          OR EXISTS (SELECT FROM survey WHERE jsonb_typeof(fields) = 'array')
        ELSE dataview.query = '{}'::jsonb
      END AS readable,
      (
        SELECT coalesce(
          jsonb_agg(
            jsonb_build_object(
              'column', filter->>'column',
              'filter', filter->>'filter',
              'value', filter->>'value',
              'condition', filter->>'condition',
              'type', (
                SELECT found #>> '{}'
                FROM survey,
                  LATERAL (
                    SELECT
                      (
                        '$' || string_agg(
                          CASE WHEN depth > 1 THEN '.children' ELSE '' END
                            || '[*] ? (@.name == $name' || depth || ')',
                          '' ORDER BY depth
                        ) || '.type'
                      )::jsonpath AS path,
                      jsonb_object_agg('name' || depth, name) AS names
                    FROM unnest(string_to_array(filter->>'column', '/'))
                      WITH ORDINALITY AS named (name, depth)
                  ) AS walk,
                  jsonb_path_query(survey.fields, walk.path, walk.names) AS found
                WHERE jsonb_typeof(survey.fields) = 'array'
                ORDER BY array_position(
                  ARRAY['integer', 'date', 'decimal'], found #>> '{}'
                ) NULLS LAST
                LIMIT 1
              )
            )
            ORDER BY position
          ),
          '[]'::jsonb
        )
        FROM listed
      ) AS filters
    FROM dataview`;

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

const fieldCondition = (fieldFilter) =>
    fieldFilter === null
        ? NO_CONDITION
        : statement`
      AND i.json->>${fieldFilter.name}::text = ${fieldFilter.value}::text`;

// The forms are bound as values the planner can see, which is what lets it
// read only their partitions.
const submissionConditions = ({ xformIds, filters }, fieldFilter) => statement`
      i.xform_id = ANY(${xformIds}::int4[])
      AND i.deleted_at is null${filterConditions(filters)}${fieldCondition(fieldFilter)}`;

module.exports = {
    parseFieldFilter,
    datasetLookup,
    readDataset,
    submissionConditions,
};
