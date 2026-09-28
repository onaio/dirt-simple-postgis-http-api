const { VectorTile } = require("@mapbox/vector-tile");
const Protobuf = require("pbf");

const WORLD_TILE = "/v1/mvt/0/0/0";

const layerFeatures = (payload, layerName) => {
    const layer = new VectorTile(new Protobuf(payload)).layers[layerName];
    if (!layer) {
        return [];
    }
    return Array.from({ length: layer.length }, (_, index) =>
        layer.feature(index),
    );
};

const layerNames = (payload) =>
    Object.keys(new VectorTile(new Protobuf(payload)).layers);

const tileProperties = (response, layerName = "logger_instance") =>
    response.statusCode === 204
        ? []
        : layerFeatures(response.rawPayload, layerName).map(
              (feature) => feature.properties,
          );

const tileIds = (response) =>
    tileProperties(response)
        .map((properties) => properties.id)
        .sort((a, b) => a - b);

module.exports = {
    WORLD_TILE,
    layerFeatures,
    layerNames,
    tileProperties,
    tileIds,
};
