// route query
require("dotenv").config()

const sql = (params, query) => {
  return `
  WITH dataview_filters AS (
    -- Get dataview query filters if dataview_id is provided
    SELECT query
    FROM logger_dataview
    WHERE id = ${query.dataview_id || 'NULL'}
      AND deleted_at IS NULL
  ),
  relevant_xforms AS (
    -- Case 1: If dataview_id is provided, get its xform_id
    SELECT xform_id
    FROM logger_dataview
    WHERE id = ${query.dataview_id || 'NULL'}
      AND deleted_at IS NULL

    UNION

    -- Case 2: If merged_dataset_id is provided, get all constituent xforms
    SELECT xform_id
    FROM logger_mergedxform_xforms
    WHERE mergedxform_id = ${query.merged_dataset_id || 'NULL'}

    UNION

    -- Case 3: If form_id is provided, use it directly
    SELECT ${query.form_id || 'NULL'} AS xform_id
    WHERE ${query.form_id || 'NULL'} IS NOT NULL
  ),
  filtered_data AS (
    SELECT
      i.${process.env.TABLE_COLUMN}
    FROM
      ${process.env.TABLE_NAME} i
      INNER JOIN relevant_xforms xf ON i.xform_id = xf.xform_id
    WHERE
      i.deleted_at is null
      AND i.geom is not null
      -- Validate geometry before processing
      AND ST_IsValid(i.geom)
      -- Check coordinate range for valid bounds
      AND ST_Y(ST_Centroid(i.geom)) BETWEEN -85.0511 AND 85.0511
      AND ST_X(ST_Centroid(i.geom)) BETWEEN -180 AND 180
      -- Apply dataview filters if dataview_id was provided
      AND (
        ${query.dataview_id || 'NULL'} IS NULL
        OR NOT EXISTS (
          SELECT 1
          FROM dataview_filters df,
               jsonb_array_elements(df.query) AS filter
          WHERE NOT (
            CASE filter->>'filter'
              WHEN '=' THEN i.json->>(filter->>'column') = filter->>'value'
              WHEN '>' THEN i.json->>(filter->>'column') > filter->>'value'
              WHEN '<' THEN i.json->>(filter->>'column') < filter->>'value'
              WHEN '>=' THEN i.json->>(filter->>'column') >= filter->>'value'
              WHEN '<=' THEN i.json->>(filter->>'column') <= filter->>'value'
              WHEN '!=' THEN i.json->>(filter->>'column') != filter->>'value'
              ELSE false
            END
          )
        )
      )
      -- Optional field name/value filter
      ${query.field_name ? `AND i.json->>'${query.field_name}'='${query.field_value}'` : ''}
  )
  SELECT
    ST_XMin(bbox) AS xMin,
    ST_YMin(bbox) AS yMin,
    ST_XMax(bbox) AS xMax,
    ST_YMax(bbox) AS yMax
  FROM (
    SELECT ST_Extent(${process.env.TABLE_COLUMN}) AS bbox
    FROM filtered_data
  ) AS subquery;
  `
}

 // route schema
const schema = {
  description:
    'Returns forms map bounds',
  tags: ['feature'],
  summary: 'Return bounds',
  querystring: {
    form_id: {
      type: 'integer',
      description: 'ID of a regular form to query data from.',
    },
    merged_dataset_id: {
      type: 'integer',
      description: 'ID of a merged dataset to query data from all constituent forms.',
    },
    dataview_id: {
      type: 'integer',
      description: 'ID of a dataview to query data with applied filters.',
    },
    field_name: {
      type: 'string',
      description: 'Optional field name for custom JSON filtering.',
    },
    field_value: {
      type: 'string',
      description: 'Optional field value for custom JSON filtering (used with field_name).',
    },
    limit: {
      type: 'string',
      description: 'Optional rows limit count.'
    }
  }
}
  
// create route
module.exports = function (fastify, opts, next) {
  fastify.route({
    method: 'GET',
    url: '/bounds',
    schema: schema,
    handler: function (request, reply) {
      let queryAborted = false
      let pgClient = null

      // Cancel query if client disconnects
      request.raw.on('close', () => {
        if (!reply.sent && pgClient) {
          queryAborted = true
          request.log.warn('Client disconnected, canceling query')
          // Cancel the running query
          pgClient.cancel().catch(err => {
            request.log.error('Error canceling query:', err)
          })
        }
      })

      fastify.pg.connect(onConnect)

      function onConnect(err, client, release) {
        if (err) {
          request.log.error(err)
          return reply.code(500).send({ error: "Database connection error." })
        }

        pgClient = client

        // If already aborted, don't run query
        if (queryAborted) {
          release()
          return
        }

        client.query(
          sql(request.params, request.query),
          function onResult(err, result) {
            release()

            // Don't send response if already aborted
            if (queryAborted) {
              return
            }

            if (err) {
              return reply.code(400).send({ error: err.message })
            } else {
              if(result.rows?.length > 0) {
                return reply.send(result.rows[0])
              } else {
                return reply.code(404).send({error: 'No data found' });
              }
            }
          }
        )
      }
    }
  })
  next()
}
  
  module.exports.autoPrefix = '/v1'
  module.exports.sql = sql
