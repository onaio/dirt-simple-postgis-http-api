const http = require("node:http");

const allowEverything = () => ({ status: 200 });

const startOnadataStub = async (respond = allowEverything) => {
    let requests = [];
    const server = http.createServer((req, res) => {
        requests = [
            ...requests,
            {
                method: req.method,
                url: req.url,
                authorization: req.headers.authorization,
            },
        ];
        const { status, body = {} } = respond(req);
        res.writeHead(status, { "Content-Type": "application/json" });
        res.end(JSON.stringify(body));
    });
    await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));

    return {
        url: `http://127.0.0.1:${server.address().port}`,
        requests: () => requests,
        close: () => new Promise((resolve) => server.close(resolve)),
    };
};

module.exports = { startOnadataStub };
