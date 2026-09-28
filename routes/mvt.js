const { InvalidRequestError } = require("../lib/errors");
const { parseDataset } = require("../lib/dataset");
const { readSubmissions } = require("../lib/reading");
const {
    statement,
    identifier,
    qualifiedName,
    concat,
    render,
} = require("../lib/statement");
const {
    parseFieldFilter,
    submissionConditions,
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

const parse = (params, query) => ({
    tile: parseTile(params),
    dataset: parseDataset(query),
    fieldFilter: parseFieldFilter(query),
    columns: parseColumns(query.columns),
    idColumn: parseIdColumn(query.id_column),
});

const sql = ({ tile, fieldFilter, columns, idColumn }, resolved, config) => {
    const selected = [...columns, ...(idColumn === null ? [] : [idColumn])];

    const envelope = statement`ST_TileEnvelope(${tile.z}::int4, ${tile.x}::int4, ${tile.y}::int4)`;
    const selectedColumns = concat(
        selected.map((name) => statement`, ${identifier(name)}`),
    );
    const featureIdName =
        idColumn === null ? statement`` : statement`, ${idColumn}::text`;

    return render(statement`
    WITH mvtgeom2 as (
      SELECT
        i.id,
        i.json,
        i.geom
      FROM
        ${qualifiedName(config.tableName)} i
      WHERE
        ${submissionConditions(resolved, fieldFilter)}
        AND i.geom is not null
        -- Spatial filter BEFORE transform to use spatial index
        -- Use && operator for bounding box intersection (uses GIST index)
        AND i.geom && ST_Transform(${envelope}, 4326)
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

const isEmpty = (rows) => rows.length === 0 || rows[0].mvt.length === 0;

// create route
module.exports = function (fastify, opts, next) {
    fastify.route({
        method: "GET",
        url: "/mvt/:z/:x/:y",
        schema: schema,
        handler: async function (request, reply) {
            const tileRequest = parse(request.params, request.query);

            const rows = await readSubmissions({
                pg: fastify.pg,
                request,
                reply,
                dataset: tileRequest.dataset,
                build: (resolved) => sql(tileRequest, resolved, opts),
            });
            if (isEmpty(rows)) {
                return reply.code(204).send();
            }
            return reply
                .header("Content-Type", "application/x-protobuf")
                .send(rows[0].mvt);
        },
    });
    next();
};

module.exports.autoPrefix = "/v1";
module.exports.parse = parse;
module.exports.sql = sql;
