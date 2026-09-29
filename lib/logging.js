const REDACTED = "[redacted]";
const SECRET_PARAMETERS = ["temp_token"];

// A name and its value wherever they stand in the address, whatever they
// follow: the value of a secret is as secret in a path as in a query.
const PARAMETER = /([^/?&;#=]+)=([^&;#]*)/g;

const nameOf = (written) => {
    try {
        return decodeURIComponent(written).toLowerCase();
    } catch (error) {
        return written.toLowerCase();
    }
};

const redactUrl = (url) =>
    url.replace(PARAMETER, (parameter, name) =>
        SECRET_PARAMETERS.includes(nameOf(name))
            ? `${name}=${REDACTED}`
            : parameter,
    );

const serializeRequest = (request) => ({
    method: request.method,
    url: redactUrl(request.url),
    version: request.headers && request.headers["accept-version"],
    hostname: request.hostname,
    remoteAddress: request.ip,
    remotePort: request.socket ? request.socket.remotePort : undefined,
});

const LEVELS = ["fatal", "error", "warn", "info", "debug", "trace", "silent"];
const OFF = [undefined, "", "false"];

const loggerOptions = (env) => {
    if (OFF.includes(env.SERVER_LOGGER)) {
        return false;
    }
    const level = env.SERVER_LOGGER === "true" ? "info" : env.SERVER_LOGGER;
    if (!LEVELS.includes(level)) {
        throw new Error(
            `SERVER_LOGGER must be one of true, false, ${LEVELS.join(", ")}.`,
        );
    }
    const options = { level, serializers: { req: serializeRequest } };

    return "SERVER_LOGGER_PATH" in env
        ? { ...options, file: env.SERVER_LOGGER_PATH }
        : options;
};

module.exports = { redactUrl, loggerOptions };
