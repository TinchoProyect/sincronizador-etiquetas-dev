const { pool } = require('../config/database');

async function syncAllActiveBudgetsMetadata() {
    console.log('================================================================================');
    console.log('🚀 POBLANDO ETIQUETAS DE METADATOS EN TODOS LOS PEDIDOS ACTIVOS EN SUPABASE');
    console.log('================================================================================\n');

    try {
        const url = process.env.SUPABASE_B2B_URL;
        const key = process.env.SUPABASE_B2B_SERVICE_KEY;

        const resPres = await pool.query(`
            SELECT p.id, p.id_presupuesto_ext, p.nota, m.supabase_pedido_id 
            FROM public.presupuestos p
            INNER JOIN public.b2b_pedidos_mapeo m ON m.local_presupuesto_id = p.id
            WHERE p.activo = true
        `);

        console.log(`Total pedidos mapeados activos a actualizar en Supabase: ${resPres.rows.length}\n`);

        let count = 0;
        for (const row of resPres.rows) {
            const baseNota = row.nota ? String(row.nota).trim() : '';
            const metaTag = `[REF:${row.id_presupuesto_ext || ''}][LOCAL:${row.id}]`;
            const finalObs = baseNota ? `${baseNota} ${metaTag}` : metaTag;

            const patchUrl = `${url}/rest/v1/clientes_b2b_pedidos_cabecera?id=eq.${row.supabase_pedido_id}`;
            const resPatch = await fetch(patchUrl, {
                method: 'PATCH',
                headers: {
                    'apikey': key,
                    'Authorization': `Bearer ${key}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({ observaciones: finalObs })
            });

            if (resPatch.ok || resPatch.status === 204) {
                count++;
            }
        }

        console.log(`✅ Actualizados exitosamente ${count} de ${resPres.rows.length} pedidos en Supabase.`);
        process.exit(0);
    } catch (e) {
        console.error(e);
        process.exit(1);
    }
}

syncAllActiveBudgetsMetadata();
