require('dotenv').config();
const { pool } = require('./src/config/db.js');

async function run() {
    try {
        console.log("🚀 EJECUTANDO RESCATE DE BULTOS");
        
        const resVentas = await pool.query(`
            UPDATE public.mantenimiento_movimientos
            SET 
                estado = 'PENDIENTE',
                observaciones = REPLACE(observaciones, ' [Transferido Mantenimiento -> Ventas]', '')
            WHERE observaciones LIKE '% [Transferido Mantenimiento -> Ventas]'
              AND tipo_movimiento != 'LIBERACION' 
            RETURNING id, articulo_numero, cantidad, observaciones;
        `);
        console.log(`✅ LOTES VENTAS RESCATADOS DEL LIMBO: ${resVentas.rowCount}`);
        resVentas.rows.forEach(r => console.log(r.id, r.articulo_numero, r.cantidad));

        const resIngr = await pool.query(`
            UPDATE public.mantenimiento_movimientos
            SET 
                estado = 'PENDIENTE',
                observaciones = REPLACE(observaciones, ' [Transferido Mantenimiento -> Ingredientes]', '')
            WHERE observaciones LIKE '% [Transferido Mantenimiento -> Ingredientes]'
              AND tipo_movimiento != 'TRANSF_INGREDIENTE'
            RETURNING id, articulo_numero, ingrediente_id, cantidad;
        `);
        console.log(`✅ LOTES GRANEL RESCATADOS: ${resIngr.rowCount}`);

    } catch (e) {
        console.error('❌ Error general:', e.message);
    } finally {
        pool.end();
    }
}
run();
