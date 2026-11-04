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
        console.log("Applying migration 25 (trigger_stock_satelite_venta)...");
        const sql = fs.readFileSync(path.join(__dirname, 'src', 'logistica', 'migrations', '25_trigger_stock_satelite_venta.sql'), 'utf-8');
        await client.query(sql);
        console.log("Migration 25 successful!");
    } catch(err) {
        console.error("Migration 25 failed:", err);
    } finally {
        client.release();
        process.exit(0);
    }
}

migrate();
