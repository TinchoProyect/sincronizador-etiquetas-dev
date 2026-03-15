const pool = require('../src/produccion/config/database');
async function fix() {
    let client = await pool.connect();
    try {
        await client.query('BEGIN');
        const {rowCount} = await client.query(`
            WITH consumos AS (
                SELECT articulo_numero, 
                       SUM(CASE WHEN estado = 'PENDIENTE' AND tipo_movimiento IN ('TRASLADO_INTERNO_VENTAS', 'TRASLADO_INTERNO_INGREDIENTES') THEN cantidad ELSE 0 END) as pendientes,
                       SUM(CASE WHEN tipo_movimiento IN ('LIBERACION', 'TRANSF_INGREDIENTE') AND estado NOT IN ('REVERTIDO') THEN cantidad ELSE 0 END) as consumidos
                FROM public.mantenimiento_movimientos
                GROUP BY articulo_numero
            )
            UPDATE public.mantenimiento_movimientos mm
            SET estado = 'FINALIZADO', observaciones = observaciones || ' [Limpieza de Fantasmas]'
            FROM consumos c
            WHERE mm.articulo_numero = c.articulo_numero
              AND mm.tipo_movimiento IN ('TRASLADO_INTERNO_VENTAS', 'TRASLADO_INTERNO_INGREDIENTES')
              AND mm.estado = 'PENDIENTE'
              AND c.pendientes <= c.consumidos
              AND c.consumidos > 0
        `);
        console.log("Fantasmas limpiados:", rowCount);
        await client.query('COMMIT');
    } catch(e) {
        await client.query('ROLLBACK');
        console.error(e);
    } finally {
        client.release();
        pool.end();
    }
}
fix();
