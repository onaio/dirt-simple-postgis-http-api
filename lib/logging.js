const REDACTED = "[redacted]";
const SECRET_PARAMETERS = ["temp_token"];

// Where the query begins, after which ? is an ordinary character and only
// these part the parameters.
const QUERY_BEGINS = /[?;#]/;
const BETWEEN_PARAMETERS = /([&;#])/;
const BETWEEN_SEGMENTS = /([/;#])/;
const BEHIND_A_QUESTION = /(\?)/;

const nameOf = (written) => {
    try {
        return decodeURIComponent(written).toLowerCase();
    } catch (error) {
        return written.toLowerCase();
    }
};

// A name and its value wherever they stand in the address: the value of a
// secret is as secret in a path as in a query.
const hideSecret = (part) => {
    const equals = part.indexOf("=");
    const name = part.slice(0, equals);

    return equals !== -1 && SECRET_PARAMETERS.includes(nameOf(name))
        ? `${name}=${REDACTED}`
        : part;
};

const redactParts = (text, between, hide) =>
    text
        .split(between)
        .map((part, index) => (index % 2 === 0 ? hide(part) : part))
        .join("");

// A secret's own value may hold a question mark, so one is only looked
// behind when the parameter it belongs to is no secret itself.
const hideParameter = (part) => {
    const hidden = hideSecret(part);

    return hidden === part
        ? redactParts(part, BEHIND_A_QUESTION, hideSecret)
        : hidden;
};

const redactUrl = (url) => {
    const query = url.search(QUERY_BEGINS);
    if (query === -1) {
        return redactParts(url, BETWEEN_SEGMENTS, hideSecret);
    }
    return (
        redactParts(url.slice(0, query), BETWEEN_SEGMENTS, hideSecret) +
        url[query] +
        redactParts(url.slice(query + 1), BETWEEN_PARAMETERS, hideParameter)
    );
};

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
