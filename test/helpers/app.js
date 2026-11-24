const { build } = require("../../app");
const { testEnv } = require("./env");
const { startOnadataStub } = require("./onadata-stub");

const PROBE = "/v1/probe";

// find-my-way reads path parameters up to 100 characters by default.
const LONGER_THAN_ROUTER_READS = "9".repeat(101);

// Registered as a plugin so that it loads after the app's own plugins, the
// way the real routes do.
const probe = async (instance) => {
    instance.get(PROBE, (request, reply) => reply.send("reached"));
};

const withServer = async (app, run) => {
    app.register(probe);
    try {
        return await run(app);
    } finally {
        await app.close();
    }
};

const withApp = async ({ respond, env = {} } = {}, run) => {
    const onadata = await startOnadataStub(respond);
    try {
        const app = await build(testEnv({ ONADATA_URL: onadata.url, ...env }));
        return await withServer(app, (server) => run({ app: server, onadata }));
    } finally {
        await onadata.close();
    }
};

const query = (parameters) => new URLSearchParams(parameters).toString();

module.exports = { PROBE, LONGER_THAN_ROUTER_READS, withApp, query };
