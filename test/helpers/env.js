const UNREACHABLE_POSTGRES = "postgres://nobody:nothing@127.0.0.1:1/none";
const UNREACHABLE_ONADATA = "http://127.0.0.1:1";

const testEnv = (overrides = {}) => ({
    POSTGRES_CONNECTION: UNREACHABLE_POSTGRES,
    TABLE_NAME: "logger_instance",
    TABLE_COLUMN: "geom",
    ONADATA_URL: UNREACHABLE_ONADATA,
    FORMS_ENDPOINT: "/api/v1/forms/",
    DATAVIEWS_ENDPOINT: "/api/v1/dataviews/",
    MERGED_DATASETS_ENDPOINT: "/api/v1/merged-datasets/",
    CORS_ORIGINS: "https://maps.example.test",
    ...overrides,
});

module.exports = { testEnv };
