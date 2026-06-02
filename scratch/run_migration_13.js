require('dotenv').config();
const { ejecutarQuery } = require('../src/logistica/config/database');
const fs = require('fs');
const path = require('path');

async function runMigration() {
    try {
        console.log("Running migration 13...");
        const sqlPath = path.join(__dirname, '..', 'src', 'logistica', 'migrations', '13_listas_precios_bunker.sql');
        const sql = fs.readFileSync(sqlPath, 'utf8');
        await ejecutarQuery(sql, [], 'Migration 13');
        console.log("Migration 13 executed successfully!");
    } catch (e) {
        console.error("Migration 13 Failed:", e);
    } finally {
        process.exit(0);
    }
}

runMigration();
