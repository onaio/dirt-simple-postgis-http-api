const path = require("path");

const {
    checkConfiguration,
    requestsPerMinute,
    postgresOptions,
    cachingOptions,
    allowedOrigins,
    trustedProxy,
    swaggerOptions,
} = require("./lib/configuration");
const { InvalidRequestError, ServiceError } = require("./lib/errors");
const { loggerOptions } = require("./lib/logging");
const { createPermissionCheck, isPublicRoute } = require("./lib/permissions");

const TOO_MANY_REQUESTS = 429;

// Other client errors are raised by the framework and can quote the request.
const hasOwnMessage = (error) =>
    error instanceof InvalidRequestError ||
    Array.isArray(error.validation) ||
    error.statusCode === TOO_MANY_REQUESTS;

const handleError = (error, request, reply) => {
    const isClientError = error.statusCode >= 400 && error.statusCode < 500;
    if (error instanceof ServiceError) {
        request.log.error(error.cause);
        return reply.code(500).send({ error: error.message });
    }
    if (!isClientError) {
        request.log.error(error);
        return reply.code(500).send({ error: "Internal server error." });
    }
    return reply.code(error.statusCode).send({
        error: hasOwnMessage(error)
            ? error.message
            : "The request could not be processed.",
    });
};

// The pool reports a connection lost while it waited to be used as an error
// of its own. With nobody listening, that error ends the process.
const watchIdleConnections = async (fastify) => {
    fastify.pg.pool.on("error", (error) =>
        fastify.log.warn({ code: error.code }, "idle database connection lost"),
    );
};

// A failure that a browser kept would go on being shown after its cause had
// passed.
const keepNoFailure = async (request, reply) => {
    if (reply.statusCode >= 400) {
        reply.header("Cache-Control", "no-store");
    }
};

// No browser sends what follows a hash. It would be read here as a query,
// and by nothing in front of this service.
const refuseFragment = async (request, reply) => {
    if (!request.raw.url.includes("#")) {
        return undefined;
    }
    reply.callNotFound();
    return reply;
};

const handleNotFound = (request, reply) =>
    reply.code(404).send({ error: "Not found." });

async function build(env) {
    checkConfiguration(env);
    const rateLimit = requestsPerMinute(env);
    const permissionCheck = createPermissionCheck(env);

    const fastify = require("fastify")({
        logger: loggerOptions(env),
        trustProxy: trustedProxy(env),
        // A query that began at a semicolon would be read here and by
        // nothing in front of this service.
        useSemicolonDelimiter: false,
    });

    fastify.setErrorHandler(handleError);
    fastify.setNotFoundHandler(handleNotFound);
    fastify.addHook("onSend", keepNoFailure);

    // CORS
    fastify.register(require("@fastify/cors"), {
        origin: allowedOrigins(env),
    });

    // OPTIONAL RATE LIMITER
    if (rateLimit !== null) {
        fastify.register(import("@fastify/rate-limit"), {
            global: false,
            max: rateLimit,
            timeWindow: "1 minute",
            allowList: isPublicRoute,
        });
    }

    // Added once the plugins above have loaded, so that their hooks run
    // first: a refusal can be read across origins, and a rate-limited request
    // costs the permission service nothing.
    fastify.after(() => {
        fastify.addHook("onRequest", refuseFragment);
        if (rateLimit !== null) {
            fastify.addHook("onRequest", fastify.rateLimit());
        }
        // Asked after the request has been checked against the route's
        // schema, so that one the schema refuses costs nothing upstream.
        fastify.addHook("preHandler", permissionCheck);
    });

    fastify.register(require("@fastify/postgres"), postgresOptions(env));
    fastify.register(watchIdleConnections);

    // COMPRESSION
    // add x-protobuf
    fastify.register(require("@fastify/compress"), {
        customTypes: /x-protobuf$/,
    });

    // CACHE SETTINGS
    fastify.register(require("@fastify/caching"), cachingOptions(env));

    // INITIALIZE SWAGGER
    fastify.register(require("@fastify/swagger"), swaggerOptions(env));

    // ADD ROUTES
    fastify.register(require("@fastify/autoload"), {
        dir: path.join(__dirname, "routes"),
        options: {
            tableName: env.TABLE_NAME,
            geomColumn: env.TABLE_COLUMN,
        },
    });

    fastify.get(
        "/health-check",
        { logLevel: "warn", config: { public: true } },
        (request, reply) => {
            reply.send("healthy");
        },
    );

    return fastify;
}

module.exports = { build };
