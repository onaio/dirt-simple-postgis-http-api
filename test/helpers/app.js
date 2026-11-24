const { build } = require("../../app");
const { testEnv } = require("./env");
const { startOnadataStub } = require("./onadata-stub");

const PROBE = "/v1/probe";

// find-my-way's default limit on the length of a path parameter.
const ROUTER_MAX_PARAM_LENGTH = 100;
const LONGER_THAN_ROUTER_READS = "9".repeat(ROUTER_MAX_PARAM_LENGTH + 1);

// Routes are registered as plugins so that they load after the app's own
// plugins, the way the real routes do.
const probe = async (instance) => {
    instance.get(PROBE, (request, reply) => reply.send("reached"));
};

const withServer = async (app, routes, run) => {
    [probe, ...routes].forEach((route) => app.register(route));
    try {
        return await run(app);
    } finally {
        await app.close();
    }
};

const withApp = async ({ respond, env = {}, routes = [] } = {}, run) => {
    const onadata = await startOnadataStub(respond);
    try {
        const app = await build(testEnv({ ONADATA_URL: onadata.url, ...env }));
        return await withServer(app, routes, (server) =>
            run({ app: server, onadata }),
        );
    } finally {
        await onadata.close();
    }
};

const query = (parameters) => new URLSearchParams(parameters).toString();

module.exports = { PROBE, LONGER_THAN_ROUTER_READS, withApp, query };
