const pool = require('../src/produccion/config/database');

async function fix() {
    let client;
    try {
        client = await pool.connect();
        await client.query('BEGIN');

        const { rowCount: updated } = await client.query(`
            WITH calculo_stock AS (
                SELECT 
                    articulo_numero,
                    SUM(CASE 
                        WHEN tipo_movimiento IN ('INGRESO', 'TRASLADO_INTERNO_VENTAS', 'TRASLADO_INTERNO_INGREDIENTES') THEN cantidad 
                        WHEN tipo_movimiento IN ('LIBERACION', 'TRANSF_INGREDIENTE') THEN -cantidad
                        ELSE 0 
                    END) AS stock_calculado
                FROM public.mantenimiento_movimientos
                WHERE estado NOT IN ('REVERTIDO', 'ANULADO')
                GROUP BY articulo_numero
                HAVING articulo_numero IS NOT NULL
            )
            UPDATE public.stock_real_consolidado src
            SET stock_mantenimiento = COALESCE(cs.stock_calculado, 0)
            FROM calculo_stock cs
            WHERE src.articulo_numero = cs.articulo_numero
              AND src.stock_mantenimiento != COALESCE(cs.stock_calculado, 0)
        `);
        console.log("Filas corregidas por movimientos asincronos:", updated);

        const { rowCount: reset } = await client.query(`
            UPDATE public.stock_real_consolidado src
            SET stock_mantenimiento = 0
            WHERE stock_mantenimiento != 0
              AND NOT EXISTS (
                  SELECT 1 FROM public.mantenimiento_movimientos mm 
                  WHERE mm.articulo_numero = src.articulo_numero 
                  AND mm.estado NOT IN ('REVERTIDO', 'ANULADO')
              )
        `);
        console.log("Filas reseteadas a 0 por falta de movimientos:", reset);

        await client.query('COMMIT');
    } catch (e) {
        if (client) await client.query('ROLLBACK');
        console.error(e);
    } finally {
        if (client) client.release();
        pool.end();
    }
}
fix();
