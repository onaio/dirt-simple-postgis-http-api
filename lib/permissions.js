const axios = require("axios");

const { InvalidRequestError } = require("./errors");
const { parseDataset } = require("./dataset");

const UPSTREAM_TIMEOUT_MS = 10000;
const TEMP_TOKEN = /^[A-Za-z0-9\-._~+/]{1,256}={0,2}$/;

const parseTempToken = (value) => {
    if (value === undefined || value === "") {
        return null;
    }
    if (typeof value !== "string" || !TEMP_TOKEN.test(value)) {
        throw new InvalidRequestError("temp_token is not valid.");
    }
    return value;
};

const permissionEndpoint = (env, { formId, dataviewId, mergedDatasetId }) => {
    if (dataviewId !== null) {
        return `${env.ONADATA_URL}${env.DATAVIEWS_ENDPOINT}${dataviewId}.json`;
    }
    if (mergedDatasetId !== null) {
        return `${env.ONADATA_URL}${env.MERGED_DATASETS_ENDPOINT}${mergedDatasetId}.json`;
    }
    return `${env.ONADATA_URL}${env.FORMS_ENDPOINT}${formId}.json`;
};

const isPublicRoute = (request) =>
    request.routeOptions.config?.public === true;

const deny = (request, reply, error) => {
    const upstreamStatus = error.response ? error.response.status : undefined;
    request.log.warn(
        { upstreamStatus, code: error.code },
        "permission check failed",
    );

    if (upstreamStatus >= 400 && upstreamStatus < 500) {
        return reply.code(upstreamStatus).send({ error: "Permission denied." });
    }
    return reply
        .code(upstreamStatus >= 500 ? upstreamStatus : 500)
        .send({ error: "Permission check failed." });
};

const createPermissionCheck = (env) => async (request, reply) => {
    if (request.is404 || isPublicRoute(request)) {
        return undefined;
    }
    const dataset = parseDataset(request.query);
    const tempToken = parseTempToken(request.query.temp_token);

    try {
        const response = await axios.get(permissionEndpoint(env, dataset), {
            headers: tempToken
                ? { Authorization: `TempToken ${tempToken}` }
                : {},
            timeout: UPSTREAM_TIMEOUT_MS,
        });
        if (response.status !== 200) {
            return reply.code(403).send({ error: "Permission denied." });
        }
        return undefined;
    } catch (error) {
        return deny(request, reply, error);
    }
};

module.exports = { createPermissionCheck, isPublicRoute };
