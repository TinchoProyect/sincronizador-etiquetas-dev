require('dotenv').config({ path: './.env' });
const { createClient } = require('@supabase/supabase-js');

// Usar Service Key de administración de Supabase para ajustar o permitir RLS de recepción por QR
const supabaseAdmin = createClient(process.env.SUPABASE_B2B_URL, process.env.SUPABASE_B2B_SERVICE_KEY);
const supabaseAnon = createClient(process.env.SUPABASE_B2B_URL, process.env.SUPABASE_B2B_ANON_KEY || process.env.SUPABASE_ANON_KEY);

async function main() {
  console.log('🛠️ Probando/Ajustando políticas RLS para asentamiento público de recepción por QR...');

  // 1. Verificar si UPDATE como anónimo funciona ahora en clientes_b2b_pedidos_cabecera
  const { data: selectData } = await supabaseAdmin
    .from('clientes_b2b_pedidos_cabecera')
    .select('id, cliente_id, estado, recibido_por_nombre')
    .limit(1);

  if (!selectData || selectData.length === 0) {
    console.log('⚠️ No hay pedidos en clientes_b2b_pedidos_cabecera para probar.');
    return;
  }

  const testId = selectData[0].id;
  console.log(`📋 Probando update anónimo para pedido ID: ${testId}...`);

  const { data: updateRes, error: updateErr } = await supabaseAnon
    .from('clientes_b2b_pedidos_cabecera')
    .update({
      recibido_por_nombre: selectData[0].recibido_por_nombre || 'Prueba Anonimo'
    })
    .eq('id', testId)
    .select();

  if (updateErr) {
    console.error('❌ RLS BLOQUEA UPDATE ANÓNIMO POR QR:', updateErr.message);
  } else {
    console.log('✅ UPDATE ANÓNIMO POR QR PERMITIDO:', updateRes);
  }
}

main().catch(console.error);
