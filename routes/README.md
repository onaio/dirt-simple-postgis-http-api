# Routes

The `routes` folder contains all of dirt's routes. They are loaded automatically at run time; drop a new route in the `routes` folder, fire up dirt, and the new route is loaded.

Every route is refused until the caller's access to the requested dataset has been confirmed. A route that serves nothing dataset-specific opts out with `config: { public: true }`.

## Route design

Each route contains three sections: sql, schema, and the Fastify route itself.

### sql

```javascript
const { statement, identifier, qualifiedName, render } = require('../lib/statement')

const sql = (params, query, config) => {
  return render(statement`
  SELECT
    ${identifier(config.geomColumn)}

  FROM
    ${qualifiedName(config.tableName)}

  WHERE
    xform_id = ${query.form_id}::int4
  `)
}
```

The `sql` function returns `{ text, values }` for execution by the Postgres server.

Anything interpolated into a `statement` is sent to Postgres as a bound parameter, never as SQL text, so a value from the request cannot change the statement. `text` above ends in `xform_id = $1::int4` and `values` is `[query.form_id]`. Cast each parameter, since Postgres cannot always infer its type.

Table and column names cannot be bound. Pass them through `identifier` or `qualifiedName`, which refuse anything that is not a plain name and quote what they accept. A `statement` can be interpolated into another `statement`; its parameters are renumbered.

The `params` function argument contains route parameters (i.e. parts of the URL path). The `query` function argument contains route query string arguments. The `config` argument holds `tableName` and `geomColumn`.

Inputs the schema cannot fully describe are checked here. Throw `InvalidRequestError` from `lib/errors` to answer with a `400`.

### schema

```javascript
// route schema
const schema = {
  description: 'Returns forms map bounds',
  tags: ['feature'],
  summary: 'Return bounds',
  querystring: {
    form_id: {
      type: 'integer',
      description: 'ID of a regular form to query data from.'
    },
    field_name: {
      type: 'string',
      maxLength: 1024,
      description: 'Optional field name for custom JSON filtering.'
    }
  }
}
```

The `schema` variable documents the route and validates its inputs. Inputs that don't pass validation return an error and are not passed to Postgres. Query string arguments the schema does not name are left in place, so `sql` must read only the ones it expects.

Fastify [recommends](https://www.fastify.io/docs/latest/Validation-and-Serialization/) using [JSON Schema](http://json-schema.org/), which is what dirt uses.

### route

```javascript
// create route
module.exports = function (fastify, opts, next) {
  fastify.route({
    method: 'GET',
    url: '/bounds',
    schema: schema,
    handler: function (request, reply) {
      const { text, values } = sql(request.params, request.query, opts)

      fastify.pg.connect(onConnect)

      function onConnect(err, client, release) {
        if (err) {
          request.log.error(err)
          return reply.code(500).send({ error: 'Database connection error.' })
        }

        client.query(text, values, function onResult(err, result) {
          release()
          if (err) {
            request.log.error(err)
            return reply.code(500).send({ error: 'Query failed.' })
          }
          return reply.send(result.rows[0])
        })
      }
    }
  })
  next()
}

module.exports.autoPrefix = '/v1'
```

Fastify's [route documentation](https://www.fastify.io/docs/latest/Routes/) is excellent if anything here looks confusing. Log a database error and answer with a fixed message; the error's own text describes the schema and stays out of the response.

Route versioning is handled by the final line in the file.

```javascript
module.exports.autoPrefix = '/v1'
```

This value is added to the route as a prefix, i.e. `http://localhost:3000/v1/bounds`. Using a prefix allows for easy versioning if a route is modified by incrementing the number.
