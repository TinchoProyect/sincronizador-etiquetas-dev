require('dotenv').config({ path: './.env' });
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(process.env.SUPABASE_B2B_URL, process.env.SUPABASE_B2B_SERVICE_KEY);

async function main() {
  console.log('🛠️ Verificando/Creando tabla b2b_telemetria_eventos en Supabase B2B...');

  // 1. Probar insert directo
  const insertRes = await supabase
    .from('b2b_telemetria_eventos')
    .insert([
      {
        cliente_email: 'miserrano75@gmail.com',
        cliente_nombre: 'Martín Serrano (CB-0038)',
        dispositivo: 'Samsung S22 Ultra - Chrome Mobile 128',
        tipo_acceso: 'Apertura Portal B2B'
      }
    ])
    .select();

  if (insertRes.error) {
    console.log('⚠️ Error al insertar en b2b_telemetria_eventos:', insertRes.error.message);
  } else {
    console.log('✅ INSERT REAL EXITOSO EN SUPABASE B2B:\n', JSON.stringify(insertRes.data, null, 2));
  }
}

main().catch(console.error);
