const { describe, test, before } = require("node:test");
const assert = require("node:assert/strict");

const { withApp, query } = require("./helpers/app");
const database = require("./helpers/database");
const {
    WORLD_TILE,
    layerFeatures,
    layerNames,
    tileIds,
    tileProperties,
} = require("./helpers/tiles");

const {
    OWN_FORM,
    OTHER_FORM,
    MERGED_DATASET,
    APPROVED_DATAVIEW,
    DELETED_DATAVIEW,
    UNFILTERED_DATAVIEW,
    PARTIAL_FORM,
    PARTIAL_FORM_DATAVIEW,
    EDGE_FORM,
    GRADED_FORM,
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
} = database;

const skip = database.connectionString
    ? false
    : "TEST_POSTGRES_CONNECTION is not set";

const env = { POSTGRES_CONNECTION: database.connectionString };

const OWN_FORM_PROPERTIES = [
    { id: NAIROBI.id, name: "nairobi", status: "approved" },
    { id: THIKA.id, name: "thika", status: "pending" },
];

const fetchTile = (parameters, path = WORLD_TILE, overrides = {}) =>
    withApp({ env: { ...env, ...overrides } }, ({ app }) =>
        app.inject({ url: `${path}?${query(parameters)}` }),
    );

const featureIds = (response) =>
    layerFeatures(response.rawPayload, "logger_instance")
        .map((feature) => feature.id)
        .sort((a, b) => a - b);

