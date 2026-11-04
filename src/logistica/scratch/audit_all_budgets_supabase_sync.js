const { pool } = require('../config/database');

async function auditAllBudgetsSupabaseSync() {
    console.log('================================================================================');
    console.log('🔍 AUDITORÍA GENERAL DE SINCRONIZACIÓN DE TODOS LOS PRESUPUESTOS A SUPABASE');
    console.log('================================================================================\n');

    try {
        const url = process.env.SUPABASE_B2B_URL;
        const anonKey = process.env.SUPABASE_B2B_ANON_KEY;

        // 1. Consultar todos los presupuestos activos locales
        const resPres = await pool.query(`
            SELECT p.id, p.id_cliente, p.id_presupuesto_ext, p.fecha, m.supabase_pedido_id 
            FROM public.presupuestos p
            LEFT JOIN public.b2b_pedidos_mapeo m ON m.local_presupuesto_id = p.id
            WHERE p.activo = true 
            ORDER BY p.id DESC 
            LIMIT 25
        `);

        console.log(`Analizando los últimos 25 presupuestos activos locales:\n`);

        for (const row of resPres.rows) {
            const supaId = row.supabase_pedido_id;
            let supaExists = false;
            let supaData = null;

            if (supaId) {
                const resSupa = await fetch(`${url}/rest/v1/clientes_b2b_pedidos_cabecera?id=eq.${supaId}&select=id,cliente_id,estado,total,observaciones`, {
                    headers: {
                        'apikey': anonKey,
                        'Authorization': `Bearer ${anonKey}`
                    }
                });
                const d = await resSupa.json();
                if (Array.isArray(d) && d.length > 0) {
                    supaExists = true;
                    supaData = d[0];
                }
            }

            // También probar si en Supabase existe buscando por observaciones ilike %row.id% o %row.id_presupuesto_ext%
            let supaFoundByObs = false;
            if (!supaExists && row.id_presupuesto_ext) {
                const resObs = await fetch(`${url}/rest/v1/clientes_b2b_pedidos_cabecera?observaciones=ilike.*${encodeURIComponent(row.id_presupuesto_ext)}*&select=id,cliente_id,total,observaciones`, {
                    headers: {
                        'apikey': anonKey,
                        'Authorization': `Bearer ${anonKey}`
                    }
                });
                const dObs = await resObs.json();
                if (Array.isArray(dObs) && dObs.length > 0) {
                    supaFoundByObs = true;
                    supaData = dObs[0];
                }
            }

            console.log(`Presupuesto Local #${row.id} | Cliente: ${row.id_cliente} | ExtToken: ${row.id_presupuesto_ext || 'NULL'}`);
            console.log(`   - UUID Mapeado: ${supaId || 'NINGUNO'}`);
            console.log(`   - ¿Existe en Supabase? ${supaExists ? '✅ SI' : supaFoundByObs ? '✅ SI (Encontrado por Observaciones)' : '❌ NO EN SUPABASE'}`);
            if (supaData) {
                console.log(`     Detalles Supabase: ID ${supaData.id} | Estado: ${supaData.estado} | Obs: "${supaData.observaciones}"`);
            }
            console.log('');
        }

        process.exit(0);
    } catch (e) {
        console.error(e);
        process.exit(1);
    }
}

auditAllBudgetsSupabaseSync();
