const { describe, test, before } = require("node:test");
const assert = require("node:assert/strict");

const { withApp } = require("./helpers/app");
const database = require("./helpers/database");
const {
    skip,
    env,
    fetchTile,
    filter,
    insertSubmissions,
} = require("./helpers/filters");
const { tileIds } = require("./helpers/tiles");

const { TYPED_FORM, survey, field, group } = database;

const NINE = 701;
const TEN = 702;
const HUNDRED = 703;
const UNREADABLE = 704;
const EMPTY = 705;

const ROWS = [
    [
        NINE,
        {
            _id: 99,
            _submission_time: "2024-01-05T08:00:00",
            age: 9,
            weight: 9.5,
            visited: "2024-02-01",
            code: "9",
            members: "9",
            "household/members": 2,
        },
    ],
    [
        TEN,
        {
            _id: 700,
            _submission_time: "2024-06-01T00:00:00",
            age: "10",
            weight: 10,
            visited: "2024-10-15",
            code: "10",
            members: "10",
            "household/members": 10,
        },
    ],
    [
        HUNDRED,
        {
            _id: 1000,
            _submission_time: "2025-03-09T23:59:59",
            age: 100,
            weight: "100.25",
            visited: "2025-01-01T12:30:00",
            code: "100",
            members: "100",
            "household/members": 12,
        },
    ],
    [
        UNREADABLE,
        {
            _id: "none",
            _submission_time: "yesterday",
            age: "abc",
            weight: "n/a",
            visited: "2024-02-30 or so",
            code: "x",
            "household/members": "10\n",
        },
    ],
    [EMPTY, {}],
];

const DEFINITION = survey([
    field("age", "integer"),
    field("weight", "decimal"),
    field("visited", "date"),
    field("code"),
    field("members"),
    group("household", [field("members", "integer")]),
    {
        name: "colour",
        type: "select one",
        children: [{ name: "age", label: "Age" }, "loose"],
    },
]);

