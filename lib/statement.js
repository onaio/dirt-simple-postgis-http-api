const { quoteIdentifier, quoteQualifiedName } = require("./identifiers");

// Held in a WeakSet so that no value arriving from a request can pass for one.
const fragments = new WeakSet();

const fragment = (segments) => {
    const created = Object.freeze({ segments: Object.freeze(segments) });
    fragments.add(created);
    return created;
};

const toSegments = (interpolation) =>
    fragments.has(interpolation)
        ? interpolation.segments
        : [{ value: interpolation === undefined ? null : interpolation }];

const statement = (strings, ...interpolations) =>
    fragment(
        strings.flatMap((text, index) =>
            index < interpolations.length
                ? [text, ...toSegments(interpolations[index])]
                : [text],
        ),
    );

const concat = (statements) => {
    if (!statements.every((item) => fragments.has(item))) {
        throw new Error("Only statements can be joined.");
    }
    return fragment(statements.flatMap(({ segments }) => segments));
};

const identifier = (name) => fragment([quoteIdentifier(name)]);

const qualifiedName = (name) => fragment([quoteQualifiedName(name)]);

const render = (rendered) => {
    if (!fragments.has(rendered)) {
        throw new Error("Only statements can be rendered.");
    }
    return rendered.segments.reduce(
        ({ text, values }, segment) =>
            typeof segment === "string"
                ? { text: text + segment, values }
                : {
                      text: `${text}$${values.length + 1}`,
                      values: [...values, segment.value],
                  },
        { text: "", values: [] },
    );
};

module.exports = { statement, identifier, qualifiedName, concat, render };
