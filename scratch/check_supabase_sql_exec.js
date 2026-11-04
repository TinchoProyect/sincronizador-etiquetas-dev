require('dotenv').config({ path: './.env' });
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(process.env.SUPABASE_B2B_URL, process.env.SUPABASE_B2B_SERVICE_KEY);

async function main() {
  console.log('🔍 Auditando funciones RPC disponibles en Supabase B2B...');

  // Probar RPCs comunes
  const funcs = ['exec_sql', 'execute_sql', 'query', 'run_sql'];
  for (const f of funcs) {
    const { data, error } = await supabase.rpc(f, { query: 'SELECT 1;' });
    if (!error) {
      console.log(`✅ RPC ENCONTRADO: ${f}`);
    } else {
      console.log(`❌ RPC NO DISPONIBLE (${f}): ${error.message}`);
    }
  }
}

main().catch(console.error);
