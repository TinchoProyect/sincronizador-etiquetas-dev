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
        const sql = fs.readFileSync(path.join(__dirname, 'src', 'produccion', 'sql', '10_quinto_flujo_mantenimiento.sql'), 'utf-8');
        await client.query(sql);
        console.log("Migration successful!");
    } catch(err) {
        console.error("Migration failed:", err);
    } finally {
        client.release();
        process.exit(0);
    }
}

migrate();
