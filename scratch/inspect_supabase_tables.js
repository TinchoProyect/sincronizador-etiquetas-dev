const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

const supaUrl = process.env.SUPABASE_B2B_URL || 'https://zysyxtbcvgswancxtpib.supabase.co';
const supaServiceKey = process.env.SUPABASE_B2B_SERVICE_KEY;
const supabaseAdmin = createClient(supaUrl, supaServiceKey);

async function inspectTables() {
  console.log('=== TABLAS Y VISTAS EN SUPABASE CLOUD ===');
  
  // Try querying known tables
  const tables = [
    'clientes_b2b_perfiles',
    'clientes_b2b_directorio',
    'clientes_b2b_pedidos_cabecera',
    'telemetria_accesos',
    'bunker_articulos',
    'bunker_clientes'
  ];

  for (const t of tables) {
    try {
      const { data: d, error: e } = await supabaseAdmin.from(t).select('*').limit(1);
      if (!e) {
        console.log(`✅ Tabla ${t} EXISTE. Filas:`, d ? d.length : 0);
      } else {
        console.log(`❌ Tabla ${t} NO existe o error:`, e.message);
      }
    } catch(err) {
      console.log(`❌ Tabla ${t} catch:`, err.message);
    }
  }

  process.exit(0);
}

inspectTables();
