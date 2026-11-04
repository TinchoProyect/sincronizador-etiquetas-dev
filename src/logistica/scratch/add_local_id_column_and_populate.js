const { pool } = require('../config/database');

async function addLocalIdColumnAndPopulate() {
    console.log('================================================================================');
    console.log('🚀 AÑADIENDO Y POBLANDO local_presupuesto_id EN SUPABASE CLIENTES_B2B_PEDIDOS_CABECERA');
    console.log('================================================================================\n');

    try {
        const url = process.env.SUPABASE_B2B_URL;
        const key = process.env.SUPABASE_B2B_SERVICE_KEY;

        // 1. Obtener todos los mapeos locales existentes
        const resMap = await pool.query(`
            SELECT local_presupuesto_id, supabase_pedido_id 
            FROM public.b2b_pedidos_mapeo 
            ORDER BY created_at DESC
        `);

        console.log(`1. Total mapeos locales a actualizar en Supabase: ${resMap.rows.length}`);

        let updatedCount = 0;

        for (const row of resMap.rows) {
            const patchUrl = `${url}/rest/v1/clientes_b2b_pedidos_cabecera?id=eq.${row.supabase_pedido_id}`;
            const resPatch = await fetch(patchUrl, {
                method: 'PATCH',
                headers: {
                    'apikey': key,
                    'Authorization': `Bearer ${key}`,
                    'Content-Type': 'application/json',
                    'Prefer': 'return=minimal'
                },
                body: JSON.stringify({
                    local_presupuesto_id: String(row.local_presupuesto_id)
                })
            });

            if (resPatch.ok || resPatch.status === 204) {
                updatedCount++;
            } else {
                console.warn(`⚠️ Error al actualizar pedido Supabase ${row.supabase_pedido_id}: Status ${resPatch.status}`);
            }
        }

        console.log(`\n✅ Actualizados exitosamente ${updatedCount} de ${resMap.rows.length} pedidos en Supabase con local_presupuesto_id.`);

        // 2. Probar lectura pública (ANON) consultando por local_presupuesto_id = '8234633'
        const anonKey = process.env.SUPABASE_B2B_ANON_KEY;
        const testFetchUrl = `${url}/rest/v1/clientes_b2b_pedidos_cabecera?local_presupuesto_id=eq.8234633&select=*`;
        const resAnonTest = await fetch(testFetchUrl, {
            headers: {
                'apikey': anonKey,
                'Authorization': `Bearer ${anonKey}`
            }
        });

        console.log(`\n3. Prueba de lectura pública por ID Local ('8234633') (ANON KEY): Status ${resAnonTest.status}`);
        const testData = await resAnonTest.json();
        console.log('   - Resultado:', testData);

        process.exit(0);
    } catch (e) {
        console.error(e);
        process.exit(1);
    }
}

addLocalIdColumnAndPopulate();
