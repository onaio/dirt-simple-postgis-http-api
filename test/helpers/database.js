const { Pool } = require("pg");

const connectionString = process.env.TEST_POSTGRES_CONNECTION;

const OWN_FORM = 1;
const OTHER_FORM = 2;
const MERGED_MEMBER_FORM = 3;
const PARTIAL_FORM = 4;
const EDGE_FORM = 5;
const GRADED_FORM = 6;
const MERGED_DATASET = 50;
const APPROVED_DATAVIEW = 10;
const DELETED_DATAVIEW = 11;
const UNFILTERED_DATAVIEW = 12;
const PARTIAL_FORM_DATAVIEW = 13;
const PRIVATE_NOTE = "private-note-body";

const NAIROBI = { id: 101, lng: 36.8, lat: -1.3 };
const THIKA = { id: 102, lng: 36.9, lat: -1.2 };
const DELETED = { id: 103, lng: 40.5, lat: 3.0 };
const KAMPALA = { id: 201, lng: 32.5, lat: 0.3 };
const MOMBASA = { id: 301, lng: 39.6, lat: -4.0 };
const KISUMU = { id: 401, lng: 34.8, lat: -0.1 };
const NAKURU = { id: 402, lng: 36.1, lat: -0.3 };

const GRADE_A = { id: 601, lng: 35.1, lat: 0.5 };
const GRADE_B = { id: 602, lng: 35.2, lat: 0.6 };
const GRADE_C = { id: 603, lng: 35.3, lat: 0.7 };

// EDGE_TILE spans longitudes 36.7383 to 36.8262. JUST_OUTSIDE_EDGE_TILE lies
// east of that edge by less than the 1/16-tile buffer ST_AsMVTGeom draws in.
const EDGE_TILE = "/v1/mvt/12/2466/2062";
const INSIDE_EDGE_TILE = { id: 501, lng: 36.8, lat: -1.3 };
const JUST_OUTSIDE_EDGE_TILE = { id: 502, lng: 36.828, lat: -1.3 };

const SCHEMA = `
    CREATE EXTENSION IF NOT EXISTS postgis;
    DROP TABLE IF EXISTS
        logger_instance, logger_dataview, logger_mergedxform_xforms, private_notes,
        shaped_instance;
    CREATE TABLE logger_instance (
        id integer PRIMARY KEY,
        xform_id integer NOT NULL,
        json jsonb NOT NULL DEFAULT '{}',
        geom geometry(GeometryCollection, 4326),
        deleted_at timestamptz
    );
    CREATE TABLE logger_dataview (
        id integer PRIMARY KEY,
        xform_id integer NOT NULL,
        query jsonb NOT NULL DEFAULT '[]',
        deleted_at timestamptz
    );
    CREATE TABLE logger_mergedxform_xforms (
        id serial PRIMARY KEY,
        mergedxform_id integer NOT NULL,
        xform_id integer NOT NULL
    );
    CREATE TABLE private_notes (id integer PRIMARY KEY, body text NOT NULL);
`;

const point = ({ lng, lat }) =>
    `ST_ForceCollection(ST_SetSRID(ST_MakePoint(${lng}, ${lat}), 4326))`;

