const fetch = (...args) => import('node-fetch').then(({default: fetch}) => fetch(...args));
require('dotenv').config();

async function main() {
  const key = (process.env.SUPABASE_SERVICE_KEY || 'MISSING_ENV_KEY').trim();
  const headers = { 'apikey': key, 'Authorization': `Bearer ${key}` };

  try {
    const url = 'https://wofttcnpipozwupmpuul.supabase.co/rest/v1/tabla_maestra_operativa?select=nombre_proveedor,datos_maestros&limit=20';
    const res = await fetch(url, { headers });
    if (res.ok) {
      const rows = await res.json();
      console.log('Sample cotizaciones from tabla_maestra_operativa:');
      rows.forEach(r => {
        console.log(`Proveedor: ${r.nombre_proveedor} | Código: ${r.datos_maestros?.codigo} | Desc: ${r.datos_maestros?.descripcion} | Precio: ${r.datos_maestros?.precio}`);
      });
    } else {
      console.error('Error fetching master:', await res.text());
    }
  } catch (err) {
    console.error(err);
  }
}

main();
