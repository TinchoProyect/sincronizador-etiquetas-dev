require('dotenv').config();

async function auditSupabaseRlsPublicAccess() {
    console.log('================================================================================');
    console.log('🔬 AUDITORÍA DE POLÍTICAS RLS EN SUPABASE PARA ACCESO PÚBLICO (ANON KEY)');
    console.log('================================================================================\n');

    try {
        const url = process.env.SUPABASE_B2B_URL;
        const anonKey = process.env.SUPABASE_B2B_ANON_KEY;
        const serviceKey = process.env.SUPABASE_B2B_SERVICE_KEY;

        const targetUuid = '40d72faa-d0bb-48df-9c31-037202737759'; // UUID de la foto del usuario

        console.log(`1. Consulta con SERVICE KEY (Bypassea RLS):`);
        const resAdmin = await fetch(`${url}/rest/v1/clientes_b2b_pedidos_cabecera?id=eq.${targetUuid}`, {
            headers: {
                'apikey': serviceKey,
                'Authorization': `Bearer ${serviceKey}`
            }
        });
        const dataAdmin = await resAdmin.json();
        console.log(`   - Status: ${resAdmin.status} | Filas devueltas: ${dataAdmin.length}`);

        console.log(`\n2. Consulta con ANON KEY (Lo que usa el navegador del celular):`);
        const resAnon = await fetch(`${url}/rest/v1/clientes_b2b_pedidos_cabecera?id=eq.${targetUuid}`, {
            headers: {
                'apikey': anonKey,
                'Authorization': `Bearer ${anonKey}`
            }
        });
        const dataAnon = await resAnon.json();
        console.log(`   - Status: ${resAnon.status} | Filas devueltas: ${dataAnon.length}`);

        console.log(`\n3. Consulta de ITEMS con ANON KEY:`);
        const resItemsAnon = await fetch(`${url}/rest/v1/clientes_b2b_pedidos_items?pedido_id=eq.${targetUuid}`, {
            headers: {
                'apikey': anonKey,
                'Authorization': `Bearer ${anonKey}`
            }
        });
        const dataItemsAnon = await resItemsAnon.json();
        console.log(`   - Status: ${resItemsAnon.status} | Filas devueltas: ${dataItemsAnon.length}`);

        process.exit(0);
    } catch (e) {
        console.error(e);
        process.exit(1);
    }
}

auditSupabaseRlsPublicAccess();
