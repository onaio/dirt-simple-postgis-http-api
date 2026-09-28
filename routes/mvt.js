const { InvalidRequestError } = require("../lib/errors");
const { parseDataset } = require("../lib/dataset");
const {
    statement,
    identifier,
    qualifiedName,
    concat,
    render,
} = require("../lib/statement");
const {
    parseFieldFilter,
    datasetTables,
    datasetConditions,
} = require("../lib/submissions");

// Keeps x and y within a 32-bit integer.
const MAX_ZOOM = 30;

const parseTile = ({ z, x, y }) => {
    const named =
        [z, x, y].every(Number.isInteger) &&
        z >= 0 &&
        z <= MAX_ZOOM &&
        x >= 0 &&
        y >= 0 &&
        x < 2 ** z &&
        y < 2 ** z;
    if (!named) {
        throw new InvalidRequestError("z, x and y must name a tile.");
    }
    return { z, x, y };
};

// The columns the statement below has to offer.
const SELECTABLE = ["id", "json", "geom"];

const isSelectable = (name) => SELECTABLE.includes(name);

const normalize = (name) => name.trim().toLowerCase();

const parseColumns = (columns) => {
    if (columns === undefined || columns === "") {
        return [];
    }
    const names =
        typeof columns === "string" ? columns.split(",").map(normalize) : [];
    if (names.length === 0 || !names.every(isSelectable)) {
        throw new InvalidRequestError(
            `columns must be a comma-separated list of ${SELECTABLE.join(", ")}.`,
        );
    }
    return names;
};

const parseIdColumn = (idColumn) => {
    if (idColumn === undefined || idColumn === "") {
        return null;
    }
    if (typeof idColumn !== "string" || !isSelectable(normalize(idColumn))) {
        throw new InvalidRequestError(
            `id_column must be one of ${SELECTABLE.join(", ")}.`,
        );
    }
    return normalize(idColumn);
};

const sql = (params, query, config) => {
    const tile = parseTile(params);
    const dataset = parseDataset(query);
    const fieldFilter = parseFieldFilter(query);
    const idColumn = parseIdColumn(query.id_column);
    const selected = [
        ...parseColumns(query.columns),
        ...(idColumn === null ? [] : [idColumn]),
    ];

    const envelope = statement`ST_TileEnvelope(${tile.z}::int4, ${tile.x}::int4, ${tile.y}::int4)`;
    const selectedColumns = concat(
        selected.map((name) => statement`, ${identifier(name)}`),
    );
    const featureIdName =
        idColumn === null ? statement`` : statement`, ${idColumn}::text`;

    return render(statement`
    WITH ${datasetTables(dataset)},
    mvtgeom2 as (
      SELECT
        i.id,
        i.json,
        i.geom
      FROM
        ${qualifiedName(config.tableName)} i
        INNER JOIN relevant_xforms xf ON i.xform_id = xf.xform_id
      WHERE
        i.deleted_at is null
        AND i.geom is not null
        -- Spatial filter BEFORE transform to use spatial index
        -- Use && operator for bounding box intersection (uses GIST index)
        AND i.geom && ST_Transform(${envelope}, 4326)
        ${datasetConditions(dataset, fieldFilter)}
    ), mvtgeom as (
      SELECT
        ST_AsMVTGeom (geom, ${envelope}) as geom,
          id,
          json
          ${selectedColumns}
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
    SELECT ST_AsMVT(mvtgeom.*, ${config.tableName}::text, 4096, 'geom' ${featureIdName}) AS mvt from mvtgeom;
  `);
};

// route schema
const schema = {
    description:
        "Return submissions as Mapbox Vector Tile (MVT). The layer name returned is the name of the table.",
    tags: ["feature"],
    summary: "return MVT",
    params: {
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
        columns: {
            type: "string",
            maxLength: 1024,
            description:
                "Optional comma-separated column names to return with MVT. The default is no columns.",
        },
        id_column: {
            type: "string",
            maxLength: 63,
            description:
                "Optional id column name to be used with Mapbox GL Feature State. This column must be an integer a string cast as an integer.",
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
            maxLength: 1024,
            description: "Optional field name for custom JSON filtering.",
        },
        field_value: {
            type: "string",
            maxLength: 4096,
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
            const { text, values } = sql(request.params, request.query, opts);

            fastify.pg.connect(onConnect);

            function onConnect(err, client, release) {
                if (err) {
                    request.log.error(err);
                    return reply
                        .code(500)
                        .send({ error: "Database connection error." });
                }

                client.query(text, values, function onResult(err, result) {
                    release();
                    if (err) {
                        request.log.error(err);
                        return reply
                            .code(500)
                            .send({ error: "Query failed." });
                    }
                    const mvt = result.rows[0].mvt;
                    if (mvt.length === 0) {
                        return reply.code(204).send();
                    }
                    return reply
                        .header("Content-Type", "application/x-protobuf")
                        .send(mvt);
                });
            }
        },
    });
    next();
};

module.exports.autoPrefix = "/v1";
module.exports.sql = sql;
