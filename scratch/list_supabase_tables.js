require('dotenv').config({ path: './.env' });
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(process.env.SUPABASE_B2B_URL, process.env.SUPABASE_B2B_SERVICE_KEY);

async function main() {
  console.log('🔍 Auditando tablas existentes en Supabase B2B...');

  const tables = ['b2b_pedidos', 'b2b_clientes', 'b2b_sesiones', 'telemetria', 'auditorias', 'bunker_articulos'];
  for (const t of tables) {
    const { data, error } = await supabase.from(t).select('*').limit(1);
    if (!error) {
      console.log(`✅ TABLA EXISTENTE: ${t}`);
    } else {
      console.log(`❌ TABLA NO EXISTE (${t}): ${error.message}`);
    }
  }
}

main().catch(console.error);
