// Simple test script for MVT SQL query generation
require("dotenv").config();

// Set required environment variables for testing
process.env.TABLE_NAME = process.env.TABLE_NAME || "logger_instance";
process.env.TABLE_COLUMN = process.env.TABLE_COLUMN || "geom";

// Import the sql function from the actual mvt.js file
const { sql } = require("../routes/mvt");

// Test cases
const testCases = [
    {
        name: "Regular Form",
        params: { z: 10, x: 512, y: 512 },
        query: {
            form_id: 842230,
            columns: "name, description",
        },
    },
    {
        name: "Merged Dataset",
        params: { z: 10, x: 512, y: 512 },
        query: {
            merged_dataset_id: 852601,
        },
    },
    {
        name: "Dataview",
        params: { z: 10, x: 512, y: 512 },
        query: {
            dataview_id: 12345,
        },
    },
    {
        name: "Regular Form with ID Column",
        params: { z: 10, x: 512, y: 512 },
        query: {
            form_id: 842230,
            id_column: "id",
        },
    },
    {
        name: "Regular Form with Field Filter",
        params: { z: 10, x: 512, y: 512 },
        query: {
            form_id: 842230,
            field_name: "status",
            field_value: "approved",
        },
    },
];

console.log("=".repeat(80));
console.log("MVT SQL Query Generation Tests");
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
        const hasMvtgeom2 = generatedSql.includes("mvtgeom2");
        const hasDataviewFilters = generatedSql.includes("dataview_filters");

        console.log("\nValidation:");
        console.log(`  ✓ Has relevant_xforms CTE: ${hasRelevantXforms ? "YES" : "NO"}`);
        console.log(`  ✓ Has mvtgeom2 CTE: ${hasMvtgeom2 ? "YES" : "NO"}`);
        console.log(`  ✓ Has dataview_filters CTE: ${hasDataviewFilters ? "YES" : "NO"}`);

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
