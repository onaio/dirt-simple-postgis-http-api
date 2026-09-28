const fs = require("fs");

const { quoteIdentifier, quoteQualifiedName } = require("./identifiers");

const POSITIVE_INTEGER = /^[1-9][0-9]*$/;

const REQUIRED = [
    "POSTGRES_CONNECTION",
    "TABLE_NAME",
    "TABLE_COLUMN",
    "ONADATA_URL",
    "FORMS_ENDPOINT",
    "DATAVIEWS_ENDPOINT",
    "MERGED_DATASETS_ENDPOINT",
];

const positiveInteger = (env, name) => {
    if (env[name] === undefined) {
        return null;
    }
    if (!POSITIVE_INTEGER.test(env[name])) {
        throw new Error(`${name} must be a positive integer.`);
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

const certificateAuthority = (env) => {
    if (env.SSL_ROOT_CERT) {
        return env.SSL_ROOT_CERT;
    }
    if (env.SSL_ROOT_CERT_PATH) {
        return fs.readFileSync(env.SSL_ROOT_CERT_PATH).toString();
    }
    return null;
};

const postgresOptions = (env) => {
    const ca = certificateAuthority(env);
    const statementTimeout = positiveInteger(env, "POSTGRES_STATEMENT_TIMEOUT");
    const connectionTimeout = positiveInteger(
        env,
        "POSTGRES_CONNECTION_TIMEOUT",
    );
    const poolMax = positiveInteger(env, "POSTGRES_POOL_MAX");

    return {
        connectionString: env.POSTGRES_CONNECTION,
        ...(ca === null ? {} : { ssl: { ca } }),
        ...(poolMax === null ? {} : { max: poolMax }),
        ...(statementTimeout === null
            ? {}
            : { statement_timeout: statementTimeout }),
        ...(connectionTimeout === null
            ? {}
            : { connectionTimeoutMillis: connectionTimeout }),
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
    exposeRoute: true,
    hideUntagged: true,
    swagger: {
        basePath: env.BASE_PATH || "/",
        info: {
            title: "Dirt-Simple PostGIS HTTP API",
            description:
                "The Dirt-Simple PostGIS HTTP API is an easy way to expose geospatial functionality to your applications. It takes simple requests over HTTP and returns JSON, JSONP, or protobuf (Mapbox Vector Tile) to the requester. Although the focus of the project has generally been on exposing PostGIS functionality to web apps, you can use the framework to make an API to any database.",
            version: env.npm_package_version || "",
        },
        externalDocs: {
            url: "https://github.com/tobinbradley/dirt-simple-postgis-http-api",
            description: "Source code on Github",
        },
        tags: [
            {
                name: "api",
                description: "code related end-points",
            },
            {
                name: "feature",
                description: "features in common formats for direct mapping.",
            },
            {
                name: "meta",
                description: "meta information for tables and views.",
            },
        ],
    },
});

module.exports = {
    checkConfiguration,
    requestsPerMinute,
    postgresOptions,
    allowedOrigins,
    trustedProxy,
    swaggerOptions,
};
