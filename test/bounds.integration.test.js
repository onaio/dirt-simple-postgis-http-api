const { describe, test, before } = require("node:test");
const assert = require("node:assert/strict");

const { withApp, query } = require("./helpers/app");
const database = require("./helpers/database");

const {
    OWN_FORM,
    OTHER_FORM,
    MERGED_DATASET,
    APPROVED_DATAVIEW,
    DELETED_DATAVIEW,
    UNFILTERED_DATAVIEW,
    PARTIAL_FORM,
    PARTIAL_FORM_DATAVIEW,
    NAIROBI,
    THIKA,
    DELETED,
    KAMPALA,
    MOMBASA,
    KISUMU,
    NAKURU,
} = database;

const skip = database.connectionString
    ? false
    : "TEST_POSTGRES_CONNECTION is not set";

const env = { POSTGRES_CONNECTION: database.connectionString };

const NO_BOUNDS = { xmin: null, ymin: null, xmax: null, ymax: null };

const fetchBounds = (parameters, overrides = {}) =>
    withApp({ env: { ...env, ...overrides } }, ({ app }) =>
        app.inject({ url: `/v1/bounds?${query(parameters)}` }),
    );

const boundsOf = (...points) => ({
    xmin: Math.min(...points.map(({ lng }) => lng)),
    ymin: Math.min(...points.map(({ lat }) => lat)),
    xmax: Math.max(...points.map(({ lng }) => lng)),
    ymax: Math.max(...points.map(({ lat }) => lat)),
});

describe("bounds route against PostGIS", { skip }, () => {
    before(database.resetDatabase);

    test("a form is bounded by its live, located submissions", async () => {
        const response = await fetchBounds({ form_id: OWN_FORM });

        assert.equal(response.statusCode, 200);
        assert.deepEqual(response.json(), boundsOf(NAIROBI, THIKA));
        assert.notDeepEqual(
            boundsOf(NAIROBI, THIKA),
            boundsOf(NAIROBI, THIKA, DELETED),
        );
    });

    test("bounds are served as JSON with private caching", async () => {
        const response = await fetchBounds({ form_id: OWN_FORM });

        assert.match(response.headers["content-type"], /^application\/json/);
        assert.equal(response.headers["cache-control"], "private, max-age=3600");
    });

    test("a merged dataset is bounded by every member form", async () => {
        const response = await fetchBounds({
            merged_dataset_id: MERGED_DATASET,
        });

        assert.deepEqual(response.json(), boundsOf(NAIROBI, THIKA, MOMBASA));
    });

    test("a dataview is bounded by the rows its filters keep", async () => {
        const response = await fetchBounds({ dataview_id: APPROVED_DATAVIEW });

        assert.deepEqual(response.json(), boundsOf(NAIROBI));
    });

    test("a dataview filter drops submissions that lack the filtered field", async () => {
        const form = await fetchBounds({ form_id: PARTIAL_FORM });
        const dataview = await fetchBounds({
            dataview_id: PARTIAL_FORM_DATAVIEW,
        });

        assert.deepEqual(form.json(), boundsOf(KISUMU, NAKURU));
        assert.deepEqual(dataview.json(), boundsOf(KISUMU));
    });

    test("a dataview without filters is bounded by the whole form", async () => {
        const response = await fetchBounds({
            dataview_id: UNFILTERED_DATAVIEW,
        });

        assert.deepEqual(response.json(), boundsOf(NAIROBI, THIKA));
    });

    test("the field filter narrows the bounds", async () => {
        const response = await fetchBounds({
            form_id: OWN_FORM,
            field_name: "status",
            field_value: "pending",
        });

        assert.deepEqual(response.json(), boundsOf(THIKA));
    });

    for (const [label, parameters] of [
        ["an unknown form", { form_id: 999 }],
        ["a deleted dataview", { dataview_id: DELETED_DATAVIEW }],
        [
            "a field filter nothing matches",
            { form_id: OWN_FORM, field_name: "status", field_value: "none" },
        ],
    ]) {
        test(`${label} has no bounds`, async () => {
            const response = await fetchBounds(parameters);

            assert.equal(response.statusCode, 200);
            assert.deepEqual(response.json(), NO_BOUNDS);
        });
    }

    test("the retired limit parameter is accepted and ignored", async () => {
        const response = await fetchBounds({ form_id: OWN_FORM, limit: 1 });

        assert.equal(response.statusCode, 200);
        assert.deepEqual(response.json(), boundsOf(NAIROBI, THIKA));
    });

    test("an empty field value is a value, not a missing filter", async () => {
        const response = await fetchBounds({
            form_id: OWN_FORM,
            field_name: "status",
            field_value: "",
        });

        assert.deepEqual(response.json(), NO_BOUNDS);
    });

    test("bounds can be read by an allowed origin", async () => {
        const response = await withApp({ env }, ({ app }) =>
            app.inject({
                url: `/v1/bounds?form_id=${OWN_FORM}`,
                headers: { origin: "https://maps.example.test" },
            }),
        );

        assert.equal(
            response.headers["access-control-allow-origin"],
            "https://maps.example.test",
        );
    });

    test("the configured geometry column is the one measured", async () => {
        await database.run(`
            DROP TABLE IF EXISTS shaped_instance;
            CREATE TABLE shaped_instance AS
                SELECT id, xform_id, json, deleted_at, geom,
                       ST_Translate(geom, 10, 10) AS shape
                FROM logger_instance;
        `);

        const response = await fetchBounds(
            { form_id: OWN_FORM },
            { TABLE_NAME: "shaped_instance", TABLE_COLUMN: "shape" },
        );

        assert.deepEqual(
            response.json(),
            boundsOf(
                { lng: NAIROBI.lng + 10, lat: NAIROBI.lat + 10 },
                { lng: THIKA.lng + 10, lat: THIKA.lat + 10 },
            ),
        );
    });
});

