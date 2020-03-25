const path = require('path')
const config = require('./config')
const axios = require('axios')
const fastify = require('fastify')({
  logger: config.allowLogging
})

// middleware 

fastify.use((req, res, done) => {
  const tempToken = req && req.url && req.url.split('temp_token=')[1];
  const referer = req && req.headers && req.headers.referer && req.headers.referer.split('/');
  const formId = referer && referer[referer.length - 1];
  if (tempToken) {
    axios.get(`${config.onadata.formsEndpoint}${formId}.json`, {
      headers: {
        'Authorization': `TempToken ${tempToken}`
      }
    }).then((res) => {
      if (res && res.status === 200) {
        done();
      } else {
        done("Forbidden")
      }
    });
  } else {
    done("Authentication Failure")
  }
});

// postgres connection
fastify.register(require('fastify-postgres'), {
  connectionString: config.db
})

// compression - add x-protobuf
fastify.register(
  require('fastify-compress'), {
    customTypes: /^text\/|\+json$|\+text$|\+xml|x-protobuf$/
  }
)

// cache
fastify.register(
  require('fastify-caching'), {
    privacy: 'private',
    expiresIn: config.cache
  }
)

// CORS
fastify.register(require('fastify-cors'), config.fastifyCorsOptions)

// swagger
fastify.register(require('fastify-swagger'), {
  exposeRoute: true,
  swagger: config.swagger
})

// static documentation path
fastify.register(require('fastify-static'), {
  root: path.join(__dirname, 'documentation')
})

// routes
fastify.register(require('fastify-autoload'), {
  dir: path.join(__dirname, 'routes')
})

// Launch server
fastify.listen(config.port, config.host || 'localhost', function (err, address) {
  if (err) {
    console.log(err)
    process.exit(1)
  }
  console.info(`Server listening on ${address}`)
})