const path = require('path');
const db = require(path.join(__dirname, '../src/produccion/config/database.js'));

async function run() {
    let client;
    try {
        const pool = db.pool || db;
        client = await pool.connect();
        await client.query(`
            ALTER TABLE public.bunker_lista_insumos 
            ADD COLUMN IF NOT EXISTS incluido BOOLEAN DEFAULT FALSE;
        `);
        console.log('Successfully added incluido column to bunker_lista_insumos!');
    } catch (e) {
        console.error('Error:', e);
    } finally {
        if (client) client.release();
        process.exit(0);
    }
}

run();
