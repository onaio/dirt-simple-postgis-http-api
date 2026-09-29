# Dirt-Simple PostGIS HTTP API

The Dirt-Simple PostGIS HTTP API, or `dirt`, exposes PostGIS functionality to your applications over HTTP.

## Important Note!

**Dirt is now optimized for Postgis 3. If you're using Postgis 2.x, use the [postgis2x](https://github.com/tobinbradley/dirt-simple-postgis-http-api/tree/postgis2x) branch.**

## Getting started

### Requirements

- [Node](https://nodejs.org/)
- [PostgreSQL](https://postgresql.org/) 12 or later, with [PostGIS 3](https://postgis.net/)
- A PostgreSQL login for the service that has select rights to any tables or views you want to expose to dirt.

### Step 1: get the goodies

Note: if you don't have [git](https://git-scm.com/), you can download a [zip file](https://github.com/tobinbradley/dirt-simple-postgis-http-api/archive/master.zip) of the project instead.

```bash
git clone https://github.com/tobinbradley/dirt-simple-postgis-http-api.git dirt
cd dirt
npm install
```

### Step 2: add your configuration

Dirt is configured via environmental variables. These variables can be placed in a `.env` file in the project's root folder, via the command line at run time, or however you set environmental variables on your operating system. Dirt refuses to start when a required variable is missing.

#### `.env` file
```env
POSTGRES_CONNECTION="postgres://user:password@server/database"
```

#### command line, linux and mac
```
POSTGRES_CONNECTION="postgres://user:password@server/database" npm start
```

This is the complete complete list of environmental variables that can be set.

| Variable | Required | Default | Description |
| ----------- | ----------- | ----------- | ----------- |
| POSTGRES_CONNECTION | Yes | N/A | Postgres connection string |
| TABLE_NAME | Yes | N/A | Table holding the submissions, optionally schema-qualified, ex: `logger_instance` |
| TABLE_COLUMN | Yes | N/A | Geometry column of that table, ex: `geom` |
| ONADATA_URL | Yes | N/A | Base URL of the API that decides whether a caller may read a dataset, ex: `https://api.ona.io` |
| FORMS_ENDPOINT | Yes | N/A | Path checked for `form_id`, ex: `/api/v1/forms/` |
| DATAVIEWS_ENDPOINT | Yes | N/A | Path checked for `dataview_id`, ex: `/api/v1/dataviews/` |
| MERGED_DATASETS_ENDPOINT | Yes | N/A | Path checked for `merged_dataset_id`, ex: `/api/v1/merged-datasets/` |
| CORS_ORIGINS | No | undefined | Comma-separated origins allowed to call the API, or `*` for any. No origin is allowed when unset. |
| SERVER_LOGGER | No | undefined | Turn on Fastify's [error logger](https://www.fastify.io/docs/latest/Reference/Logging/). Options are `true` (same as `info`), `fatal`, `error`, `warn`, `info`, `debug`, `trace` or `silent`.  |
| SERVER_LOGGER_PATH | No | undefined | Log to file instead of console, ex: `/path/to/file`  |
| SERVER_HOST | No | 0.0.0.0 | IP to [listen](https://www.fastify.io/docs/latest/Reference/Server/#listen) on, default is all |
| SERVER_PORT | No | 3000 | Port to [listen](https://www.fastify.io/docs/latest/Reference/Server/#listen) on |
| BASE_PATH | No | / | The [base path](https://swagger.io/specification/v2/) on which the API is served, which is relative to the host |
| CACHE_PRIVACY | No | private | [Cache response directive](https://github.com/fastify/fastify-caching) |
| CACHE_EXPIRESIN | No | 3600 | [Max age in seconds](https://github.com/fastify/fastify-caching) |
| CACHE_SERVERCACHE | No | undefined | Max age in seconds for [shared cache](https://github.com/fastify/fastify-caching) (i.e. CDN) |
| RATE_MAX | No | undefined | Requests allowed per minute per caller by the [rate limiter](https://github.com/fastify/fastify-rate-limit). The limiter is off when unset. |
| TRUST_PROXY | No | false | Set when dirt runs behind a proxy, so that a caller is identified by the address the proxy forwards rather than the proxy's own. `true`, a number of hops, or a comma-separated list of proxy addresses. See [trustProxy](https://www.fastify.io/docs/latest/Reference/Server/#trustproxy). |
| POSTGRES_STATEMENT_TIMEOUT | No | 60000 | Milliseconds a statement may run before Postgres stops it. `0` for no limit. |
| POSTGRES_CONNECTION_TIMEOUT | No | 30000 | Milliseconds a request waits for a database connection before failing. `0` for no limit. |
| POSTGRES_POOL_MAX | No | 10 | Most database connections held at once. Each running statement holds one. |
| SSL_ROOT_CERT | No | undefined | Contents of a CA certificate for connecting over SSL. Use this if you need to store the entire certificate in an environment variable, e.g. for Docker. |
| SSL_ROOT_CERT_PATH | No | undefined | Path to a CA certificate file for connecting over SSL. Note that setting `SSL_ROOT_CERT` overrides this. |


### Step 3: fire it up!

```bash
npm start
```

### Running the tests

```bash
npm test
```

The tests that run statements need a PostGIS database they are free to drop and recreate tables in. They are skipped unless `TEST_POSTGRES_CONNECTION` is set, and refuse to run against a database whose name does not end in `_test`.

```bash
docker run -d --rm --name dirt-test-postgis \
  -e POSTGRES_USER=dirt -e POSTGRES_PASS=dirt -e POSTGRES_DBNAME=dirt_test \
  -p 127.0.0.1:55432:5432 kartoza/postgis:17-3.5

TEST_POSTGRES_CONNECTION="postgres://dirt:dirt@127.0.0.1:55432/dirt_test" npm test
```

### Running via Docker

To build a Docker image:

```
docker build -t dirt .
```

To run the Docker image:

```
docker run -dp 3000:3000 --env-file .env dirt
```

The file holds the variables listed above, one `NAME=value` per line.

## Architecture

### Due credit

The real credit for this project goes to the great folks behind the following open source software:

- [PostgreSQL](https://postgresql.org/)
- [PostGIS](https://postgis.net/)
- [Fastify](https://www.fastify.io/)

### How it works

The core of the project is [Fastify](https://www.fastify.io/).

> Fastify is a web framework highly focused on providing the best developer experience with the least overhead and a powerful plugin architecture. It is inspired by Hapi and Express and as far as we know, it is one of the fastest web frameworks in town.

Fastify is written by some of the core Node developers, and it's awesome. A number of Fastify plugins (fastify-autoload, fastify-caching, fastify-compress, fastify-cors, fastify-postgres, and fastify-swagger) are used to abstract away a lot of boilerplate. If you're looking for additional functionality, check out the [Fastify ecosystem](https://www.fastify.io/ecosystem).

All routes are stored in the `routes` folder and are automatically loaded on start. Check out the [routes readme](routes/README.md) for more information.

## Tips and Tricks

### Database

Your Postgres login needs select rights on the submissions table, `logger_dataview`, `logger_mergedxform_xforms` and `logger_xform`.

For security, it should have select rights on those tables _only_.

Dirt uses connection pooling, minimizing database connections.

### Mapbox vector tiles

The `mvt` route serves Mapbox Vector Tiles. The layer name in the returned protobuf is the value of `TABLE_NAME`. Here's an example with MapLibre GL JS.

```javascript
map.on('load', function() {
  map.addLayer({
    id: 'dirt-mvt',
    source: {
      type: 'vector',
      tiles: ['http://localhost:3000/v1/mvt/{z}/{x}/{y}?form_id=842230']
    },
    'source-layer': 'logger_instance',
    type: 'circle',
    paint: {
      'circle-radius': 4,
      'circle-color': '#bada55'
    }
  })
})
```

#### MVT Query Parameters

The `mvt` route supports different query parameters for accessing different types of forms:

- **Regular form**: Use `form_id` parameter
  ```
  /v1/mvt/{z}/{x}/{y}?form_id=842230
  ```

- **Merged dataset**: Use `merged_dataset_id` parameter to fetch data from all constituent forms
  ```
  /v1/mvt/{z}/{x}/{y}?merged_dataset_id=852601
  ```

- **Dataview**: Use `dataview_id` parameter to fetch data with applied filters
  ```
  /v1/mvt/{z}/{x}/{y}?dataview_id=12345
  ```

Exactly one of the three must be given; a request naming more than one is refused. The `bounds` route takes the same parameters.

Add `temp_token` to read a dataset that is not public.

A statement is stopped when the caller that asked for it goes away, as a map does each time it is panned or zoomed.

#### Dataview filters

A filter is compared the way the type of its field asks, which is read from the definition of the form in `logger_xform`:

| Field | Compared as |
| --- | --- |
| type `integer`, and `_id` | a whole number |
| type `decimal` | a number |
| type `date`, and `_submission_time` | a date, or a date and time, written `2024-05-17` or `2024-05-17T10:20:30` |
| any other | text |

A time may carry up to six digits of a second, and a zone, which is not taken into account. A field inside a group is named by its path, `group/field`. Filters marked `"condition": "or"` are alternatives: a submission has to pass one of them, and every filter that is not marked.

Where a filter cannot be applied, submissions are left out rather than shown:

- a submission whose value cannot be read as the type of its field is left out;
- a filter whose value cannot be read as the type of its field, or whose comparison is not one of `=`, `>`, `<`, `>=`, `<=`, `<>` and `!=`, leaves out every submission;
- so does any filter on a form whose definition holds no list of fields.

### Changes require a Restart

If you modify code or add a route, dirt will not see it until dirt is restarted.

### TLS/SSL

If you see an error like

```
no pg_hba.conf entry for host <host>, user <user>, database <database>, no encryption
```

you may need to connect to your server over SSL. Obtain a CA certificate and set `SSL_ROOT_CERT_PATH=<path to the certificate>` in `.env`. If you're still getting an error, check the end of your connection string for `?sslmode=require` and try removing it. You should still be able to connect over SSL.

If you're running Dirt on Docker, it may be easier to pass the contents of the certificate with `SSL_ROOT_CERT`. Example:

```bash
docker run -dp 3000:3000 --env-file .env -e SSL_ROOT_CERT="$(cat ca.crt)" dirt
```

If you can't get a certificate or want to bypass the error, you can try setting `NODE_TLS_REJECT_UNAUTHORIZED=0`. Note that this is unsafe and is not recommended in production.
