const { createClient } = require('@supabase/supabase-js');

const supaUrl = 'https://zysyxtbcvgswancxtpib.supabase.co';
const supaAnonKey = 'sb_publishable_auFX1kW7JonsV5TvUYnsnQ_LekKj2si';
const supabase = createClient(supaUrl, supaAnonKey);

async function findMartinSupa() {
  const { data, error } = await supabase
    .from('clientes_b2b_pedidos_cabecera')
    .select('id, recibido_por_nombre, recibido_por_apellido, recibido_fecha, created_at')
    .not('recibido_por_nombre', 'is', null);

  if (error) {
    console.error('Error:', error);
  } else {
    console.log('📦 SUPABASE RECIBIDOS ROWS:', JSON.stringify(data, null, 2));
  }
}

findMartinSupa();
