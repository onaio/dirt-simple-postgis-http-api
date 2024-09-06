// route query
require("dotenv").config()
const QueryStream = require('pg-query-stream')
const { pipeline, Transform } = require('stream');

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
        ${params.z == 0 && params.x == 0 && params.y == 0 ? `
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

// create route
module.exports = function (fastify, opts, next) {
  fastify.route({
    method: 'GET',
    url: '/mvt/:z/:x/:y',
    schema: schema,
    handler: function (request, reply) {
      fastify.pg.connect(onConnect)

      function onConnect(err, client, release) {
        if (err) {
          request.log.error(err)
          return reply.code(500).send({ error: "Database connection error." })
        }

        // client.query(sql(request.params, request.query), function onResult(
        //   err,
        //   result
        // ) {
        //   release()
        //   if (err) {
        //     reply.send(err)
        //   } else {
        //     const mvt = result.rows[0].mvt
        //     if (mvt.length === 0) {
        //       reply.code(204).send()
        //     }
        //     reply.header('Content-Type', 'application/x-protobuf').send(mvt)
        //   }
        // })
       

        // Create a streaming query
        const queryStream = new QueryStream(sql(request.params, request.query));

        // Execute the query as a stream
        const stream = client.query(queryStream);

        // Ensure the client is released once streaming is done
        stream.on('end', () => {
          release()
        });

        // Handle database errors during streaming
        stream.on('error', (_) => {
          release();
          reply.code(500).send({ error: 'Database query error.' });
        });

        // Create a transform stream to convert objects to Buffers
        const transformToBuffer = new Transform({
          objectMode: true,
          transform(row, encoding, callback) {
            const rawMvt = row.mvt
            const mvtBuffer = Buffer.from(rawMvt, 'binary');
            callback(null, mvtBuffer);
          }
        });

        // Handle transform stream errors
        // transformToBuffer.on('error', (transformErr) => {
        //   console.log("____",transformErr);
        //   reply.code(500).send({ error: 'Transform error.' });
        // });


        // Stream the data to the client
        pipeline(stream, transformToBuffer, reply.raw, (pipelineErr) => {
          if (pipelineErr) {
            request.log.error(pipelineErr);
            reply.code(500).send({ error: 'Streaming error.' });
          }
        });

      }
    }
  })
  next()
}

module.exports.autoPrefix = '/v1'
