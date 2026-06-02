const fetch = (...args) => import('node-fetch').then(({default: fetch}) => fetch(...args));
require('dotenv').config();

async function main() {
  const key = (process.env.SUPABASE_SERVICE_KEY || 'MISSING_ENV_KEY').trim();
  const headers = { 'apikey': key, 'Authorization': `Bearer ${key}` };

  const codes = ['41785456', '64448891', '45241'];
  for (const sku of codes) {
    const url = `https://wofttcnpipozwupmpuul.supabase.co/rest/v1/tabla_maestra_operativa?select=id,proveedor_id,nombre_proveedor,timestamp_extraccion,datos_maestros&datos_maestros->>_estado_delta=neq.BAJA&or=(datos_maestros->>codigo.eq.${sku},datos_maestros->>sku.eq.${sku},datos_maestros->>c\u00f3digo.eq.${sku})`;
    const response = await fetch(url, { headers });
    const data = await response.json();
    console.log(`SKU: ${sku} -> Found ${data.length} cotizaciones.`);
    if (data.length > 0) {
      console.log(JSON.stringify(data[0], null, 2));
    }
  }
}

main();
