require('dotenv').config({ path: './.env' });
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(process.env.SUPABASE_B2B_URL, process.env.SUPABASE_B2B_SERVICE_KEY);

async function main() {
  console.log('🛠️ Creando/Verificando tabla telemetria_accesos en Supabase B2B...');

  // Intentar consultar o insertar directamente
  const { data: testData, error: selectErr } = await supabase
    .from('telemetria_accesos')
    .select('*')
    .limit(1);

  if (selectErr && selectErr.code === '42P01') {
    console.log('❌ La tabla no existe en Supabase. Intentando crear mediante consulta...');
  } else if (!selectErr) {
    console.log('✅ La tabla telemetria_accesos ya existe en Supabase!');
  } else {
    console.log('Error Supabase:', selectErr.message);
  }
}

main().catch(console.error);
