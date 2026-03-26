const { Pool } = require('pg');
const pool = new Pool({
    user: 'postgres',
    host: 'localhost',
    database: 'etiquetas',
    password: 'root',
    port: 5432
});

async function run() {
    try {
        const query2 = "DELETE FROM mantenimiento_movimientos WHERE articulo_numero IS NULL AND ingrediente_id IS NULL";
        const r2 = await pool.query(query2);
        console.log('Deleted total nulls from movimientos: ', r2.rowCount);

        const query3 = "DELETE FROM mantenimiento_tratamientos_items WHERE articulo_numero IS NULL AND ingrediente_id IS NULL";
        const r3 = await pool.query(query3);
        console.log('Deleted null items in tents: ', r3.rowCount);
    } catch(ex) {
        console.error('E', ex);
    } finally {
        pool.end();
    }
}
run();
