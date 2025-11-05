// Simple test script for Bounds SQL query generation
require("dotenv").config();

// Set required environment variables for testing
process.env.TABLE_NAME = process.env.TABLE_NAME || "logger_instance";
process.env.TABLE_COLUMN = process.env.TABLE_COLUMN || "geom";

// Import the sql function from the actual bounds.js file
const { sql } = require("../routes/bounds");

// Test cases
const testCases = [
    {
        name: "Regular Form",
        params: {},
        query: {
            form_id: 842230,
        },
    },
    {
        name: "Regular Form with Limit",
        params: {},
        query: {
            form_id: 842230,
            limit: 1000,
        },
    },
    {
        name: "Merged Dataset",
        params: {},
        query: {
            merged_dataset_id: 852601,
        },
    },
    {
        name: "Dataview",
        params: {},
        query: {
            dataview_id: 12345,
        },
    },
    {
        name: "Regular Form with Field Filter",
        params: {},
        query: {
            form_id: 842230,
            field_name: "status",
            field_value: "approved",
        },
    },
    {
        name: "Merged Dataset with Limit",
        params: {},
        query: {
            merged_dataset_id: 852601,
            limit: 500,
        },
    },
    {
        name: "Dataview with Field Filter",
        params: {},
        query: {
            dataview_id: 12345,
            field_name: "category",
            field_value: "residential",
        },
    },
];

console.log("=".repeat(80));
console.log("Bounds SQL Query Generation Tests");
console.log("=".repeat(80));

testCases.forEach((testCase, index) => {
    console.log(`\n${index + 1}. ${testCase.name}`);
    console.log("-".repeat(80));
    console.log("Parameters:", JSON.stringify(testCase.params, null, 2));
    console.log("Query:", JSON.stringify(testCase.query, null, 2));
    console.log("\nGenerated SQL:");
    console.log("-".repeat(80));

    try {
        const generatedSql = sql(testCase.params, testCase.query);
        console.log(generatedSql);

        // Basic validation
        const hasRelevantXforms = generatedSql.includes("relevant_xforms");
        const hasFilteredData = generatedSql.includes("filtered_data");
        const hasDataviewFilters = generatedSql.includes("dataview_filters");
        const hasBounds = generatedSql.includes("ST_XMin") &&
                         generatedSql.includes("ST_YMin") &&
                         generatedSql.includes("ST_XMax") &&
                         generatedSql.includes("ST_YMax");

        console.log("\nValidation:");
        console.log(`  ✓ Has relevant_xforms CTE: ${hasRelevantXforms ? "YES" : "NO"}`);
        console.log(`  ✓ Has filtered_data CTE: ${hasFilteredData ? "YES" : "NO"}`);
        console.log(`  ✓ Has dataview_filters CTE: ${hasDataviewFilters ? "YES" : "NO"}`);
        console.log(`  ✓ Returns bounds (xMin, yMin, xMax, yMax): ${hasBounds ? "YES" : "NO"}`);

        // Check which parameter is being used
        if (testCase.query.form_id) {
            console.log(`  ✓ Uses form_id: ${generatedSql.includes(`SELECT ${testCase.query.form_id}`) ? "YES" : "NO"}`);
        }
        if (testCase.query.merged_dataset_id) {
            console.log(`  ✓ Uses merged_dataset_id: ${generatedSql.includes(`mergedxform_id = ${testCase.query.merged_dataset_id}`) ? "YES" : "NO"}`);
        }
        if (testCase.query.dataview_id) {
            console.log(`  ✓ Uses dataview_id: ${generatedSql.includes(`id = ${testCase.query.dataview_id}`) ? "YES" : "NO"}`);
        }
        if (testCase.query.limit) {
            console.log(`  ✓ Uses LIMIT: ${generatedSql.includes(`LIMIT ${testCase.query.limit}`) ? "YES" : "NO"}`);
        }
        if (testCase.query.field_name && testCase.query.field_value) {
            console.log(`  ✓ Uses field filter: ${generatedSql.includes(`json->>'${testCase.query.field_name}'='${testCase.query.field_value}'`) ? "YES" : "NO"}`);
        }

    } catch (error) {
        console.error("ERROR:", error.message);
    }
});

console.log("\n" + "=".repeat(80));
console.log("Tests completed!");
console.log("=".repeat(80));
console.log("\nTo run these queries against your database:");
console.log("1. Copy a generated SQL query from above");
console.log("2. Connect to your PostgreSQL database");
console.log("3. Run: psql -d your_database");
console.log("4. Paste and execute the query");
console.log("\nNote: Queries with NULL values won't return results but should execute without errors.");
