const { createClient } = require('@supabase/supabase-js');

const supabaseUrl = 'https://zysyxtbcvgswancxtpib.supabase.co';
const supabaseAnonKey = 'sb_publishable_auFX1kW7JonsV5TvUYnsnQ_LekKj2si';

const supa = createClient(supabaseUrl, supabaseAnonKey);

async function checkSupa() {
  console.log('🔍 Listing available tables in Supabase...');

  const { data: p, error: e1 } = await supa.from('clientes_b2b_pedidos_cabecera').select('id, created_at, estado, recibido_por_nombre, recibido_fecha').limit(5);
  console.log('1. clientes_b2b_pedidos_cabecera:', e1 ? e1.message : p);

  const { data: a, error: e2 } = await supa.from('bunker_articulos').select('id, codigo_articulo, descripcion').limit(3);
  console.log('2. bunker_articulos:', e2 ? e2.message : a);
}

checkSupa();
