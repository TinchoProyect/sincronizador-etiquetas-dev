const pool = require('../src/produccion/config/database');

async function check() {
    let client = await pool.connect();
    try {
        const {rows} = await client.query(`
            SELECT event_object_table, trigger_name, action_statement
            FROM information_schema.triggers
            WHERE event_object_table = 'mantenimiento_movimientos';
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
