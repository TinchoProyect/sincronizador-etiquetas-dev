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
        console.log("Applying migration 11 (ingrediente_bunker_articulos)...");
        const sql = fs.readFileSync(path.join(__dirname, 'src', 'produccion', 'sql', '11_add_bunker_articulo_id_to_ingredientes.sql'), 'utf-8');
        await client.query(sql);
        console.log("Migration 11 successful!");
    } catch(err) {
        console.error("Migration 11 failed:", err);
    } finally {
        client.release();
        process.exit(0);
    }
}

migrate();
