const { Pool } = require('pg');
const pool = new Pool({ connectionString: 'postgres://postgres:ta3Mionga@localhost:5432/etiquetas' });

async function run() {
    try {
        const res = await pool.query(`
            SELECT 
                trigger_name,
                event_manipulation,
                event_object_table AS table_name,
                action_statement
            FROM 
                information_schema.triggers
            WHERE 
                event_object_table IN ('stock_ventas_movimientos', 'stock_real_consolidado');
        `);
        console.log("Triggers on stock_ventas_movimientos and stock_real_consolidado:");
        console.table(res.rows);
    } catch (err) {
        console.error(err);
    } finally {
        pool.end();
    }
}

run();
