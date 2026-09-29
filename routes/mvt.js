const { InvalidRequestError } = require("../lib/errors");
const { parseDataset } = require("../lib/dataset");
const { readSubmissions } = require("../lib/reading");
const {
    statement,
    identifier,
    qualifiedName,
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

// Every tile holds these whether they are asked for or not, so naming them
// as columns adds nothing.
const HELD = ["id", "json"];

// The only column of whole numbers, which a feature id has to be.
const FEATURE_ID = "id";

const normalize = (name) => name.trim().toLowerCase();

const checkColumns = (columns) => {
    if (columns === undefined || columns === "") {
        return;
    }
    const names =
        typeof columns === "string" ? columns.split(",").map(normalize) : [];
    if (names.length === 0 || !names.every((name) => HELD.includes(name))) {
        throw new InvalidRequestError(
            `columns must be a comma-separated list of ${HELD.join(", ")}.`,
        );
    }
};

const parseIdColumn = (idColumn) => {
    if (idColumn === undefined || idColumn === "") {
        return null;
    }
    if (typeof idColumn !== "string" || normalize(idColumn) !== FEATURE_ID) {
        throw new InvalidRequestError(`id_column must be ${FEATURE_ID}.`);
    }
    return FEATURE_ID;
};

const parse = (params, query) => {
    const tile = parseTile(params);
    const dataset = parseDataset(query);
    const fieldFilter = parseFieldFilter(query);
    checkColumns(query.columns);

    return {
        tile,
        dataset,
        fieldFilter,
        idColumn: parseIdColumn(query.id_column),
    };
};

const sql = ({ tile, fieldFilter, idColumn }, resolved, config) => {
    const envelope = statement`ST_TileEnvelope(${tile.z}::int4, ${tile.x}::int4, ${tile.y}::int4)`;
    const geometry = statement`i.${identifier(config.geomColumn)}`;
    // The column a feature id is taken from is left out of the feature's
    // properties, so it is selected a second time to stay one.
    const featureId =
        idColumn === null ? statement`` : statement`, i.${identifier(idColumn)}`;
    const featureIdName =
        idColumn === null ? statement`` : statement`, ${idColumn}::text`;

    // The envelope is taken to the projection of the geometries, and not
    // they to its own, so that their index can be used to find them.
    return render(statement`
    SELECT ST_AsMVT(tile.*, ${config.tableName}::text, 4096, 'geom' ${featureIdName}) AS mvt
    FROM (
      SELECT
        ST_AsMVTGeom(ST_Transform(${geometry}, 3857), ${envelope}) AS geom,
        i.id,
        i.json
        ${featureId}
      FROM
        ${qualifiedName(config.tableName)} i
      WHERE
        ${submissionConditions(resolved, fieldFilter)}
        AND ${geometry} is not null
        AND ${geometry} && ST_Transform(${envelope}, 4326)
    ) tile;
  `);
};

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
                "Optional comma-separated list of id and json. Every feature holds both whether or not they are named.",
        },
        id_column: {
            type: "string",
            maxLength: 63,
            description:
                "Optional. Give id to have each feature carry the id of its submission as its feature id.",
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
