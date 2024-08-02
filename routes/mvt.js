// route query
require("dotenv").config()

const { createClient } = require('redis');
const crypto = require('crypto');

const sql = (params, query) => {
  return `
    WITH mvtgeom2 as (
      SELECT
        id,
        json,
        geom
      FROM
        ${process.env.TABLE_NAME}
      WHERE
        ${`xform_id=${query.form_id} AND geom is not null AND deleted_at is null`}
    ), mvtgeom as (
      SELECT
        ST_AsMVTGeom (geom, ST_TileEnvelope (${params.z}, ${params.x}, ${params.y})) as geom,
          id,
          json
          ${query.columns ? `, ${query.columns}` : ''}
          ${query.id_column ? `, ${query.id_column}` : ''}
      FROM
        (
          SELECT
              id,
              json,
              ST_Transform (geom, 3857) as geom
          FROM
            mvtgeom2
        ) transformed_geom

        -- Add where clause only when filtering by bounds
        ${String(params.z) == '0' && String(params.x) == '0' && String(params.y) == '0' ? `
        WHERE
          ST_Intersects(
            ${process.env.TABLE_COLUMN},
            ST_TileEnvelope(${params.z}, ${params.x}, ${params.y})
            )`: ``}

          -- Optional Filter
          ${query.field_name ? `AND json->>'${query.field_name}'='${query.field_value}'` : ``}
    )
    SELECT ST_AsMVT(mvtgeom.*, '${process.env.TABLE_NAME}', 4096, 'geom' ${query.id_column ? `, '${query.id_column}'` : ''
    }) AS mvt from mvtgeom;
  `
}

// route schema
const schema = {
  description:
    'Return table as Mapbox Vector Tile (MVT). The layer name returned is the name of the table.',
  tags: ['feature'],
  summary: 'return MVT',
  params: {
    table: {
      type: 'string',
      description: 'The name of the table or view.'
    },
    z: {
      type: 'integer',
      description: 'Z value of ZXY tile.'
    },
    x: {
      type: 'integer',
      description: 'X value of ZXY tile.'
    },
    y: {
      type: 'integer',
      description: 'Y value of ZXY tile.'
    }
  },
  querystring: {
    geom_column: {
      type: 'string',
      description: 'Optional geometry column of the table. The default is geom.',
      default: 'geom'
    },
    columns: {
      type: 'string',
      description:
        'Optional columns to return with MVT. The default is no columns.'
    },
    id_column: {
      type: 'string',
      description:
        'Optional id column name to be used with Mapbox GL Feature State. This column must be an integer a string cast as an integer.'
    },
    filter: {
      type: 'string',
      description: 'Optional filter parameters for a SQL WHERE statement.'
    }
  }
}

const initializeRedis = async () => {
  const client = createClient();

  client.on('error', err => console.log('Redis Client Error', err));

  return client.connect();
}

// cache results for at least 2 minutes
const cacheResults = async (params, results) => {
  client = await initializeRedis()
  client.set(params, results)
}

const getCachedResults = async (cacheKey) => {
  client = await initializeRedis()
  return await client.get(cacheKey)
}


// Function to merge two objects and generate a hash
function mergeAndHash(params, query) {
    const mergedObject = { ...params, ...query };
    const jsonString = JSON.stringify(mergedObject);
    const hash = crypto.createHash('sha256').update(jsonString).digest('hex');

    return hash;
}

function arrayBufferToBase64(buffer) {
  return Buffer.from(buffer).toString('base64');
}


// create route
module.exports = function (fastify, opts, next) {
  fastify.route({
    method: 'GET',
    url: '/mvt/:z/:x/:y',
    schema: schema,
    handler: function (request, reply) {
      // check redis to see if we have cached something already
      cacheKey = mergeAndHash(request.params, request.query)
      getCachedResults(cacheKey).then((
        cacheResult
      )=> {
        if (cacheResult == null) {
          fastify.pg.connect(onConnect)
        } else {
          reply.header('Content-Type', 'application/x-protobuf').send(Buffer.from(cacheResults, 'base64').buffer)
        }
      }
      ).catch((error) => {
        console.log(error)
      } )


      function onConnect(err, client, release) {
        if (err) {
          request.log.error(err)
          return reply.code(500).send({ error: "Database connection error." })
        }

        client.query(sql(request.params, request.query), function onResult(
          err,
          result
        ) {
          release()
          if (err) {
            reply.send(err)
          } else {
            const mvt = result.rows[0].mvt
            cacheResults(cacheKey, arrayBufferToBase64(mvt))
            if (mvt.length === 0) {
              reply.code(204).send()
            }
            reply.header('Content-Type', 'application/x-protobuf').send(mvt)
          }
        })
      }
    }
  })
  next()
}

module.exports.autoPrefix = '/v1'
