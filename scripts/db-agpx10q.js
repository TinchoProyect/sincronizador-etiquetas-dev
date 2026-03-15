const pool = require('../src/produccion/config/database');
const fs = require('fs');

async function debug() {
    try {
        const { rows: stock } = await pool.query(`
            SELECT articulo_numero, stock_consolidado, stock_mantenimiento
            FROM stock_real_consolidado
            WHERE articulo_numero = 'AGPX10Q'
        `);
        
        const { rows: movs } = await pool.query(`
            SELECT id, tipo_movimiento, cantidad, estado, fecha_movimiento 
            FROM mantenimiento_movimientos
            WHERE articulo_numero = 'AGPX10Q'
            ORDER BY fecha_movimiento DESC
        `);
        
        const data = { stock, movs };
        fs.writeFileSync('scripts/db-test-out.json', JSON.stringify(data, null, 2), 'utf-8');
        console.log("Done");
    } catch (e) {
        console.error(e);
    } finally {
        pool.end();
    }
}
debug();
