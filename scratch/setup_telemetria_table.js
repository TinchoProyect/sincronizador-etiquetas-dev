require('dotenv').config({ path: './.env' });
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(process.env.SUPABASE_B2B_URL, process.env.SUPABASE_B2B_SERVICE_KEY);

async function main() {
  console.log('🔍 Verificando/Creando tabla telemetria_accesos en Supabase...');

  // Probar insert de prueba
  const { data, error } = await supabase
    .from('telemetria_accesos')
    .insert([
      {
        cliente_nombre: 'Samsung S22 Ultra (Prueba)',
        dispositivo: 'Chrome Mobile (Android)',
        latencia_ms: 2,
        tipo_acceso: 'Apertura PWA Instantánea'
      }
    ])
    .select();

  if (error) {
    console.warn('⚠️ La tabla telemetria_accesos no existe o falló el insert:', error.message);
  } else {
    console.log('✅ INSERT EXITOSO EN TELEMETRIA ACCESOS:\n', JSON.stringify(data, null, 2));
  }
}

main().catch(console.error);
