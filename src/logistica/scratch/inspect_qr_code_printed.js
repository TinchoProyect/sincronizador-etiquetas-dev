const { pool } = require('../config/database');
const { generarPDFPresupuesto } = require('../../produccion/controllers/impresionPresupuestos');

async function inspectQrCodePrinted() {
    console.log('================================================================================');
    console.log('🔍 AUDITORÍA DE LA URL EXACTA CODIFICADA EN EL QR DE LOS PRESUPUESTOS');
    console.log('================================================================================\n');

    try {
        const ids = [8234633, 8234632, 8234631, 8234630, 8234627, 8234625, 8234624];

        for (const idLocal of ids) {
            const resMap = await pool.query(
                'SELECT supabase_pedido_id FROM public.b2b_pedidos_mapeo WHERE local_presupuesto_id = $1 LIMIT 1',
                [idLocal]
            );
            const supaId = resMap.rows[0]?.supabase_pedido_id;

            const resPres = await pool.query('SELECT id, id_presupuesto_ext FROM public.presupuestos WHERE id = $1', [idLocal]);
            const pres = resPres.rows[0];

            console.log(`Presupuesto Local #${idLocal}:`);
            console.log(`   - id_presupuesto_ext: ${pres?.id_presupuesto_ext || 'NULL'}`);
            console.log(`   - b2b_pedidos_mapeo UUID: ${supaId || 'NULL'}`);

            const portalUrl = process.env.B2B_PORTAL_URL || 'https://proud-darkness-ac3d.miserrano75.workers.dev';
            const effectiveUuid = supaId || pres?.id_presupuesto_ext;
            const fullQrUrl = `${portalUrl}/#/recepcion/${effectiveUuid}`;

            console.log(`   - 📲 URL grabada en QR: ${fullQrUrl}`);

            // Verificar si el UUID existe en Supabase y devuelve 200 con la ANON KEY
            const SUPABASE_B2B_URL = process.env.SUPABASE_B2B_URL;
            const SUPABASE_B2B_ANON_KEY = process.env.SUPABASE_B2B_ANON_KEY;

            const checkSupa = await fetch(`${SUPABASE_B2B_URL}/rest/v1/clientes_b2b_pedidos_cabecera?id=eq.${effectiveUuid}&select=id,cliente_id,estado,total`, {
                headers: {
                    'apikey': SUPABASE_B2B_ANON_KEY,
                    'Authorization': `Bearer ${SUPABASE_B2B_ANON_KEY}`
                }
            });

            const data = await checkSupa.json();
            const existsInSupa = Array.isArray(data) && data.length > 0;
            console.log(`   - ☁️ ¿Existe en Supabase? ${existsInSupa ? '✅ SI (' + JSON.stringify(data[0]) + ')' : '❌ NO'}\n`);
        }

        process.exit(0);
    } catch (e) {
        console.error(e);
        process.exit(1);
    }
}

inspectQrCodePrinted();
