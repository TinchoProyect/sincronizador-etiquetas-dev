const pool = require('../src/produccion/config/database');

async function debug() {
    try {
        const { rows: stock } = await pool.query(`
            SELECT articulo_numero, stock_consolidado, stock_mantenimiento
            FROM stock_real_consolidado
            WHERE stock_mantenimiento < 0
        `);
        console.log("NEGATIVE STOCK:", stock);
    } catch (e) {
        console.error(e);
    } finally {
        pool.end();
    }
}
debug();
