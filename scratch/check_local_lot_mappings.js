const { Client } = require('pg');
const fetch = (...args) => import('node-fetch').then(({default: fetch}) => fetch(...args));
require('dotenv').config();

const client = new Client({
  user: 'postgres',
  host: 'localhost',
  database: 'etiquetas',
  password: 'ta3Mionga',
  port: 5432,
});

async function main() {
  await client.connect();
  const key = (process.env.SUPABASE_SERVICE_KEY || '').trim();
  const headers = { 'apikey': key, 'Authorization': `Bearer ${key}` };

  try {
    const res = await client.query(`
      SELECT DISTINCT v.lote_id_supabase, d.destino_id, d.tipo_destino
      FROM public.bunker_lotes_destinos d
      JOIN public.bunker_lotes_vinculos v ON d.vinculo_id = v.id
      LIMIT 10;
    `);
    
    console.log('Local lot mappings:');
    for (const row of res.rows) {
      console.log(`Lote Supabase ID: ${row.lote_id_supabase} | Destino ID: ${row.destino_id} | Tipo: ${row.tipo_destino}`);
      if (row.lote_id_supabase) {
        const idCorto = row.lote_id_supabase.substring(0, 8);
        const url = `https://wofttcnpipozwupmpuul.supabase.co/rest/v1/recepciones_fisicas_items?select=id,pedidos_b2b_items(producto_codigo,producto_descripcion)&id=eq.${row.lote_id_supabase}`;
        const sRes = await fetch(url, { headers });
        if (sRes.ok) {
          const sData = await sRes.json();
          if (sData.length > 0) {
            console.log(`  -> Supabase SKU: ${sData[0].pedidos_b2b_items?.producto_codigo} | Desc: ${sData[0].pedidos_b2b_items?.producto_descripcion}`);
          } else {
            console.log('  -> Not found in Supabase.');
          }
        }
      }
    }
  } catch (err) {
    console.error(err);
  } finally {
    await client.end();
  }
}

main();
