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
        console.log("Applying migration 22 (add_exencion_operativa)...");
        const sql = fs.readFileSync(path.join(__dirname, 'src', 'logistica', 'migrations', '22_add_exencion_operativa_to_bunker_lista_articulos.sql'), 'utf-8');
        await client.query(sql);
        console.log("Migration 22 successful!");
    } catch(err) {
        console.error("Migration 22 failed:", err);
    } finally {
        client.release();
        process.exit(0);
    }
}

migrate();
