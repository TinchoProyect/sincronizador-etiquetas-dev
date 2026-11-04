const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

const SUPABASE_URL = process.env.SUPABASE_B2B_URL;
const SUPABASE_KEY = process.env.SUPABASE_B2B_SERVICE_KEY;
const ANON_KEY = process.env.SUPABASE_B2B_ANON_KEY;

const supabase = createClient(SUPABASE_URL, ANON_KEY);
const supabaseAdmin = createClient(SUPABASE_URL, SUPABASE_KEY);

async function run() {
  const testEmail = `test_trigger_${Math.floor(Math.random() * 100000)}@example.com`;
  let token = 'test-token-' + Math.random().toString(36).substring(7);

  try {
    console.log('1. Creating test invitation on Supabase Cloud...');
    await supabaseAdmin.from('clientes_b2b_invitaciones').insert({
      token: token,
      cliente_id: 'CB-0002',
      expires_at: new Date(Date.now() + 10 * 60 * 1000).toISOString(),
      usado: false,
      razon_social: 'Tus Frutos Secos'
    });

    console.log('2. Attempting signUp with email:', testEmail);
    const { data, error } = await supabase.auth.signUp({
      email: testEmail,
      password: 'TestPassword123!',
      options: {
        data: {
          cliente_id: 'CB-0002',
          nombre_completo: 'Nicolás Test',
          nombre_empresa: 'Tus Frutos Secos',
          invitation_token: token
        }
      }
    });

    console.log('--- SIGNUP RESULT ---');
    console.log('data:', data);
    console.log('error:', error);
    
    if (error) {
      console.log('error.message:', error.message);
      console.log('typeof error.message:', typeof error.message);
      console.log('JSON.stringify(error):', JSON.stringify(error));
    }
  } catch (err) {
    console.error('Exception caught:', err);
  } finally {
    // Cleanup
    await supabaseAdmin.auth.admin.listUsers().then(async ({ data: { users } }) => {
      const u = users.find(x => x.email === testEmail);
      if (u) await supabaseAdmin.auth.admin.deleteUser(u.id);
    });
    await supabaseAdmin.from('clientes_b2b_invitaciones').delete().eq('token', token);
  }
  process.exit(0);
}

run();
