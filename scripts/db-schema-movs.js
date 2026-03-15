const pool = require('../src/produccion/config/database');

async function check() {
    let client = await pool.connect();
    try {
        const {rows} = await client.query(`
            SELECT column_name, data_type, character_maximum_length
            FROM information_schema.columns
            WHERE table_name = 'mantenimiento_movimientos';
        `);
        console.table(rows);
    } catch(e) {
        console.error(e);
    } finally {
        client.release();
        pool.end();
    }
}
check();
