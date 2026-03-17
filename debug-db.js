const pool = require('./src/produccion/config/database.js');

async function run() {
    try {
        const r = await pool.query("SELECT id, articulo_numero, id_presupuesto_origen, estado, observaciones, cantidad FROM mantenimiento_movimientos WHERE articulo_numero = 'AAIx5' AND tipo_movimiento = 'INGRESO' ORDER BY id DESC LIMIT 5");
        require('fs').writeFileSync('debug-db-out.json', JSON.stringify(r.rows, null, 2));
        console.log("MOVIMIENTOS DE INGRESO AAIx5 GUARDADOS");
    } catch(e) {
        console.error("DB Error:", e);
    } finally {
        pool.end();
        process.exit();
    }
}
run();
