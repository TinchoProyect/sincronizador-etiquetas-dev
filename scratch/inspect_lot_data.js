const { Client } = require('pg');
require('dotenv').config();

async function main() {
  const key = process.env.SUPABASE_SERVICE_KEY;
  const headers = { 'apikey': key, 'Authorization': `Bearer ${key}` };

  const idCorto = 'CB60CCA3';
  const minUuid = idCorto.toLowerCase() + '-0000-0000-0000-000000000000';
  const maxUuid = idCorto.toLowerCase() + '-ffff-ffff-ffff-ffffffffffff';

  console.log('Querying Supabase for lote CB60CCA3...');
  const url = `https://wofttcnpipozwupmpuul.supabase.co/rest/v1/recepciones_fisicas_items?select=id,cantidad_recibida,cantidad_esperada,recepciones_fisicas_cabecera(id,fecha_recepcion,numero_remito,pedido_id,estado,pedidos_b2b_cabecera(id,proveedor_id,proveedores(id,nombre))),pedidos_b2b_items(id,producto_codigo,producto_descripcion,unidad_ref,valor_unitario_ref)&id=gte.${minUuid}&id=lte.${maxUuid}`;
  
  const res = await fetch(url, { headers });
  if (res.ok) {
    const data = await res.json();
    console.log('SUPABASE LOTE DATA:');
    console.log(JSON.stringify(data, null, 2));

    if (data.length > 0) {
      const item = data[0].pedidos_b2b_items;
      const sku = item.producto_codigo;
      const provId = data[0].recepciones_fisicas_cabecera?.pedidos_b2b_cabecera?.proveedor_id;
      console.log(`SKU: ${sku}, Proveedor ID: ${provId}`);

      // Query master table
      const masterUrl = `https://wofttcnpipozwupmpuul.supabase.co/rest/v1/tabla_maestra_operativa?select=*&proveedor_id=eq.${provId}`;
      const masterRes = await fetch(masterUrl, { headers });
      if (masterRes.ok) {
        const masterRows = await masterRes.json();
        console.log(`Found ${masterRows.length} master rows for provider ${provId}`);
        const matchingRow = masterRows.find(r => r.datos_maestros?.codigo === sku || String(r.datos_maestros?.codigo).trim().toLowerCase() === sku.trim().toLowerCase());
        console.log('MATCHING MASTER ROW:');
        console.log(JSON.stringify(matchingRow, null, 2));
      } else {
        console.error('Failed to query master table:', await masterRes.text());
      }
    }
  } else {
    console.error('Failed to query lote CB60CCA3:', await res.text());
  }
}

main();
