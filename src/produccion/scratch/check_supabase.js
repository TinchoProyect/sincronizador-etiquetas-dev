require('dotenv').config({path: '.env'});
async function run() {
    const key = process.env.SUPABASE_SERVICE_KEY;
    if(!key) { console.log('No key'); return; }
    
    // Check tables
    const r1 = await fetch('https://wofttcnpipozwupmpuul.supabase.co/rest/v1/pedidos_b2b_items?limit=1', { headers: { 'apikey': key, 'Authorization': 'Bearer ' + key } });
    const d1 = await r1.json();
    console.log('pedidos_b2b_items:', Object.keys(d1[0] || {}));

    const r2 = await fetch('https://wofttcnpipozwupmpuul.supabase.co/rest/v1/tabla_maestra_operativa?limit=1', { headers: { 'apikey': key, 'Authorization': 'Bearer ' + key } });
    const d2 = await r2.json();
    console.log('tabla_maestra_operativa:', Object.keys(d2[0] || {}));
    
    const r3 = await fetch('https://wofttcnpipozwupmpuul.supabase.co/rest/v1/recepciones_fisicas_items?limit=1', { headers: { 'apikey': key, 'Authorization': 'Bearer ' + key } });
    const d3 = await r3.json();
    console.log('recepciones_fisicas_items:', Object.keys(d3[0] || {}));
}
run();
