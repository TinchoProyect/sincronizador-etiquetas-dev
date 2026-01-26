const { Pool } = require('pg');
require('dotenv').config();

const pool = new Pool({
    user: process.env.DB_USER || 'postgres',
    host: process.env.DB_HOST || 'localhost',
    database: process.env.DB_NAME || 'etiquetas',
    password: process.env.DB_PASSWORD || 'ta3Mionga',
    port: parseInt(process.env.DB_PORT || '5432'),
});

async function repair() {
    try {
        console.log('🔧 Iniciando reparación manual de FK nulo...');

        // 1. Buscar el movimiento que quedó "colgando" (Estado CONCILIADO pero sin link reverso o simplemente el candidato obvio)
        // Buscamos el último ingreso conciliado de este artículo
        const findMov = `
            SELECT mm.id, mm.articulo_numero, mm.fecha_movimiento
            FROM public.mantenimiento_movimientos mm
            JOIN public.presupuestos p ON mm.id_presupuesto_origen = p.id
            WHERE mm.articulo_numero = 'NMELCHx5'
              AND p.id_cliente = '13'
              AND mm.tipo_movimiento = 'INGRESO'
              AND mm.estado = 'CONCILIADO'
            ORDER BY mm.fecha_movimiento DESC
            LIMIT 1
        `;

        const resMov = await pool.query(findMov);

        if (resMov.rows.length === 0) {
            console.log('⚠️ No se encontró el movimiento original (o no está marcado como CONCILIADO todavía).');
            return;
        }

        const idMovimiento = resMov.rows[0].id;
        console.log(`✅ Movimiento encontrado ID: ${idMovimiento} (Fecha: ${resMov.rows[0].fecha_movimiento})`);

        // 2. Actualizar el Item de Conciliación que tiene NULL
        const updateSql = `
            UPDATE public.mantenimiento_conciliacion_items
            SET id_movimiento_origen = $1
            WHERE articulo_numero = 'NMELCHx5'
              AND id_movimiento_origen IS NULL
            RETURNING id
        `;

        const resUpdate = await pool.query(updateSql, [idMovimiento]);

        if (resUpdate.rows.length > 0) {
            console.log(`🎉 Reparación exitosa! Registros actualizados: ${resUpdate.rows.length} (IDs: ${resUpdate.rows.map(r => r.id).join(', ')})`);
        } else {
            console.log('⚠️ No se encontraron items de conciliación con FK nulo para reparar.');
        }

    } catch (e) {
        console.error('❌ Error detallado:', e.message);
        if (e.detail) console.error('   Detalle:', e.detail);
    } finally {
        pool.end();
    }
}

repair();
