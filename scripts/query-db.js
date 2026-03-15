const pool = require('../src/produccion/config/database');
const fs = require('fs');

async function check() {
    try {
        const { rows: cols } = await pool.query(`
            SELECT column_name, data_type 
            FROM information_schema.columns 
            WHERE table_name='mantenimiento_movimientos'
        `);

        const { rows: func } = await pool.query(`
            SELECT pg_get_functiondef('public.liberar_stock_mantenimiento'::regproc)
        `);

        // Check stock_mantenimiento value inside stock_real_consolidado
        const { rows: sr } = await pool.query(`
            SELECT articulo_numero, stock_mantenimiento 
            FROM stock_real_consolidado 
            LIMIT 5
        `);

        const result = {
            cols: cols,
            func: func[0].pg_get_functiondef,
            s_real: sr
        };

        fs.writeFileSync('scripts/db-out.json', JSON.stringify(result, null, 2), 'utf-8');
        console.log("Written to scripts/db-out.json");
    } catch (e) {
        console.error("DB error", e);
    } finally {
        pool.end();
    }
}
check();