describe("dataview filters on typed fields against PostGIS", { skip }, () => {
    const dataviews = [
        ["a whole number above", [filter("age", ">", "10")], [HUNDRED]],
        ["a whole number from", [filter("age", ">=", "10")], [TEN, HUNDRED]],
        ["a whole number below", [filter("age", "<", "10")], [NINE]],
        ["a whole number up to", [filter("age", "<=", 10)], [NINE, TEN]],
        ["a whole number written with a leading zero", [filter("age", "=", "010")], [TEN]],
        ["a whole number that differs", [filter("age", "!=", "10")], [NINE, HUNDRED]],
        ["a whole number that differs, written <>", [filter("age", "<>", "10")], [NINE, HUNDRED]],
        ["a negative whole number", [filter("age", ">", "-1")], [NINE, TEN, HUNDRED]],
        ["a decimal above", [filter("weight", ">", "9.5")], [TEN, HUNDRED]],
        ["a decimal up to", [filter("weight", "<=", "10.0")], [NINE, TEN]],
        ["a decimal written with an exponent", [filter("weight", "<", "1e2")], [NINE, TEN]],
        ["a date after", [filter("visited", ">", "2024-02-01")], [TEN, HUNDRED]],
        ["a date given with a time", [filter("visited", "=", "2024-02-01T00:00:00")], [NINE]],
        ["a date given with a zone", [filter("visited", "<", "2024-10-15T00:00:00.000Z")], [NINE]],
        ["a date with a time of day", [filter("visited", ">", "2025-01-01")], [HUNDRED]],
        ["a field inside a group", [filter("household/members", ">", "9")], [TEN, HUNDRED]],
        ["the submission id", [filter("_id", ">", "700")], [HUNDRED]],
        ["the submission time", [filter("_submission_time", ">=", "2024-06-01")], [TEN, HUNDRED]],
        ["text above", [filter("code", ">", "10")], [NINE, HUNDRED, UNREADABLE]],
        ["text that differs, written <>", [filter("code", "<>", "9")], [TEN, HUNDRED, UNREADABLE]],
        [
            "text named like a whole number in a group",
            [filter("members", ">", "10")],
            [NINE, HUNDRED],
        ],
        ["a whole number given as text", [filter("age", ">", "ten")], []],
        ["a whole number given as a decimal", [filter("age", ">", "9.5")], []],
        ["a whole number followed by SQL", [filter("age", ">", "10 OR true")], []],
        ["a decimal given as text", [filter("weight", ">", "heavy")], []],
        ["a date given in words", [filter("visited", ">", "yesterday")], []],
        ["a date given day first", [filter("visited", ">", "01/02/2024")], []],
        [
            "either of two",
            [filter("age", "<", "10", "or"), filter("age", ">", "10", "or")],
            [NINE, HUNDRED],
        ],
        [
            "either of two, written OR",
            [filter("age", "<", "10", "OR"), filter("age", ">", "10", "Or")],
            [NINE, HUNDRED],
        ],
        [
            "either of two, and another",
            [
                filter("age", "<", "10", "or"),
                filter("code", "=", "100"),
                filter("age", ">", "10", "or"),
            ],
            [HUNDRED],
        ],
        [
            "either of two, all of them and another",
            [
                filter("age", "<", "10", "or"),
                filter("age", ">", "10", "or"),
                filter("code", "=", "10"),
            ],
            [],
        ],
        ["one alone, written as either", [filter("age", ">", "10", "or")], [HUNDRED]],
        [
            "both of two, written and",
            [filter("age", ">", "9", "and"), filter("age", "<", "100", "and")],
            [TEN],
        ],
        [
            "either of two, one of which cannot be applied",
            [filter("age", "<", "10", "or"), filter("age", "LIKE", "1%", "or")],
            [],
        ],
        [
            "either of two, one of which does not suit the field",
            [filter("age", "<", "10", "or"), filter("age", ">", "ten", "or")],
            [],
        ],
    ];

    before(async () => {
        await database.resetDatabase();
        await database.defineForm(TYPED_FORM, DEFINITION);
        await insertSubmissions(TYPED_FORM, ROWS);
        for (const [index, [, filters]] of dataviews.entries()) {
            await database.createDataview(100 + index, TYPED_FORM, filters);
        }
    });

    test("the form holds every row", async () => {
        const response = await fetchTile({ form_id: TYPED_FORM });

        assert.deepEqual(tileIds(response), ROWS.map(([id]) => id));
    });

    for (const [index, [label, filters, expected]] of dataviews.entries()) {
        test(`${label} keeps ${JSON.stringify(expected)}: ${JSON.stringify(filters)}`, async () => {
            const response = await fetchTile({ dataview_id: 100 + index });

            assert.deepEqual(tileIds(response), expected);
        });
    }

    test("the bounds of a dataview follow the same comparison", async () => {
        const index = dataviews.findIndex(([label]) => label === "a whole number above");

        const response = await withApp({ env }, ({ app }) =>
            app.inject({ url: `/v1/bounds?dataview_id=${100 + index}` }),
        );

        assert.deepEqual(response.json(), {
            xmin: 32,
            ymin: 1,
            xmax: 32,
            ymax: 1,
        });
    });
});

