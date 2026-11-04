const { createClient } = require('@supabase/supabase-js');

const supaUrl = 'https://zysyxtbcvgswancxtpib.supabase.co';
const supaAnonKey = 'sb_publishable_auFX1kW7JonsV5TvUYnsnQ_LekKj2si';
const supabase = createClient(supaUrl, supaAnonKey);

async function checkLatestTelemetria() {
  const { data, error } = await supabase
    .from('telemetria_accesos')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(10);

  if (error) {
    console.error('Error:', error);
    return;
  }

  console.log('📦 LATEST TELEMETRIA ROWS IN SUPABASE:');
  data.forEach(r => {
    console.log(` - ID: ${r.id} | created_at: ${r.created_at} | cliente_nombre: "${r.cliente_nombre}" | tipo_acceso: "${r.tipo_acceso}"`);
  });
  process.exit(0);
}

checkLatestTelemetria();