const SEED = `
    INSERT INTO logger_instance (id, xform_id, json, geom, deleted_at) VALUES
        (${NAIROBI.id}, ${OWN_FORM}, '{"status": "approved", "name": "nairobi"}', ${point(NAIROBI)}, NULL),
        (${THIKA.id}, ${OWN_FORM}, '{"status": "pending", "name": "thika"}', ${point(THIKA)}, NULL),
        (${DELETED.id}, ${OWN_FORM}, '{"status": "approved", "name": "deleted"}', ${point(DELETED)}, now()),
        (104, ${OWN_FORM}, '{"status": "approved", "name": "no-geometry"}', NULL, NULL),
        (${KAMPALA.id}, ${OTHER_FORM}, '{"status": "approved", "name": "kampala"}', ${point(KAMPALA)}, NULL),
        (${MOMBASA.id}, ${MERGED_MEMBER_FORM}, '{"status": "approved", "name": "mombasa"}', ${point(MOMBASA)}, NULL),
        (${KISUMU.id}, ${PARTIAL_FORM}, '{"status": "approved", "name": "kisumu"}', ${point(KISUMU)}, NULL),
        (${NAKURU.id}, ${PARTIAL_FORM}, '{"name": "nakuru"}', ${point(NAKURU)}, NULL),
        (${INSIDE_EDGE_TILE.id}, ${EDGE_FORM}, '{"name": "inside"}', ${point(INSIDE_EDGE_TILE)}, NULL),
        (${JUST_OUTSIDE_EDGE_TILE.id}, ${EDGE_FORM}, '{"name": "just-outside"}', ${point(JUST_OUTSIDE_EDGE_TILE)}, NULL),
        (${GRADE_A.id}, ${GRADED_FORM}, '{"grade": "a", "site": "north"}', ${point(GRADE_A)}, NULL),
        (${GRADE_B.id}, ${GRADED_FORM}, '{"grade": "b", "site": "north"}', ${point(GRADE_B)}, NULL),
        (${GRADE_C.id}, ${GRADED_FORM}, '{"grade": "c", "site": "south"}', ${point(GRADE_C)}, NULL);
    INSERT INTO logger_dataview (id, xform_id, query, deleted_at) VALUES
        (${APPROVED_DATAVIEW}, ${OWN_FORM}, '[{"column": "status", "filter": "=", "value": "approved"}]', NULL),
        (${DELETED_DATAVIEW}, ${OWN_FORM}, '[]', now()),
        (${UNFILTERED_DATAVIEW}, ${OWN_FORM}, '[]', NULL),
        (${PARTIAL_FORM_DATAVIEW}, ${PARTIAL_FORM}, '[{"column": "status", "filter": "=", "value": "approved"}]', NULL);
    INSERT INTO logger_mergedxform_xforms (mergedxform_id, xform_id) VALUES
        (${MERGED_DATASET}, ${OWN_FORM}),
        (${MERGED_DATASET}, ${MERGED_MEMBER_FORM});
    INSERT INTO private_notes (id, body) VALUES (1, '${PRIVATE_NOTE}');
`;

// The reset drops tables that share their names with real ones, so it only
// runs against a database whose name marks it as disposable.
const assertDisposable = async (pool) => {
    const { rows } = await pool.query("SELECT current_database() AS name");
    if (!rows[0].name.endsWith("_test")) {
        throw new Error(
            `Refusing to reset "${rows[0].name}": TEST_POSTGRES_CONNECTION must name a database ending in _test.`,
        );
    }
};

const withPool = async (run) => {
    const pool = new Pool({ connectionString });
    try {
        await assertDisposable(pool);
        return await run(pool);
    } finally {
        await pool.end();
    }
};

const resetDatabase = () =>
    withPool(async (pool) => {
        await pool.query(SCHEMA);
        await pool.query(SEED);
    });

const run = (text, values) => withPool((pool) => pool.query(text, values));

const createDataview = (id, xformId, filters) =>
    run("INSERT INTO logger_dataview (id, xform_id, query) VALUES ($1, $2, $3)", [
        id,
        xformId,
        JSON.stringify(filters),
    ]);

module.exports = {
    connectionString,
    resetDatabase,
    run,
    createDataview,
    OWN_FORM,
    OTHER_FORM,
    MERGED_MEMBER_FORM,
    PARTIAL_FORM,
    EDGE_FORM,
    GRADED_FORM,
    MERGED_DATASET,
    APPROVED_DATAVIEW,
    DELETED_DATAVIEW,
    UNFILTERED_DATAVIEW,
    PARTIAL_FORM_DATAVIEW,
    PRIVATE_NOTE,
    NAIROBI,
    THIKA,
    DELETED,
    KAMPALA,
    MOMBASA,
    KISUMU,
    NAKURU,
    GRADE_A,
    GRADE_B,
    GRADE_C,
    EDGE_TILE,
    INSIDE_EDGE_TILE,
    JUST_OUTSIDE_EDGE_TILE,
};