describe("dataview filters and the form definition against PostGIS", { skip }, () => {
    const ABOVE_TEN = 200;
    const UNFILTERED = 201;

    const reset = async (definition) => {
        await database.resetDatabase();
        if (definition !== undefined) {
            await database.defineForm(TYPED_FORM, definition);
        }
        await insertSubmissions(TYPED_FORM, ROWS);
        await database.createDataview(ABOVE_TEN, TYPED_FORM, [
            filter("age", ">", "10"),
        ]);
        await database.createDataview(UNFILTERED, TYPED_FORM, []);
    };

    const everyRow = ROWS.map(([id]) => id);

    test("a definition held as text inside the column is read", async () => {
        await reset(JSON.stringify(DEFINITION));
        const { rows } = await database.run(
            "SELECT jsonb_typeof(json) AS held FROM logger_xform WHERE id = $1",
            [TYPED_FORM],
        );

        const response = await fetchTile({ dataview_id: ABOVE_TEN });

        assert.deepEqual(rows, [{ held: "string" }]);
        assert.deepEqual(tileIds(response), [HUNDRED]);
    });

    test("a definition held in a text column is read", async () => {
        await reset(DEFINITION);
        await database.run("ALTER TABLE logger_xform ALTER COLUMN json DROP DEFAULT");
        await database.run(
            "ALTER TABLE logger_xform ALTER COLUMN json TYPE text USING json::text",
        );
        const { rows } = await database.run(
            "SELECT pg_typeof(json)::text AS held FROM logger_xform WHERE id = $1",
            [TYPED_FORM],
        );

        const response = await fetchTile({ dataview_id: ABOVE_TEN });

        assert.deepEqual(rows, [{ held: "text" }]);

        assert.deepEqual(tileIds(response), [HUNDRED]);
    });

    const unreadable = [
        ["a form without a definition", undefined],
        ["a definition without fields", {}],
        ["a definition whose fields are not a list", { children: "age" }],
        ["a definition that is a list", [field("age", "integer")]],
        ["a definition that is a number", 7],
    ];

    for (const [label, definition] of unreadable) {
        test(`${label} hides every row from a dataview with filters`, async () => {
            await reset(definition);

            const response = await fetchTile({ dataview_id: ABOVE_TEN });

            assert.equal(response.statusCode, 204);
        });

        test(`${label} hides nothing from a dataview without filters`, async () => {
            await reset(definition);

            const response = await fetchTile({ dataview_id: UNFILTERED });

            assert.deepEqual(tileIds(response), everyRow);
        });
    }

    test("a definition that cannot be parsed fails the request", async () => {
        await reset("{ not a definition");

        const response = await fetchTile({ dataview_id: ABOVE_TEN });

        assert.equal(response.statusCode, 500);
        assert.doesNotMatch(response.payload, /not a definition|jsonb|logger_xform/);
    });

    test("a definition that cannot be parsed is not read for a dataview without filters", async () => {
        await reset("{ not a definition");

        const response = await fetchTile({ dataview_id: UNFILTERED });

        assert.deepEqual(tileIds(response), everyRow);
    });

    const definedTwice = [
        ["as text and then as a whole number", [field("age"), field("age", "integer")]],
        ["as a whole number and then as text", [field("age", "integer"), field("age")]],
        [
            "as a decimal and then as a whole number",
            [field("age", "decimal"), field("age", "integer")],
        ],
    ];

    for (const [label, fields] of definedTwice) {
        test(`a field defined ${label} is compared as a whole number`, async () => {
            await reset(survey(fields));
            await database.createDataview(202, TYPED_FORM, [
                filter("age", ">", "9.5"),
            ]);

            const above = await fetchTile({ dataview_id: ABOVE_TEN });
            const decimal = await fetchTile({ dataview_id: 202 });

            assert.deepEqual(tileIds(above), [HUNDRED]);
            assert.equal(decimal.statusCode, 204);
        });
    }

    const named = [
        ["a path expression", 'age") || (@.type == "integer'],
        ["a path variable", "$name1"],
        ["a quote", "a'b"],
        ["a double quote", 'a"b'],
        ["a backslash", "a\\b"],
        ["a wildcard", "*"],
        ["a path that ends in a separator", "age/"],
        ["a path that starts with a separator", "/age"],
        ["a path with an empty name inside", "household//members"],
        ["no name at all", ""],
        ["a separator alone", "/"],
        ["five hundred names", Array.from({ length: 500 }, () => "age").join("/")],
        ["a null character written out", "age\\u0000"],
    ];

    for (const [label, column] of named) {
        test(`a filter on a field named with ${label} is applied as text`, async () => {
            await reset(DEFINITION);
            await database.run(
                `UPDATE logger_instance
                 SET json = json || jsonb_build_object($1::text, '100')
                 WHERE id = $2`,
                [column, NINE],
            );
            await database.createDataview(203, TYPED_FORM, [
                filter(column, ">", "10"),
            ]);

            const response = await fetchTile({ dataview_id: 203 });

            assert.deepEqual(tileIds(response), [NINE]);
        });
    }

    test("a field of a type that is compared as text is compared as text", async () => {
        await reset(survey([field("age", "int"), field("code")]));

        const response = await fetchTile({ dataview_id: ABOVE_TEN });

        assert.deepEqual(tileIds(response), [NINE, HUNDRED, UNREADABLE]);
    });
});
