const { createClient } = require('@supabase/supabase-js');

const supaUrl = 'https://zysyxtbcvgswancxtpib.supabase.co';
const supaAnonKey = 'sb_publishable_auFX1kW7JonsV5TvUYnsnQ_LekKj2si';
const supabase = createClient(supaUrl, supaAnonKey);

async function checkTelemetriaRows() {
  const { data } = await supabase
    .from('telemetria_accesos')
    .select('*')
    .order('created_at', { ascending: false });

  console.log('📦 SUPABASE TELEMETRIA ROWS:');
  data.forEach(r => {
    console.log('ID:', r.id, '| created_at:', JSON.stringify(r.created_at), '| cliente:', r.cliente_nombre, '| tipo:', r.tipo_acceso);
  });
}

checkTelemetriaRows();
