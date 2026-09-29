const { parseDataset } = require('../lib/dataset')
const { readSubmissions } = require('../lib/reading')
const {
  statement,
  identifier,
  qualifiedName,
  render
} = require('../lib/statement')
const {
  parseFieldFilter,
  submissionConditions
} = require('../lib/submissions')

const NO_BOUNDS = { xmin: null, ymin: null, xmax: null, ymax: null }

const parse = (query) => ({
  dataset: parseDataset(query),
  fieldFilter: parseFieldFilter(query)
})

const sql = ({ fieldFilter }, resolved, config) => {
  const geomColumn = identifier(config.geomColumn)

  return render(statement`
  WITH filtered_data AS (
    SELECT
      i.${geomColumn}
    FROM
      ${qualifiedName(config.tableName)} i
    WHERE
      ${submissionConditions(resolved, fieldFilter)}
      AND i.${geomColumn} is not null
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

module.exports = function (fastify, opts, next) {
  fastify.route({
    method: 'GET',
    url: '/bounds',
    schema: schema,
    handler: async function (request, reply) {
      const boundsRequest = parse(request.query)

      const rows = await readSubmissions({
        pg: fastify.pg,
        request,
        reply,
        dataset: boundsRequest.dataset,
        build: (resolved) => sql(boundsRequest, resolved, opts)
      })
      return reply.send(rows.length > 0 ? rows[0] : NO_BOUNDS)
    }
  })
  next()
}

  module.exports.autoPrefix = '/v1'
  module.exports.parse = parse
  module.exports.sql = sql
