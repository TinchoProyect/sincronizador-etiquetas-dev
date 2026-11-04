require('dotenv').config();

async function auditLiveB2bBrowserFlow() {
    console.log('================================================================================');
    console.log('🔬 AUDITORÍA EN VIVO: FLUJO DEL NAVEGADOR AL SCANEAR QR');
    console.log('================================================================================\n');

    try {
        const portalUrl = 'https://proud-darkness-ac3d.miserrano75.workers.dev';
        const uuid = 'c49428ab-c828-4fdc-bf9d-02d86d4ff971'; // Order #8234633

        // 1. Descargar HTML de entrada
        const resHtml = await fetch(`${portalUrl}/#/recepcion/${uuid}`);
        const html = await resHtml.text();

        console.log(`1. HTML descargado: Status ${resHtml.status}`);
        
        // 2. Extraer todos los bundles JS que el navegador descarga
        const scriptPaths = [...html.matchAll(/src=["'](.*?\.(?:js|jsx))["']/g)].map(m => m[1]);
        console.log(`2. Bundles JS referenciados en index.html:`, scriptPaths);

        for (const scriptPath of scriptPaths) {
            const scriptUrl = scriptPath.startsWith('http') ? scriptPath : `${portalUrl}/${scriptPath.replace(/^\//, '')}`;
            console.log(`\n3. Analizando bundle JS desplegado: ${scriptUrl}`);
            const resJs = await fetch(scriptUrl);
            const jsText = await resJs.text();

            console.log(`   - Tamaño de JS: ${jsText.length} bytes`);

            // Buscar la consulta Supabase que realiza el código desplegado en Cloudflare
            const hasSingle = jsText.includes('.single()');
            const matchQuery = jsText.match(/from\(["']clientes_b2b_pedidos_cabecera["']\)\.select\([^)]*\)(?:\.[a-zA-Z0-9_]+\([^)]*\))*/g);

            console.log(`   - ¿Utiliza .single()? ${hasSingle}`);
            console.log(`   - Consultas a cabecera encontradas en el bundle:`, matchQuery || 'Ninguna');
        }

        // 4. Probar las dos consultas directamente en Supabase con la ANON KEY que usa el bundle en vivo
        const SUPABASE_B2B_URL = process.env.SUPABASE_B2B_URL;
        const SUPABASE_B2B_ANON_KEY = process.env.SUPABASE_B2B_ANON_KEY;

        console.log(`\n4. Ejecutando consulta Supabase directa con ANON KEY (id = ${uuid}):`);
        const resSupaSingle = await fetch(`${SUPABASE_B2B_URL}/rest/v1/clientes_b2b_pedidos_cabecera?id=eq.${uuid}&select=*`, {
            headers: {
                'apikey': SUPABASE_B2B_ANON_KEY,
                'Authorization': `Bearer ${SUPABASE_B2B_ANON_KEY}`,
                'Accept': 'application/vnd.pgrst.object+json' // Lo que envía .single() en Supabase client!
            }
        });

        console.log(`   - Status con Accept .single(): ${resSupaSingle.status}`);
        const textSingle = await resSupaSingle.text();
        console.log(`   - Respuesta con Accept .single():`, textSingle.substring(0, 300));

        const resSupaArray = await fetch(`${SUPABASE_B2B_URL}/rest/v1/clientes_b2b_pedidos_cabecera?id=eq.${uuid}&select=*`, {
            headers: {
                'apikey': SUPABASE_B2B_ANON_KEY,
                'Authorization': `Bearer ${SUPABASE_B2B_ANON_KEY}`
            }
        });

        console.log(`\n5. Status con consulta normal (Arreglo): ${resSupaArray.status}`);
        const textArray = await resSupaArray.text();
        console.log(`   - Respuesta normal:`, textArray.substring(0, 300));

        process.exit(0);
    } catch (e) {
        console.error(e);
        process.exit(1);
    }
}

auditLiveB2bBrowserFlow();
