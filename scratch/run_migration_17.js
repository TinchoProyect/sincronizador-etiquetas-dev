const fs = require('fs');
const path = require('path');

async function migrate() {
    // Buscar la conexión en src/produccion/config/database.js
    const dbPath = path.join(__dirname, '..', 'src', 'produccion', 'config', 'database.js');
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
        const sql = fs.readFileSync(path.join(__dirname, '..', 'src', 'logistica', 'migrations', '17_modulo_valores_y_costo_patron.sql'), 'utf-8');
        await client.query(sql);
        console.log("Migration 17 successful: costo_patron column added!");
    } catch(err) {
        console.error("Migration 17 failed:", err);
    } finally {
        client.release();
        process.exit(0);
    }
}

migrate();
