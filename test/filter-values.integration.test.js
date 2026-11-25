const { describe, test, before } = require("node:test");
const assert = require("node:assert/strict");

const database = require("./helpers/database");
const {
    skip,
    fetchTile,
    filter,
    insertSubmissions,
} = require("./helpers/filters");
const { tileIds } = require("./helpers/tiles");

const { TYPED_FORM, survey, field } = database;

describe("dataview filters on dates against PostGIS", { skip }, () => {
    const MIDNIGHT = 801;
    const MORNING = 802;
    const HALF_A_SECOND_ON = 803;
    const NEARLY_A_SECOND_ON = 804;
    const A_SECOND_ON = 805;
    const MORNING_ELSEWHERE = 806;
    const LEAP_DAY_OF_2000 = 807;

    const READ = [
        [MIDNIGHT, "2024-02-29"],
        [MORNING, "2024-02-29T10:20:30"],
        [HALF_A_SECOND_ON, "2024-02-29T10:20:30.5"],
        [NEARLY_A_SECOND_ON, "2024-02-29 10:20:30.999999+03:00"],
        [A_SECOND_ON, "2024-02-29T10:20:31Z"],
        [MORNING_ELSEWHERE, "2024-02-29T10:20:30-0330"],
        [LEAP_DAY_OF_2000, "2000-02-29"],
    ];

    const NOT_READ = [
        "2024-02-30",
        "2023-02-29",
        "2100-02-29",
        "2024-04-31",
        "2024-13-01",
        "2024-00-10",
        "2024-01-00",
        "9999-99-99",
        "0000-01-01",
        "0999-12-31",
        "2024-02-29T24:00:00",
        "2024-02-29T23:59:60",
        "2024-02-29T10:20",
        "2024-02-29T10:20:30.1234567",
        "2024-02-29T10:20:30+16:00",
        " 2024-02-29",
        "2024-02-29T10:20:30 OR true",
        "29/02/2024",
        "today",
        "infinity",
        "",
    ];

    const everyRead = READ.map(([id]) => id);

    const dataviews = [
        ["from long ago", ">=", "1000-01-01", everyRead],
        ["up to the furthest moment", "<=", "9999-12-31 23:59:59.999999+15:59", everyRead],
        ["after the earliest moment", ">", "1000-01-01T00:00:00-15:59", everyRead],
        [
            "up to the morning",
            "<=",
            "2024-02-29T10:20:30",
            [MIDNIGHT, MORNING, MORNING_ELSEWHERE, LEAP_DAY_OF_2000],
        ],
        [
            "after the morning",
            ">",
            "2024-02-29T10:20:30",
            [HALF_A_SECOND_ON, NEARLY_A_SECOND_ON, A_SECOND_ON],
        ],
        ["at the morning", "=", "2024-02-29T10:20:30", [MORNING, MORNING_ELSEWHERE]],
        ["at half a second on", "=", "2024-02-29 10:20:30.500", [HALF_A_SECOND_ON]],
        [
            "before a second on",
            "<",
            "2024-02-29T10:20:31",
            [
                MIDNIGHT,
                MORNING,
                HALF_A_SECOND_ON,
                NEARLY_A_SECOND_ON,
                MORNING_ELSEWHERE,
                LEAP_DAY_OF_2000,
            ],
        ],
        ["on the day", "=", "2024-02-29", [MIDNIGHT]],
        ["not on the day", "<>", "2024-02-29", everyRead.filter((id) => id !== MIDNIGHT)],
        ...NOT_READ.map((value) => [
            `a value that is no moment, ${JSON.stringify(value)}`,
            ">=",
            value,
            [],
        ]),
    ];

    before(async () => {
        await database.resetDatabase();
        await database.defineForm(TYPED_FORM, survey([field("seen", "date")]));
        const rows = [
            ...READ,
            ...NOT_READ.map((value, index) => [900 + index, value]),
        ];
        await insertSubmissions(
            TYPED_FORM,
            rows.map(([id, seen]) => [id, { seen }]),
        );
        for (const [index, [, comparison, value]] of dataviews.entries()) {
            await database.createDataview(300 + index, TYPED_FORM, [
                filter("seen", comparison, value),
            ]);
        }
    });

    test("the form holds the rows that are read and those that are not", async () => {
        const response = await fetchTile({ form_id: TYPED_FORM });

        assert.equal(tileIds(response).length, READ.length + NOT_READ.length);
    });

    for (const [index, [label, comparison, value, expected]] of dataviews.entries()) {
        test(`${label} keeps ${JSON.stringify(expected)}: ${comparison} ${JSON.stringify(value)}`, async () => {
            const response = await fetchTile({ dataview_id: 300 + index });

            assert.notEqual(response.statusCode, 500);
            assert.deepEqual(tileIds(response), expected);
        });
    }
});

