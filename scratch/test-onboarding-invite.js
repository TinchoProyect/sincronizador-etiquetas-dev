require('dotenv').config();

const SUPABASE_URL = process.env.SUPABASE_B2B_URL;
const SUPABASE_KEY = process.env.SUPABASE_B2B_SERVICE_KEY;

if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error('Error: SUPABASE_B2B_URL or SUPABASE_B2B_SERVICE_KEY is missing in .env');
  process.exit(1);
}

async function run() {
  const token = 'test_' + require('crypto').randomBytes(16).toString('hex');
  const expiresAt = new Date(Date.now() + 72 * 60 * 60 * 1000); // 72 hours
  
  console.log('📡 Simulating Supabase invitation insert...');
  console.log('URL:', SUPABASE_URL);
  console.log('Token:', token);
  
  try {
    const supabaseUrlInvitacion = `${SUPABASE_URL}/rest/v1/clientes_b2b_invitaciones`;
    const responseSupaInvite = await fetch(supabaseUrlInvitacion, {
        method: 'POST',
        headers: {
            'apikey': SUPABASE_KEY,
            'Authorization': `Bearer ${SUPABASE_KEY}`,
            'Content-Type': 'application/json',
            'Prefer': 'return=minimal'
        },
        body: JSON.stringify({
            token: token,
            cliente_id: 'CB-TEST',
            expires_at: expiresAt.toISOString(),
            usado: false,
            razon_social: 'Cliente Test',
            email_portal: 'test@example.com',
            email_portal_nombre: 'Contacto Test',
            email_portal_cargo: 'Encargado'
        })
    });

    if (!responseSupaInvite.ok) {
        const errText = await responseSupaInvite.text();
        console.error('❌ Supabase insert failed:', responseSupaInvite.status, errText);
    } else {
        console.log('✅ Supabase insert SUCCESS!');
    }
  } catch (err) {
    console.error('❌ Network error:', err.message);
  }
}

run();
