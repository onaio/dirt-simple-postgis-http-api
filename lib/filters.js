const { statement, concat } = require("./statement");

// Read by both PostgreSQL and JavaScript, so written in what the two share.
// They are narrower than what PostgreSQL reads: a value left out is a row
// left out, where a value let through wrongly is a statement that fails.
const WHOLE_NUMBER = "^[-+]?[0-9]+$";
const NUMBER =
    "^[-+]?(?:[0-9]+(?:[.][0-9]*)?|[.][0-9]+)(?:[eE][-+]?[0-9]{1,3})?$";
const LONGEST_NUMBER = 100;

const YEAR = "[1-9][0-9]{3}";
const LEAP_YEAR =
    "(?:[1-9][0-9](?:0[48]|[2468][048]|[13579][26])|(?:[13579][26]|[2468][048])00)";
const DAY = [
    `${YEAR}-(?:0[13578]|1[02])-(?:0[1-9]|[12][0-9]|3[01])`,
    `${YEAR}-(?:0[469]|11)-(?:0[1-9]|[12][0-9]|30)`,
    `${YEAR}-02-(?:0[1-9]|1[0-9]|2[0-8])`,
    `${LEAP_YEAR}-02-29`,
].join("|");
const TIME = "[T ](?:[01][0-9]|2[0-3]):[0-5][0-9]:[0-5][0-9](?:[.][0-9]{1,6})?";
const ZONE = "(?:Z|[-+](?:0[0-9]|1[0-5])(?::?[0-5][0-9])?)";
const MOMENT = `^(?:${DAY})(?:${TIME}${ZONE}?)?$`;

const NEVER = statement`
      AND false`;

const read = (column) => statement`i.json->>${column}::text`;

const text = {
    suits: () => true,
    field: read,
    operand: (value) => statement`${value}::text`,
};

// A cast fails the whole statement on one value it cannot read, so a value
// is cast only once it is known to be of the type.
//
// The length is held to apart from the pattern, where a bound costs
// PostgreSQL several times as much to match.
const number = (pattern) => {
    const written = new RegExp(pattern);

    return {
        suits: (value) =>
            value.length <= LONGEST_NUMBER && written.test(value),
        field: (column) => statement`CASE
        WHEN length(${read(column)}) <= ${LONGEST_NUMBER}::int4
          AND ${read(column)} ~ ${pattern}::text
        THEN (${read(column)})::numeric END`,
        operand: (value) => statement`${value}::numeric`,
    };
};

const MOMENT_WRITTEN = new RegExp(MOMENT);

const moment = {
    suits: (value) => MOMENT_WRITTEN.test(value),
    field: (column) => statement`CASE
        WHEN ${read(column)} ~ ${MOMENT}::text
        THEN (${read(column)})::timestamp END`,
    operand: (value) => statement`${value}::timestamp`,
};

const ALWAYS = new Map([
    ["_id", "integer"],
    ["_submission_time", "date"],
]);

const COMPARED_AS = new Map([
    ["integer", number(WHOLE_NUMBER)],
    ["decimal", number(NUMBER)],
    ["date", moment],
]);

const OPERATORS = new Map([
    ["=", statement` = `],
    [">", statement` > `],
    ["<", statement` < `],
    [">=", statement` >= `],
    ["<=", statement` <= `],
    ["!=", statement` != `],
    ["<>", statement` <> `],
]);

const comparedAs = ({ column, type }) =>
    COMPARED_AS.get(ALWAYS.get(column) ?? type) ?? text;

const isUsable = (filter) =>
    filter !== null &&
    typeof filter === "object" &&
    typeof filter.column === "string" &&
    typeof filter.value === "string" &&
    OPERATORS.has(filter.filter) &&
    comparedAs(filter).suits(filter.value);

const isAlternative = ({ condition }) =>
    typeof condition === "string" && condition.toLowerCase() === "or";

const comparison = (filter) => {
    const { field, operand } = comparedAs(filter);
    const operator = OPERATORS.get(filter.filter);

    return statement`${field(filter.column)}${operator}${operand(filter.value)}`;
};

const allOf = (filters) =>
    filters.map(
        (filter) => statement`
      AND ${comparison(filter)}`,
    );

const anyOf = ([first, ...others]) =>
    first === undefined
        ? []
        : [
              statement`
      AND (
        ${comparison(first)}${concat(
            others.map(
                (filter) => statement`
        OR ${comparison(filter)}`,
            ),
        )}
      )`,
          ];

// A filter that cannot be applied hides every submission instead of none,
// whether or not it is one of several alternatives.
const filterConditions = (filters) => {
    const usable = filters.filter(isUsable);

    return concat([
        ...allOf(usable.filter((filter) => !isAlternative(filter))),
        ...anyOf(usable.filter(isAlternative)),
        ...Array.from({ length: filters.length - usable.length }, () => NEVER),
    ]);
};

module.exports = { filterConditions };
