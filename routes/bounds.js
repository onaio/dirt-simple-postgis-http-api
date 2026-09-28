const { parseDataset } = require('../lib/dataset')
const {
  statement,
  identifier,
  qualifiedName,
  render
} = require('../lib/statement')
const {
  parseFieldFilter,
  datasetTables,
  datasetConditions
} = require('../lib/submissions')

const sql = (params, query, config) => {
  const dataset = parseDataset(query)
  const fieldFilter = parseFieldFilter(query)
  const geomColumn = identifier(config.geomColumn)

  return render(statement`
  WITH ${datasetTables(dataset)},
  filtered_data AS (
    SELECT
      i.${geomColumn}
    FROM
      ${qualifiedName(config.tableName)} i
      INNER JOIN relevant_xforms xf ON i.xform_id = xf.xform_id
    WHERE
      i.deleted_at is null
      AND i.${geomColumn} is not null
      ${datasetConditions(dataset, fieldFilter)}
  )
  SELECT
    ST_XMin(bbox) AS xMin,
    ST_YMin(bbox) AS yMin,
    ST_XMax(bbox) AS xMax,
    ST_YMax(bbox) AS yMax
  FROM (
    SELECT ST_Extent(${geomColumn}) AS bbox
    FROM filtered_data
  ) AS subquery;
  `)
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
      maxLength: 1024,
      description: 'Optional field name for custom JSON filtering.',
    },
    field_value: {
      type: 'string',
      maxLength: 4096,
      description: 'Optional field value for custom JSON filtering (used with field_name).',
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
      const { text, values } = sql(request.params, request.query, opts)

      fastify.pg.connect(onConnect)

      function onConnect(err, client, release) {
        if (err) {
          request.log.error(err)
          return reply.code(500).send({ error: "Database connection error." })
        }

        client.query(
          text,
          values,
          function onResult(err, result) {
            release()
            if (err) {
              request.log.error(err)
              return reply.code(500).send({ error: 'Query failed.' })
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
