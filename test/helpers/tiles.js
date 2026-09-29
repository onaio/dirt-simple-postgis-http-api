const { VectorTile } = require("@mapbox/vector-tile");
const Protobuf = require("pbf");

const WORLD_TILE = "/v1/mvt/0/0/0";

const tileAt = ({ lng, lat }, z) => {
    const latitude = (lat * Math.PI) / 180;
    const x = Math.floor(((lng + 180) / 360) * 2 ** z);
    const y = Math.floor(
        ((1 - Math.log(Math.tan(latitude) + 1 / Math.cos(latitude)) / Math.PI) /
            2) *
            2 ** z,
    );
    return `/v1/mvt/${z}/${x}/${y}`;
};

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
    tileAt,
    layerFeatures,
    layerNames,
    tileProperties,
    tileIds,
};
