require('dotenv').config({ path: './.env' });
const { createClient } = require('@supabase/supabase-js');

// Probar consulta como ANONIMO (sin token JWT de usuario)
const supabaseAnon = createClient(process.env.SUPABASE_B2B_URL, process.env.SUPABASE_B2B_ANON_KEY || process.env.SUPABASE_ANON_KEY);

async function main() {
  console.log('🔍 Probando lectura anónima pública de clientes_b2b_pedidos_cabecera...');

  const { data, error } = await supabaseAnon
    .from('clientes_b2b_pedidos_cabecera')
    .select('id, cliente_id, estado, observaciones')
    .limit(1);

  if (error) {
    console.error('❌ FALLÓ LECTURA ANÓNIMA DE QR (RLS BLOQUEANTE):', error.message);
  } else {
    console.log('✅ Lectura pública exitosa:', data);
  }
}

main().catch(console.error);
