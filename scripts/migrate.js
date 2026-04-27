require('dotenv').config();
const { ejecutarQuery } = require('../src/logistica/config/database');
const fs = require('fs');

async function runMigration() {
    try {
        console.log("Running migration...");
        const sql = fs.readFileSync('src/logistica/migrations/09_centralizacion_semantica.sql', 'utf8');
        await ejecutarQuery(sql, [], 'Migration 09');
        console.log("Migration OK");
    } catch (e) {
        console.error("Migration Failed:", e);
    } finally {
        process.exit(0);
    }
}

runMigration();
