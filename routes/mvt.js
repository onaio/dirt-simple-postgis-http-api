// route query
require("dotenv").config();

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
    mvtgeom2 as (
      SELECT
        i.id,
        i.json,
        i.geom
      FROM
        ${process.env.TABLE_NAME} i
        INNER JOIN relevant_xforms xf ON i.xform_id = xf.xform_id
      WHERE
        i.deleted_at is null
        AND i.geom is not null
        -- Spatial filter BEFORE transform to use spatial index
        -- Use && operator for bounding box intersection (uses GIST index)
        AND i.geom && ST_Transform(
          ST_TileEnvelope(${params.z}, ${params.x}, ${params.y}),
          ST_SRID(i.geom)
        )
        -- Validate geometry before transformation
        AND ST_IsValid(i.geom)
        -- Check coordinate range for Web Mercator compatibility (EPSG:3857)
        -- Web Mercator valid range: lat between -85.0511 and 85.0511
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
    ), mvtgeom as (
      SELECT
        ST_AsMVTGeom (geom, ST_TileEnvelope (${params.z}, ${params.x}, ${params.y})) as geom,
          id,
          json
          ${query.columns ? `, ${query.columns}` : ""}
          ${query.id_column ? `, ${query.id_column}` : ""}
      FROM
        (
          SELECT
              id,
              json,
              ST_Transform (geom, 3857) as geom
          FROM
            mvtgeom2
        ) transformed_geom
      WHERE geom IS NOT NULL
    )
    SELECT ST_AsMVT(mvtgeom.*, '${process.env.TABLE_NAME}', 4096, 'geom' ${
        query.id_column ? `, '${query.id_column}'` : ""
    }) AS mvt from mvtgeom;
  `;
};

// route schema
const schema = {
    description:
        "Return table as Mapbox Vector Tile (MVT). The layer name returned is the name of the table.",
    tags: ["feature"],
    summary: "return MVT",
    params: {
        table: {
            type: "string",
            description: "The name of the table or view.",
        },
        z: {
            type: "integer",
            description: "Z value of ZXY tile.",
        },
        x: {
            type: "integer",
            description: "X value of ZXY tile.",
        },
        y: {
            type: "integer",
            description: "Y value of ZXY tile.",
        },
    },
    querystring: {
        geom_column: {
            type: "string",
            description:
                "Optional geometry column of the table. The default is geom.",
            default: "geom",
        },
        columns: {
            type: "string",
            description:
                "Optional columns to return with MVT. The default is no columns.",
        },
        id_column: {
            type: "string",
            description:
                "Optional id column name to be used with Mapbox GL Feature State. This column must be an integer a string cast as an integer.",
        },
        filter: {
            type: "string",
            description:
                "Optional filter parameters for a SQL WHERE statement.",
        },
        form_id: {
            type: "integer",
            description: "ID of a regular form to query data from.",
        },
        merged_dataset_id: {
            type: "integer",
            description:
                "ID of a merged dataset to query data from all constituent forms.",
        },
        dataview_id: {
            type: "integer",
            description:
                "ID of a dataview to query data with applied filters.",
        },
        field_name: {
            type: "string",
            description: "Optional field name for custom JSON filtering.",
        },
        field_value: {
            type: "string",
            description:
                "Optional field value for custom JSON filtering (used with field_name).",
        },
    },
};

// create route
module.exports = function (fastify, opts, next) {
    fastify.route({
        method: "GET",
        url: "/mvt/:z/:x/:y",
        schema: schema,
        handler: function (request, reply) {
            fastify.pg.connect(onConnect);

            function onConnect(err, client, release) {
                if (err) {
                    request.log.error(err);
                    return reply
                        .code(500)
                        .send({ error: "Database connection error." });
                }

                client.query(
                    sql(request.params, request.query),
                    function onResult(err, result) {
                        release();
                        if (err) {
                            return reply.code(400).send({ error: err.message });
                        } else {
                            const mvt = result.rows[0].mvt;
                            if (mvt.length === 0) {
                                return reply.code(204).send();
                            }
                            reply
                                .header(
                                    "Content-Type",
                                    "application/x-protobuf",
                                )
                                .send(mvt);
                        }
                    },
                );
            }
        },
    });
    next();
};

module.exports.autoPrefix = "/v1";
module.exports.sql = sql;
