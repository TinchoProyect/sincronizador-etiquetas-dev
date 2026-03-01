const pool = require('./src/produccion/config/database.js');

async function fixTomate() {
    try {
        console.log('Iniciando rescate de TT8x1M...');

        const res1 = await pool.query(`
            UPDATE public.mantenimiento_movimientos
            SET estado = 'FINALIZADO',
                observaciones = COALESCE(observaciones, '') || ' [FIX MANUAL: Rescate Tomate Triturado - Enviado a Ventas]'
            WHERE tipo_movimiento = 'INGRESO'
              AND estado = 'CONCILIADO'
              AND articulo_numero = 'TT8x1M'
            RETURNING id;
        `);
        console.log('Movimientos actualizados:', res1.rowCount);

        const res2 = await pool.query(`
            UPDATE public.stock_real_consolidado
            SET stock_consolidado = stock_consolidado - stock_mantenimiento,
                stock_ajustes = COALESCE(stock_ajustes, 0) + stock_mantenimiento,
                stock_mantenimiento = 0,
                ultima_actualizacion = NOW()
            WHERE articulo_numero = 'TT8x1M'
              AND stock_mantenimiento > 0
            RETURNING articulo_numero;
        `);
        console.log('Stock consolidado actualizado:', res2.rowCount);

        console.log('¡Rescate completado con éxito!');
    } catch (e) {
        console.error('Error:', e);
    } finally {
        process.exit(0);
    }
}

fixTomate();