describe("mvt route against PostGIS", { skip }, () => {
    before(database.resetDatabase);

    test("the fixture holds rows the tile must exclude", async () => {
        const { rows } = await database.run(
            `SELECT id, deleted_at IS NOT NULL AS deleted, geom IS NULL AS no_geom
             FROM logger_instance WHERE xform_id = $1 ORDER BY id`,
            [OWN_FORM],
        );

        assert.deepEqual(rows, [
            { id: NAIROBI.id, deleted: false, no_geom: false },
            { id: THIKA.id, deleted: false, no_geom: false },
            { id: DELETED.id, deleted: true, no_geom: false },
            { id: 104, deleted: false, no_geom: true },
        ]);
    });

    test("a form tile holds its live, located submissions only", async () => {
        const response = await fetchTile({ form_id: OWN_FORM });

        assert.equal(response.statusCode, 200);
        assert.deepEqual(tileIds(response), [NAIROBI.id, THIKA.id]);
    });

    test("a tile is served as protobuf with private caching", async () => {
        const response = await fetchTile({ form_id: OWN_FORM });

        assert.equal(response.headers["content-type"], "application/x-protobuf");
        assert.equal(response.headers["cache-control"], "private, max-age=3600");
    });

    test("a tile can be read by an allowed origin", async () => {
        const response = await withApp({ env }, ({ app }) =>
            app.inject({
                url: `${WORLD_TILE}?form_id=${OWN_FORM}`,
                headers: { origin: "https://maps.example.test" },
            }),
        );

        assert.equal(response.statusCode, 200);
        assert.equal(
            response.headers["access-control-allow-origin"],
            "https://maps.example.test",
        );
    });

    test("the layer is named after the table", async () => {
        const response = await fetchTile({ form_id: OWN_FORM });

        assert.deepEqual(layerNames(response.rawPayload), ["logger_instance"]);
    });

    test("features carry the submission fields as properties", async () => {
        const response = await fetchTile({ form_id: OWN_FORM });

        assert.deepEqual(tileProperties(response), OWN_FORM_PROPERTIES);
    });

    test("features carry no feature id unless one is asked for", async () => {
        const response = await fetchTile({ form_id: OWN_FORM });

        assert.deepEqual(featureIds(response), [undefined, undefined]);
    });

    test("a merged dataset tile holds every member form", async () => {
        const response = await fetchTile({ merged_dataset_id: MERGED_DATASET });

        assert.deepEqual(tileIds(response), [
            NAIROBI.id,
            THIKA.id,
            MOMBASA.id,
        ]);
    });

    test("an unknown merged dataset yields an empty tile", async () => {
        const response = await fetchTile({ merged_dataset_id: 999 });

        assert.equal(response.statusCode, 204);
    });

    test("a dataview tile applies the dataview filters", async () => {
        const response = await fetchTile({ dataview_id: APPROVED_DATAVIEW });

        assert.deepEqual(tileIds(response), [NAIROBI.id]);
    });

    test("a dataview filter drops submissions that lack the filtered field", async () => {
        const form = await fetchTile({ form_id: PARTIAL_FORM });
        const dataview = await fetchTile({ dataview_id: PARTIAL_FORM_DATAVIEW });

        assert.deepEqual(tileIds(form), [KISUMU.id, NAKURU.id]);
        assert.deepEqual(tileIds(dataview), [KISUMU.id]);
    });

    test("a dataview without filters holds the whole form", async () => {
        const response = await fetchTile({ dataview_id: UNFILTERED_DATAVIEW });

        assert.deepEqual(tileIds(response), [NAIROBI.id, THIKA.id]);
    });

    test("a deleted dataview yields an empty tile", async () => {
        const response = await fetchTile({ dataview_id: DELETED_DATAVIEW });

        assert.equal(response.statusCode, 204);
    });

    test("an unknown form yields an empty tile", async () => {
        const response = await fetchTile({ form_id: 999 });

        assert.equal(response.statusCode, 204);
        assert.equal(response.rawPayload.length, 0);
    });

    test("the field filter keeps matching submissions only", async () => {
        const response = await fetchTile({
            form_id: OWN_FORM,
            field_name: "status",
            field_value: "pending",
        });

        assert.deepEqual(tileIds(response), [THIKA.id]);
    });

    test("an empty field value is a value, not a missing filter", async () => {
        const response = await fetchTile({
            form_id: OWN_FORM,
            field_name: "status",
            field_value: "",
        });

        assert.equal(response.statusCode, 204);
    });

    test("the field filter combines with the dataview filters", async () => {
        const response = await fetchTile({
            dataview_id: APPROVED_DATAVIEW,
            field_name: "name",
            field_value: "thika",
        });

        assert.equal(response.statusCode, 204);
    });

    test("a tile away from the data is empty", async () => {
        const response = await fetchTile({ form_id: OWN_FORM }, "/v1/mvt/10/0/0");

        assert.equal(response.statusCode, 204);
    });

    test("a zoomed tile holds only the submissions inside it", async () => {
        const response = await fetchTile({ form_id: OWN_FORM }, EDGE_TILE);

        assert.deepEqual(tileIds(response), [NAIROBI.id]);
    });

    test("a submission just past the tile edge is left to the next tile", async () => {
        const world = await fetchTile({ form_id: EDGE_FORM });
        const tile = await fetchTile({ form_id: EDGE_FORM }, EDGE_TILE);

        assert.deepEqual(tileIds(world), [
            INSIDE_EDGE_TILE.id,
            JUST_OUTSIDE_EDGE_TILE.id,
        ]);
        assert.deepEqual(tileIds(tile), [INSIDE_EDGE_TILE.id]);
    });

    test("an id column becomes the feature id and stays a property", async () => {
        const response = await fetchTile({ form_id: OWN_FORM, id_column: "id" });

        assert.deepEqual(featureIds(response), [NAIROBI.id, THIKA.id]);
        assert.deepEqual(tileProperties(response), OWN_FORM_PROPERTIES);
    });

    for (const columns of ["id", "json", "id,json", "ID, Json"]) {
        test(`asking for columns ${columns} leaves the tile contents unchanged`, async () => {
            const response = await fetchTile({ form_id: OWN_FORM, columns });

            assert.equal(response.statusCode, 200);
            assert.deepEqual(tileProperties(response), OWN_FORM_PROPERTIES);
        });
    }
});