describe("bounds route access control against PostGIS", { skip }, () => {
    before(database.resetDatabase);

    test("the other form has bounds that could leak", async () => {
        const response = await fetchBounds({ form_id: OTHER_FORM });

        assert.deepEqual(response.json(), boundsOf(KAMPALA));
    });

    test("a second dataset id cannot widen the bounds", async () => {
        const response = await fetchBounds({
            dataview_id: UNFILTERED_DATAVIEW,
            form_id: OTHER_FORM,
        });

        assert.equal(response.statusCode, 400);
        assert.deepEqual(Object.keys(response.json()), ["error"]);
    });

    test("a denied caller gets no bounds", async () => {
        const respond = () => ({ status: 403 });

        const response = await withApp({ respond, env }, ({ app }) =>
            app.inject({ url: `/v1/bounds?form_id=${OWN_FORM}` }),
        );

        assert.equal(response.statusCode, 403);
        assert.deepEqual(response.json(), { error: "Permission denied." });
    });
});

describe("bounds route injection attempts against PostGIS", { skip }, () => {
    before(database.resetDatabase);

    test("a tautology in the field value matches nothing", async () => {
        const response = await fetchBounds({
            form_id: OWN_FORM,
            field_name: "status",
            field_value: "x' OR '1'='1",
        });

        assert.equal(response.statusCode, 200);
        assert.deepEqual(response.json(), NO_BOUNDS);
    });

    test("a tautology in the field name matches nothing", async () => {
        const response = await fetchBounds({
            form_id: OWN_FORM,
            field_name: "status'='x' OR '1'='1",
            field_value: "approved",
        });

        assert.equal(response.statusCode, 200);
        assert.deepEqual(response.json(), NO_BOUNDS);
    });

    test("a statement in the form id is a 400", async () => {
        const response = await fetchBounds({
            form_id: "1; DROP TABLE private_notes",
        });

        assert.equal(response.statusCode, 400);
    });
});

describe("bounds route failures against PostGIS", { skip }, () => {
    before(database.resetDatabase);

    test("a failing statement is a 500 that names nothing internal", async () => {
        const response = await fetchBounds(
            { form_id: OWN_FORM },
            { TABLE_NAME: "missing_table" },
        );

        assert.equal(response.statusCode, 500);
        assert.deepEqual(response.json(), { error: "Query failed." });
    });
});
