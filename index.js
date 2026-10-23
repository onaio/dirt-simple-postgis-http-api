require("dotenv").config();

const { build } = require("./app");

build(process.env)
    .then((fastify) =>
        fastify.listen(
            {
                port: process.env.SERVER_PORT || 3000,
                host: process.env.SERVER_HOST || "0.0.0.0",
            },
            (err, address) => {
                if (err) {
                    fastify.log.error(err);
                    process.exit(1);
                }
                fastify.log.info(`Server listening on ${address}`);
            },
        ),
    )
    .catch((err) => {
        process.stderr.write(`Failed to start server: ${err.message}\n`);
        process.exit(1);
    });
