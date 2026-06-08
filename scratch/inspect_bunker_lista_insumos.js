const path = require('path');
const db = require(path.join(__dirname, '../src/produccion/config/database.js'));

async function run() {
    let client;
    try {
        const pool = db.pool || db;
        client = await pool.connect();
        const res = await client.query(`
            SELECT column_name, data_type 
            FROM information_schema.columns 
            WHERE table_name = 'bunker_lista_insumos'
        `);
        console.log('Columns in bunker_lista_insumos:', res.rows);
    } catch (e) {
        console.error('Error:', e);
    } finally {
        if (client) client.release();
        process.exit(0);
    }
}

run();
