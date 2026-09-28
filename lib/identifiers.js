// 63 bytes is where PostgreSQL silently truncates an identifier.
const IDENTIFIER = /^[A-Za-z_][A-Za-z0-9_]{0,62}$/;

const isIdentifier = (value) =>
    typeof value === "string" && IDENTIFIER.test(value);

// Lower-cased because that is how PostgreSQL reads a name left unquoted,
// which is how these names used to reach it.
const quoteIdentifier = (value) => {
    if (!isIdentifier(value)) {
        throw new Error("Not a valid SQL identifier.");
    }
    return `"${value.toLowerCase()}"`;
};

const quoteQualifiedName = (value) => {
    const parts = typeof value === "string" ? value.split(".") : [];
    if (parts.length < 1 || parts.length > 2) {
        throw new Error("Not a valid SQL name.");
    }
    return parts.map(quoteIdentifier).join(".");
};

module.exports = { isIdentifier, quoteIdentifier, quoteQualifiedName };