describe("mvt route table configuration against PostGIS", { skip }, () => {
    before(database.resetDatabase);

    test("a schema-qualified table is read and names the layer", async () => {
        const response = await fetchTile({ form_id: OWN_FORM }, WORLD_TILE, {
            TABLE_NAME: "public.logger_instance",
        });

        assert.deepEqual(layerNames(response.rawPayload), [
            "public.logger_instance",
        ]);
        assert.deepEqual(
            tileProperties(response, "public.logger_instance"),
            OWN_FORM_PROPERTIES,
        );
    });

    test("a table name is read without regard to case", async () => {
        const response = await fetchTile({ form_id: OWN_FORM }, WORLD_TILE, {
            TABLE_NAME: "Logger_Instance",
        });

        assert.equal(response.statusCode, 200);
        assert.deepEqual(
            tileProperties(response, "Logger_Instance"),
            OWN_FORM_PROPERTIES,
        );
    });
});

describe("mvt route dataview operators against PostGIS", { skip }, () => {
    const grade = (filter, value) => ({ column: "grade", filter, value });

    const dataviews = [
        [21, [grade("=", "b")], [GRADE_B.id]],
        [22, [grade(">", "a")], [GRADE_B.id, GRADE_C.id]],
        [23, [grade("<", "c")], [GRADE_A.id, GRADE_B.id]],
        [24, [grade(">=", "b")], [GRADE_B.id, GRADE_C.id]],
        [25, [grade("<=", "b")], [GRADE_A.id, GRADE_B.id]],
        [26, [grade("!=", "b")], [GRADE_A.id, GRADE_C.id]],
        [27, [grade(">=", "b"), grade("!=", "c")], [GRADE_B.id]],
        [
            28,
            [grade(">", "a"), { column: "site", filter: "=", value: "north" }],
            [GRADE_B.id],
        ],
        [29, [grade("LIKE", "%")], []],
        [30, [{ column: "grade", value: "b" }], []],
        [31, [grade("=", "b"), grade("unknown", "b")], []],
    ];

    before(async () => {
        await database.resetDatabase();
        for (const [id, filters] of dataviews) {
            await database.createDataview(id, GRADED_FORM, filters);
        }
    });

    test("the form holds every grade", async () => {
        const response = await fetchTile({ form_id: GRADED_FORM });

        assert.deepEqual(tileIds(response), [
            GRADE_A.id,
            GRADE_B.id,
            GRADE_C.id,
        ]);
    });

    for (const [id, filters, expected] of dataviews) {
        test(`filters ${JSON.stringify(filters)} keep ${JSON.stringify(expected)}`, async () => {
            const response = await fetchTile({ dataview_id: id });

            assert.deepEqual(tileIds(response), expected);
        });
    }
});

describe("mvt route access control against PostGIS", { skip }, () => {
    before(database.resetDatabase);

    test("the other form has a submission that could leak", async () => {
        const response = await fetchTile({ form_id: OTHER_FORM });

        assert.deepEqual(tileIds(response), [KAMPALA.id]);
    });

    test("a second dataset id cannot widen the tile", async () => {
        const response = await fetchTile({
            dataview_id: UNFILTERED_DATAVIEW,
            form_id: OTHER_FORM,
        });

        assert.equal(response.statusCode, 400);
        assert.deepEqual(Object.keys(response.json()), ["error"]);
    });

    test("a denied caller gets no tile", async () => {
        const respond = () => ({ status: 403 });

        const response = await withApp({ respond, env }, ({ app }) =>
            app.inject({ url: `${WORLD_TILE}?form_id=${OWN_FORM}` }),
        );

        assert.equal(response.statusCode, 403);
        assert.deepEqual(response.json(), { error: "Permission denied." });
    });
});

