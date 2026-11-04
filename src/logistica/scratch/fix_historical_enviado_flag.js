const { pool } = require('../config/database');

async function fixHistoricalEnviadoFlag() {
    console.log('================================================================================');
    console.log('🚀 MARCANDO FACTURAS APROBADAS HISTÓRICAS COMO ENVIADAS (es_enviado = true)');
    console.log('================================================================================\n');

    try {
        const res = await pool.query(`
            UPDATE public.factura_facturas 
            SET es_enviado = true, 
                enviado_at = COALESCE(enviado_at, NOW()), 
                enviado_canal = COALESCE(enviado_canal, 'WhatsApp')
            WHERE (estado = 'APROBADA' OR estado = 'APROBADA_LOCAL')
              AND (es_enviado IS FALSE OR es_enviado IS NULL)
        `);

        console.log(`✅ Se actualizaron ${res.rowCount} facturas históricas como es_enviado = true.`);

        const resCheck = await pool.query(`
            SELECT 
                COUNT(*) FILTER (WHERE estado IN ('BORRADOR', 'RECHAZADA')) as borradores,
                COUNT(*) FILTER (WHERE estado IN ('APROBADA', 'APROBADA_LOCAL') AND es_enviado IS NOT TRUE) as aprobadas_pendientes,
                COUNT(*) FILTER (WHERE es_enviado IS TRUE) as enviadas
            FROM public.factura_facturas
        `);

        console.log('\n📊 Conteo actual de facturas en la BD:');
        console.table(resCheck.rows[0]);

        process.exit(0);
    } catch (e) {
        console.error(e);
        process.exit(1);
    }
}

fixHistoricalEnviadoFlag();
