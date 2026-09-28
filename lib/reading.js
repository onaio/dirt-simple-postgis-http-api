const { ServiceError } = require("./errors");
const { datasetLookup, readDataset } = require("./submissions");

const connect = async (pg) => {
    try {
        return await pg.connect();
    } catch (error) {
        throw new ServiceError("Database connection error.", error);
    }
};

const run = async (client, { text, values }) => {
    const { rows } = await client.query(text, values);
    return rows;
};

const readRows = async (client, dataset, build) => {
    const lookup = datasetLookup(dataset);
    const found = lookup === null ? [] : await run(client, lookup);
    const resolved = readDataset(dataset, found);

    return resolved.xformIds.length === 0 ? [] : run(client, build(resolved));
};

const readSubmissions = async ({ pg, dataset, build }) => {
    const client = await connect(pg);
    try {
        return await readRows(client, dataset, build);
    } catch (error) {
        throw new ServiceError("Query failed.", error);
    } finally {
        client.release();
    }
};

module.exports = { readSubmissions };
