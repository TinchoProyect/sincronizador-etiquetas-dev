const fs = require('fs');
const path = require('path');
const dotenv = require('dotenv');

// Cargar variables de entorno del proyecto
const envPath = path.resolve(__dirname, '../../../../.env');
if (fs.existsSync(envPath)) {
    dotenv.config({ path: envPath });
} else {
    dotenv.config();
}

async function main() {
    try {
        const key = (process.env.SUPABASE_SERVICE_KEY || '').trim();
        if (!key) {
            console.error('No se encontró SUPABASE_SERVICE_KEY en .env');
            return;
        }

        const headers = { 'apikey': key, 'Authorization': `Bearer ${key}` };

        // 1. Consultar el ítem de recepción física
        console.log('--- 1. CONSULTA RECEPCIONES FISICAS ITEMS ---');
        const itemUrl = `https://wofttcnpipozwupmpuul.supabase.co/rest/v1/recepciones_fisicas_items?select=*,pedidos_b2b_items(*)&id=eq.d4af4ba2-782d-4480-9072-f7b660f0fa54`;
        const itemRes = await fetch(itemUrl, { headers });
        if (itemRes.ok) {
            const data = await itemRes.json();
            console.log('Datos de recepción de item:', JSON.stringify(data, null, 2));
        } else {
            console.error('Error consultando item:', await itemRes.text());
        }

        // 2. Consultar el pedido de b2b_items para el código de barra del maní S1
        console.log('\n--- 2. CONSULTA PEDIDOS B2B ITEMS PARA SKU 0020010014 ---');
        const productUrl = `https://wofttcnpipozwupmpuul.supabase.co/rest/v1/pedidos_b2b_items?select=*&producto_codigo=eq.0020010014`;
        const prodRes = await fetch(productUrl, { headers });
        if (prodRes.ok) {
            const data = await prodRes.json();
            console.log('Items encontrados:', JSON.stringify(data, null, 2));
        } else {
            console.error('Error consultando productos:', await prodRes.text());
        }

        // 3. Consultar la tabla maestra operativa para el SKU 0020010014
        console.log('\n--- 3. CONSULTA TABLA MAESTRA OPERATIVA PARA SKU 0020010014 ---');
        const masterUrl = `https://wofttcnpipozwupmpuul.supabase.co/rest/v1/tabla_maestra_operativa?select=*&codigo=eq.0020010014`;
        const masterRes = await fetch(masterUrl, { headers });
        if (masterRes.ok) {
            const data = await masterRes.json();
            console.log('Datos en tabla maestra:', JSON.stringify(data, null, 2));
        } else {
            console.error('Error consultando tabla maestra:', await masterRes.text());
        }

    } catch (err) {
        console.error('Error general:', err.message);
    }
}

main().catch(console.error);
