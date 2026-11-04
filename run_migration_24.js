const fs = require('fs');
const path = require('path');

async function migrate() {
    const dbPath = path.join(__dirname, 'src', 'produccion', 'config', 'database.js');
    let poolInstance;
    
    try {
        const db = require(dbPath);
        poolInstance = db.pool || db;
    } catch(e) {
        console.log("Could not find db connection module at", dbPath);
        console.error(e);
        process.exit(1);
    }
    
    const client = await poolInstance.connect();
    
    try {
        console.log("Applying migration 24 (produccion_mixta_mermas_satelite)...");
        const sql = fs.readFileSync(path.join(__dirname, 'src', 'logistica', 'migrations', '24_produccion_mixta_mermas_satelite.sql'), 'utf-8');
        await client.query(sql);
        console.log("Migration 24 successful!");
    } catch(err) {
        console.error("Migration 24 failed:", err);
    } finally {
        client.release();
        process.exit(0);
    }
}

migrate();