describe("dataview filters and the calendar against PostGIS", { skip }, () => {
    const DAYS = [
        ["2024-01-31", true],
        ["2024-02-28", true],
        ["2024-02-29", true],
        ["2024-02-30", false],
        ["2024-02-31", false],
        ["2023-02-28", true],
        ["2023-02-29", false],
        ["2000-02-29", true],
        ["2400-02-29", true],
        ["1900-02-29", false],
        ["2100-02-29", false],
        ["2024-03-31", true],
        ["2024-04-30", true],
        ["2024-04-31", false],
        ["2024-05-31", true],
        ["2024-06-30", true],
        ["2024-06-31", false],
        ["2024-07-31", true],
        ["2024-08-31", true],
        ["2024-09-30", true],
        ["2024-09-31", false],
        ["2024-10-31", true],
        ["2024-11-30", true],
        ["2024-11-31", false],
        ["2024-12-31", true],
        ["2024-12-32", false],
        ["1000-01-01", true],
        ["9999-12-31", true],
        ["2024-02-29T23:59:59.999999", true],
        ["2024-02-30T10:20:30", false],
    ];

    const idOf = (day) => 1200 + DAYS.findIndex(([listed]) => listed === day);
    const days = (exist) =>
        DAYS.filter(([, exists]) => exists === exist).map(([day]) => day);

    before(async () => {
        await database.resetDatabase();
        await database.defineForm(TYPED_FORM, survey([field("seen", "date")]));
        await insertSubmissions(
            TYPED_FORM,
            DAYS.map(([seen]) => [idOf(seen), { seen }]),
        );
        await database.createDataview(500, TYPED_FORM, [
            filter("seen", ">=", "1000-01-01"),
        ]);
        for (const [index, [day]] of DAYS.entries()) {
            await database.createDataview(501 + index, TYPED_FORM, [
                filter("seen", "=", day),
            ]);
        }
    });

    test("only the days a calendar holds are kept", async () => {
        const response = await fetchTile({ dataview_id: 500 });

        assert.equal(response.statusCode, 200);
        assert.deepEqual(tileIds(response), days(true).map(idOf));
    });

    for (const [index, [day, exists]] of DAYS.entries()) {
        test(`a filter on ${day} keeps ${exists ? "that day" : "nothing"}`, async () => {
            const response = await fetchTile({ dataview_id: 501 + index });

            assert.notEqual(response.statusCode, 500);
            assert.deepEqual(tileIds(response), exists ? [idOf(day)] : []);
        });
    }
});

describe("dataview filters on numbers against PostGIS", { skip }, () => {
    const READ = [
        "5.",
        ".5",
        "+5.25",
        "-0",
        "00012",
        "1E2",
        "1e+2",
        "1e-3",
        "9".repeat(100),
        7,
        7.5,
    ];
    const NOT_NUMBERS = [
        "",
        " 5",
        "five",
        "NaN",
        "Infinity",
        "0x1F",
        "1_000",
        "1e1000",
        "5,5",
    ];
    const NOT_READ = [
        ...NOT_NUMBERS,
        "5 ",
        "9".repeat(101),
        "5\n",
        true,
        null,
        [5],
        { n: 5 },
    ];

    const dataviews = [
        ["from far below", ">=", "-1e999", READ.length],
        ["up to far above", "<=", "1e999", READ.length],
        ["above a hundred", ">", "100.0", 1],
        ...NOT_NUMBERS.map((value) => [
            `a value that is no number, ${JSON.stringify(value)}`,
            ">=",
            value,
            0,
        ]),
    ];

    before(async () => {
        await database.resetDatabase();
        await database.defineForm(TYPED_FORM, survey([field("weight", "decimal")]));
        await insertSubmissions(
            TYPED_FORM,
            [...READ, ...NOT_READ].map((weight, index) => [
                1000 + index,
                { weight },
            ]),
        );
        for (const [index, [, comparison, value]] of dataviews.entries()) {
            await database.createDataview(400 + index, TYPED_FORM, [
                filter("weight", comparison, value),
            ]);
        }
    });

    test("the form holds the rows that are read and those that are not", async () => {
        const response = await fetchTile({ form_id: TYPED_FORM });

        assert.equal(tileIds(response).length, READ.length + NOT_READ.length);
    });

    for (const [index, [label, comparison, value, kept]] of dataviews.entries()) {
        test(`${label} keeps ${kept} of the rows: ${comparison} ${JSON.stringify(value)}`, async () => {
            const response = await fetchTile({ dataview_id: 400 + index });

            assert.notEqual(response.statusCode, 500);
            assert.equal(tileIds(response).length, kept);
        });
    }

    test("the rows kept are those that are read", async () => {
        const response = await fetchTile({ dataview_id: 400 });

        assert.deepEqual(
            tileIds(response),
            READ.map((_, index) => 1000 + index),
        );
    });
});
