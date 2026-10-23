const fs = require("fs");

const { quoteIdentifier, quoteQualifiedName } = require("./identifiers");

const POSITIVE_INTEGER = /^[1-9][0-9]*$/;
const WHOLE_NUMBER = /^(?:0|[1-9][0-9]*)$/;

// The longest a timer can be set for, and the largest integer PostgreSQL
// takes for a setting.
const LARGEST = 2147483647;

const STATEMENT_TIMEOUT_MS = 60000;
const CONNECTION_TIMEOUT_MS = 30000;

const REQUIRED = [
    "POSTGRES_CONNECTION",
    "TABLE_NAME",
    "TABLE_COLUMN",
    "ONADATA_URL",
    "FORMS_ENDPOINT",
    "DATAVIEWS_ENDPOINT",
    "MERGED_DATASETS_ENDPOINT",
];

const isUnset = (value) => value === undefined || value === "";

const positiveInteger = (env, name) => {
    if (isUnset(env[name])) {
        return null;
    }
    if (!POSITIVE_INTEGER.test(env[name]) || Number(env[name]) > LARGEST) {
        throw new Error(`${name} must be a positive integer.`);
    }
    return Number(env[name]);
};

const timeLimit = (env, name, otherwise) => {
    if (isUnset(env[name])) {
        return otherwise;
    }
    if (!WHOLE_NUMBER.test(env[name]) || Number(env[name]) > LARGEST) {
        throw new Error(
            `${name} must be a number of milliseconds up to ${LARGEST}, or 0 for no limit.`,
        );
    }
    return Number(env[name]);
};

const checkConfiguration = (env) => {
    const missing = REQUIRED.filter((name) => !env[name]);
    if (missing.length > 0) {
        throw new Error(
            `Required ENV variable ${missing.join(", ")} is not set. Please see README.md for more information.`,
        );
    }
    try {
        quoteQualifiedName(env.TABLE_NAME);
        quoteIdentifier(env.TABLE_COLUMN);
    } catch (error) {
        throw new Error(
            "TABLE_NAME must be a table name, optionally schema-qualified, and TABLE_COLUMN a column name.",
        );
    }
};

const requestsPerMinute = (env) => positiveInteger(env, "RATE_MAX");

// Any of these in the connection string replaces the certificate authority
// given beside it, which would then go unused without a word.
const REPLACES_CERTIFICATE = /[?&](?:ssl|sslmode|sslrootcert|sslcert|sslkey)=/;

const readCertificateAuthority = (env) => {
    if (env.SSL_ROOT_CERT) {
        return env.SSL_ROOT_CERT;
    }
    if (env.SSL_ROOT_CERT_PATH) {
        return fs.readFileSync(env.SSL_ROOT_CERT_PATH).toString();
    }
    return null;
};

const certificateAuthority = (env) => {
    const ca = readCertificateAuthority(env);
    if (ca !== null && REPLACES_CERTIFICATE.test(env.POSTGRES_CONNECTION)) {
        throw new Error(
            "SSL_ROOT_CERT and SSL_ROOT_CERT_PATH cannot be used with ssl, sslmode, sslrootcert, sslcert or sslkey in POSTGRES_CONNECTION. Remove them from the connection string.",
        );
    }
    return ca;
};

const postgresOptions = (env) => {
    const ca = certificateAuthority(env);
    const statementTimeout = timeLimit(
        env,
        "POSTGRES_STATEMENT_TIMEOUT",
        STATEMENT_TIMEOUT_MS,
    );
    const connectionTimeout = timeLimit(
        env,
        "POSTGRES_CONNECTION_TIMEOUT",
        CONNECTION_TIMEOUT_MS,
    );
    const poolMax = positiveInteger(env, "POSTGRES_POOL_MAX");

    return {
        connectionString: env.POSTGRES_CONNECTION,
        ...(ca === null ? {} : { ssl: { ca } }),
        ...(poolMax === null ? {} : { max: poolMax }),
        ...(statementTimeout === 0
            ? {}
            : { statement_timeout: statementTimeout }),
        ...(connectionTimeout === 0
            ? {}
            : { connectionTimeoutMillis: connectionTimeout }),
    };
};

const PRIVACIES = ["private", "public", "no-cache"];
const KEPT_FOR_SECONDS = 3600;

const seconds = (env, name, otherwise) => {
    if (isUnset(env[name])) {
        return otherwise;
    }
    if (!WHOLE_NUMBER.test(env[name]) || Number(env[name]) > LARGEST) {
        throw new Error(
            `${name} must be a number of seconds up to ${LARGEST}.`,
        );
    }
    return Number(env[name]);
};

// The caching plugin leaves out a lifetime it reads as absent, and 0 is a
// lifetime: kept by nobody. Given as text, it is told apart from unset.
const lifetime = (value) => (value === undefined ? undefined : String(value));

const cachingOptions = (env) => {
    const privacy = isUnset(env.CACHE_PRIVACY) ? "private" : env.CACHE_PRIVACY;
    if (!PRIVACIES.includes(privacy)) {
        throw new Error(
            `CACHE_PRIVACY must be one of ${PRIVACIES.join(", ")}.`,
        );
    }
    return {
        privacy,
        expiresIn: lifetime(seconds(env, "CACHE_EXPIRESIN", KEPT_FOR_SECONDS)),
        serverExpiresIn: lifetime(
            seconds(env, "CACHE_SERVERCACHE", undefined),
        ),
    };
};

const allowedOrigins = (env) => {
    const origins = (env.CORS_ORIGINS || "")
        .split(",")
        .map((origin) => origin.trim())
        .filter(Boolean);

    return origins.length > 0 ? origins : false;
};

const trustedProxy = (env) => {
    const value = env.TRUST_PROXY;
    if (value === undefined || value === "" || value === "false") {
        return false;
    }
    if (value === "true") {
        return true;
    }
    return POSITIVE_INTEGER.test(value) ? Number(value) : value;
};

const swaggerOptions = (env) => ({
    hideUntagged: true,
    swagger: {
        basePath: env.BASE_PATH || "/",
        info: {
            title: "Dirt-Simple PostGIS HTTP API",
            description:
                "Serves the submissions of a form, a dataview or a merged dataset as Mapbox Vector Tiles, and the bounds that hold them. Every request is refused until the caller's access to the dataset it names has been confirmed.",
            version: env.npm_package_version || "",
        },
        externalDocs: {
            url: "https://github.com/tobinbradley/dirt-simple-postgis-http-api",
            description: "Source code on Github",
        },
        tags: [
            {
                name: "feature",
                description: "features in common formats for direct mapping.",
            },
        ],
    },
});

module.exports = {
    checkConfiguration,
    requestsPerMinute,
    postgresOptions,
    cachingOptions,
    allowedOrigins,
    trustedProxy,
    swaggerOptions,
};
