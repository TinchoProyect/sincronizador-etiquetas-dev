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
        const sql = fs.readFileSync(path.join(__dirname, '..', 'src', 'logistica', 'migrations', '18_drop_fk_bunker_articulos_reposicion_mapeo.sql'), 'utf-8');
        await client.query(sql);
        console.log("Migration 18 successful: bunker_articulos_reposicion_mapeo_bunker_articulo_id_fkey constraint dropped!");
    } catch(err) {
        console.error("Migration 18 failed:", err);
    } finally {
        client.release();
        process.exit(0);
    }
}

migrate();
