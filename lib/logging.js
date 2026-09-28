const REDACTED = "[redacted]";
const SECRET_PARAMETERS = ["temp_token"];

const redactUrl = (url) => {
    const separator = url.indexOf("?");
    if (separator === -1) {
        return url;
    }
    const parameters = [...new URLSearchParams(url.slice(separator + 1))];
    if (!parameters.some(([name]) => SECRET_PARAMETERS.includes(name))) {
        return url;
    }
    const redacted = parameters.map(([name, value]) =>
        SECRET_PARAMETERS.includes(name) ? [name, REDACTED] : [name, value],
    );

    return `${url.slice(0, separator)}?${new URLSearchParams(redacted)}`;
};

const serializeRequest = (request) => ({
    method: request.method,
    url: redactUrl(request.url),
    version: request.headers && request.headers["accept-version"],
    hostname: request.hostname,
    remoteAddress: request.ip,
    remotePort: request.socket ? request.socket.remotePort : undefined,
});

const loggerOptions = (env) => {
    if (!("SERVER_LOGGER" in env)) {
        return false;
    }
    const level = env.SERVER_LOGGER === "true" ? "info" : env.SERVER_LOGGER;
    const options = { level, serializers: { req: serializeRequest } };

    return "SERVER_LOGGER_PATH" in env
        ? { ...options, file: env.SERVER_LOGGER_PATH }
        : options;
};

module.exports = { redactUrl, loggerOptions };
