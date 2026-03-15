const pool = require('../src/produccion/config/database');

async function check() {
    let client = await pool.connect();
    try {
        const {rows} = await client.query(`
            SELECT event_object_table, trigger_name, event_manipulation, action_statement
            FROM information_schema.triggers
            WHERE event_object_table IN ('stock_ventas_movimientos', 'articulos', 'stock_real_consolidado');
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
