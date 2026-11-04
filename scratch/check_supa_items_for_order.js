const { createClient } = require('@supabase/supabase-js');

const supaUrl = 'https://zysyxtbcvgswancxtpib.supabase.co';
const supaAnonKey = 'sb_publishable_auFX1kW7JonsV5TvUYnsnQ_LekKj2si';
const supabase = createClient(supaUrl, supaAnonKey);

async function checkItems() {
  const orderId = '00aa3e9c-2b8a-45a0-a4c0-07b4d8e3a14f';
  console.log('🔍 Consultando ítems en Supabase para el pedido:', orderId);

  const { data: cabecera } = await supabase
    .from('clientes_b2b_pedidos_cabecera')
    .select('*')
    .eq('id', orderId);
  console.log('📦 Cabecera en Supabase:', cabecera);

  const { data: items, error } = await supabase
    .from('clientes_b2b_pedidos_items')
    .select('*')
    .eq('pedido_id', orderId);
  console.log('📦 Ítems en Supabase (error):', error);
  console.log('📦 Ítems en Supabase (data):', items);
}

checkItems();
