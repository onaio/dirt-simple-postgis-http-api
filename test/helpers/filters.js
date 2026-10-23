const { withApp, query } = require("./app");
const database = require("./database");
const { WORLD_TILE } = require("./tiles");

const skip = database.connectionString
    ? false
    : "TEST_POSTGRES_CONNECTION is not set";

const env = { POSTGRES_CONNECTION: database.connectionString };

const fetchTile = (parameters) =>
    withApp({ env }, ({ app }) =>
        app.inject({ url: `${WORLD_TILE}?${query(parameters)}` }),
    );

const filter = (column, comparison, value, condition) => ({
    column,
    filter: comparison,
    value,
    ...(condition === undefined ? {} : { condition }),
});

const INSERT = `
    INSERT INTO logger_instance (id, xform_id, json, geom)
    VALUES (
        $1, $2, $3,
        ST_ForceCollection(ST_SetSRID(ST_MakePoint($4, 1), 4326))
    )`;

// Each submission is a degree east of the one before it, from 30 degrees.
const insertSubmissions = async (form, submissions) => {
    for (const [index, [id, json]] of submissions.entries()) {
        await database.run(INSERT, [id, form, JSON.stringify(json), 30 + index]);
    }
};

module.exports = { skip, env, fetchTile, filter, insertSubmissions };