describe("mvt route injection attempts against PostGIS", { skip }, () => {
    before(database.resetDatabase);

    const unionLeak =
        "x' UNION SELECT 999, jsonb_build_object('leak', body), " +
        "ST_ForceCollection(ST_SetSRID(ST_MakePoint(36.8,-1.3),4326)) " +
        "FROM private_notes -- ";

    const hostileFilters = [
        ["a union in the field value", "status", unionLeak],
        ["a union in the field name", unionLeak, "approved"],
        ["a tautology in the field value", "status", "x' OR '1'='1"],
        ["a tautology in the field name", "status'='x' OR '1'='1", "approved"],
        ["a stacked statement in the field value", "status", "x'; DROP TABLE private_notes; --"],
        ["a comment in the field value", "status", "approved' --"],
        ["a backslash escape in the field value", "status", "x\\' OR 1=1 --"],
        ["a placeholder in the field value", "status", "$1"],
    ];

    for (const [label, name, value] of hostileFilters) {
        test(`${label} matches nothing`, async () => {
            const response = await fetchTile({
                form_id: OWN_FORM,
                field_name: name,
                field_value: value,
            });

            assert.equal(response.statusCode, 204);
            assert.equal(response.rawPayload.length, 0);
        });
    }

    test("a field value holding a quote still matches literally", async () => {
        await database.run(
            `UPDATE logger_instance SET json = json || '{"owner": "o''brien"}' WHERE id = $1`,
            [THIKA.id],
        );

        const response = await fetchTile({
            form_id: OWN_FORM,
            field_name: "owner",
            field_value: "o'brien",
        });

        assert.deepEqual(tileIds(response), [THIKA.id]);
    });

    test("a field name holding a quote is looked up literally", async () => {
        await database.run(
            `UPDATE logger_instance SET json = json || '{"it''s": "yes"}' WHERE id = $1`,
            [NAIROBI.id],
        );

        const response = await fetchTile({
            form_id: OWN_FORM,
            field_name: "it's",
            field_value: "yes",
        });

        assert.deepEqual(tileIds(response), [NAIROBI.id]);
    });

    const rejected = [
        ["a subquery in columns", { columns: "(SELECT body FROM private_notes)" }],
        ["a function call in columns", { columns: "pg_sleep(5)" }],
        ["a column the tile does not hold", { columns: "xml" }],
        ["a subquery in the id column", { id_column: "(SELECT 1)" }],
        ["a quote in the id column", { id_column: "id') FROM private_notes --" }],
        ["an id column the tile does not hold", { id_column: "uuid" }],
        ["a statement in the form id", { form_id: "1; DROP TABLE private_notes" }],
        ["a union in the form id", { form_id: "1 UNION SELECT 2" }],
    ];

    for (const [label, parameters] of rejected) {
        test(`${label} is a 400`, async () => {
            const response = await fetchTile({ form_id: OWN_FORM, ...parameters });

            assert.equal(response.statusCode, 400);
            assert.deepEqual(Object.keys(response.json()), ["error"]);
        });
    }

    test("a statement in the tile path is a 400", async () => {
        const response = await fetchTile(
            { form_id: OWN_FORM },
            `/v1/mvt/0/0/${encodeURIComponent("0); DROP TABLE private_notes; --")}`,
        );

        assert.equal(response.statusCode, 400);
    });

    test("the private table survives every attempt", async () => {
        const { rows } = await database.run("SELECT body FROM private_notes");

        assert.deepEqual(rows, [{ body: PRIVATE_NOTE }]);
    });
});

describe("mvt route failures against PostGIS", { skip }, () => {
    before(database.resetDatabase);

    test("tile coordinates outside the zoom level are a 400", async () => {
        const response = await fetchTile({ form_id: OWN_FORM }, "/v1/mvt/0/5/5");

        assert.equal(response.statusCode, 400);
        assert.deepEqual(response.json(), {
            error: "z, x and y must name a tile.",
        });
    });

    test("a failing statement is a 500 that names nothing internal", async () => {
        const response = await fetchTile(
            { form_id: OWN_FORM },
            WORLD_TILE,
            { TABLE_NAME: "missing_table" },
        );

        assert.equal(response.statusCode, 500);
        assert.deepEqual(response.json(), { error: "Query failed." });
    });

    test("a statement that outlasts its time limit is stopped", async () => {
        const overrides = { POSTGRES_STATEMENT_TIMEOUT: "100" };

        await withApp({ env: { ...env, ...overrides } }, async ({ app }) => {
            await app.ready();

            await assert.rejects(
                () => app.pg.query("SELECT pg_sleep(2)"),
                /statement timeout/,
            );
        });
    });

    test("a statement runs to the end when no time limit is set", async () => {
        await withApp({ env }, async ({ app }) => {
            await app.ready();

            const { rows } = await app.pg.query("SELECT pg_sleep(0.3), 1 AS done");

            assert.equal(rows[0].done, 1);
        });
    });
});
