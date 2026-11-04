const { createClient } = require('@supabase/supabase-js');

const supaUrl = 'https://zysyxtbcvgswancxtpib.supabase.co';
const supaAnonKey = 'sb_publishable_auFX1kW7JonsV5TvUYnsnQ_LekKj2si';
const supabase = createClient(supaUrl, supaAnonKey);

async function checkPerfiles() {
  const { data: perfiles, error } = await supabase
    .from('clientes_b2b_perfiles')
    .select('*')
    .limit(20);

  console.log('📋 PERFILES EN SUPABASE (error):', error);
  console.log('📋 PERFILES EN SUPABASE (data):', JSON.stringify(perfiles, null, 2));

  const { data: users, error: errAuth } = await supabase
    .from('clientes_b2b_pedidos_cabecera')
    .select('cliente_id')
    .limit(10);
  console.log('📋 CLIENTE_ID EN CABECERA:', users);
  process.exit(0);
}

checkPerfiles();
