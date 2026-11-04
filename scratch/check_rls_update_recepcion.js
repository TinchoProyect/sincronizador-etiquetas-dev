require('dotenv').config({ path: './.env' });
const { createClient } = require('@supabase/supabase-js');

const supabaseAnon = createClient(process.env.SUPABASE_B2B_URL, process.env.SUPABASE_B2B_ANON_KEY || process.env.SUPABASE_ANON_KEY);

async function main() {
  console.log('🔍 Probando actualización anónima de asentamiento de recepción de pedido por QR...');

  // Intentar actualizar un pedido como usuario anónimo (escáner QR)
  const { data, error } = await supabaseAnon
    .from('clientes_b2b_pedidos_cabecera')
    .update({ recepcion_confirmada: false })
    .eq('id', '26a9c461-c1b7-4973-a43a-9d1fd870b277')
    .select();

  if (error) {
    console.error('❌ FALLÓ UPDATE ANÓNIMO (RLS BLOQUEA EL ASENTAMIENTO DE RECEPCIÓN):', error.message);
  } else {
    console.log('✅ Update anónimo permitido:', data);
  }
}

main().catch(console.error);
