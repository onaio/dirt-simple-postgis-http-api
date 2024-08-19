// route query
require("dotenv").config()

const sql = (params, query) => {
  return `
  SELECT
    ST_XMin(bbox) AS xMin,
    ST_YMin(bbox) AS yMin,
    ST_XMax(bbox) AS xMax,
    ST_YMax(bbox) AS yMax
  FROM (
    SELECT ST_Extent(${process.env.TABLE_COLUMN}) AS bbox
    FROM (
      SELECT ${process.env.TABLE_COLUMN}
      FROM ${process.env.TABLE_NAME}
      WHERE ${`xform_id=${query.form_id} AND geom is not null AND deleted_at is null`}

      -- Optional row LIMIT
      ${query.limit ? `LIMIT ${query.limit}` : '' }
    ) As limited_rows
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
      type: 'string',
      description: 'Form id',
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
      fastify.pg.connect(onConnect)

      function onConnect(err, client, release) {
        if (err) {
          request.log.error(err)
          return reply.code(500).send({ error: "Database connection error." })
        }

        client.query(
          sql(request.params, request.query),
          function onResult(err, result) {
            release()
            if (err) {
              reply.code(400).send(err)
            } else {
              if(result.rows?.length > 0) {
                reply.send(result.rows[0])
              } else {
                reply.code(404).send({error: 'No data found' });
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
  