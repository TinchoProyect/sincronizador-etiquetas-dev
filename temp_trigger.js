const pool = require('./src/produccion/config/database');
const fs = require('fs');

async function checkTriggers() {
    try {
        const res = await pool.query(`
            SELECT event_object_table, trigger_name, event_manipulation, action_statement
            FROM information_schema.triggers
            WHERE event_object_table IN ('stock_ventas_movimientos', 'ingredientes_movimientos');
        `);
        fs.writeFileSync('output_test.txt', JSON.stringify(res.rows, null, 2));
    } catch (err) {
        console.error(err);
    } finally {
        pool.end();
    }
}
checkTriggers();
