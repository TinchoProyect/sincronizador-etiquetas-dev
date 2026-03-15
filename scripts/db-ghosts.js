const pool = require('../src/produccion/config/database');
const fs = require('fs');
async function checkGhosts() {
    let client = await pool.connect();
    try {
        const {rows} = await client.query(`
            SELECT mm.articulo_numero,
                   SUM(CASE WHEN estado = 'PENDIENTE' AND tipo_movimiento IN ('TRASLADO_INTERNO_VENTAS', 'TRASLADO_INTERNO_INGREDIENTES') THEN cantidad ELSE 0 END) as ui_traslados_pendientes,
                   SUM(CASE WHEN tipo_movimiento IN ('LIBERACION', 'TRANSF_INGREDIENTE') AND estado NOT IN ('REVERTIDO') THEN cantidad ELSE 0 END) as db_consumos
            FROM mantenimiento_movimientos mm
            GROUP BY mm.articulo_numero
            HAVING SUM(CASE WHEN estado = 'PENDIENTE' AND tipo_movimiento IN ('TRASLADO_INTERNO_VENTAS', 'TRASLADO_INTERNO_INGREDIENTES') THEN cantidad ELSE 0 END) > 0
               AND SUM(CASE WHEN tipo_movimiento IN ('LIBERACION', 'TRANSF_INGREDIENTE') AND estado NOT IN ('REVERTIDO') THEN cantidad ELSE 0 END) > 0
        `);
        fs.writeFileSync('scripts/out-ghosts.json', JSON.stringify(rows, null, 2));
        console.log("Done");
    } catch(e) {
        console.error(e);
    } finally {
        client.release();
        pool.end();
    }
}
checkGhosts();
