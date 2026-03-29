const pool = require('./src/config/db');

async function findRecords() {
    try {
        console.log("Buscando en mantenimiento_movimientos para clientes 621 y 387...");
        const resMov = await pool.query(`
            SELECT id, articulo_numero, estado, tipo_movimiento, cliente_id, observaciones 
            FROM mantenimiento_movimientos 
            WHERE cliente_id IN (621, 387)
        `);
        console.table(resMov.rows);

        console.log("------------------------");
        const resEsp = await pool.query(`
            SELECT id, cliente_id, articulo_numero, estado FROM mantenimiento_pendientes
            -- Esta tabla puede no existir, probamos --
        `).catch(() => console.log('Sin tabla dedicada'));

        pool.end();
    } catch (e) {
        console.log(e.message);
        pool.end();
    }
}
findRecords();
