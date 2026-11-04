const { Client } = require('pg');
const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

const SUPABASE_URL = process.env.SUPABASE_B2B_URL;
const SUPABASE_KEY = process.env.SUPABASE_B2B_SERVICE_KEY;

if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error('Error: Supabase environment variables missing in .env');
  process.exit(1);
}

const supabaseAdmin = createClient(SUPABASE_URL, SUPABASE_KEY);

async function run() {
  const localClient = new Client({
    user: process.env.DB_USER || 'postgres',
    host: process.env.DB_HOST || 'localhost',
    database: process.env.DB_NAME || 'etiquetas',
    password: process.env.DB_PASSWORD || 'ta3Mionga',
    port: parseInt(process.env.DB_PORT || '5432'),
  });

  try {
    await localClient.connect();
    
    // 1. Get current local email for CB-0006
    const originalRes = await localClient.query(
      "SELECT email_portal FROM public.bunker_clientes WHERE codigo_bunker_cliente = 'CB-0006'"
    );
    if (originalRes.rows.length === 0) {
      throw new Error('Test client CB-0006 not found locally!');
    }
    
    const originalEmail = originalRes.rows[0].email_portal;
    console.log(`Original local email for CB-0006: '${originalEmail}'`);

    // 2. Find cloud profile for CB-0006
    const { data: profile, error: profileErr } = await supabaseAdmin
      .from('clientes_b2b_perfiles')
      .select('id')
      .eq('cliente_id', 'CB-0006')
      .maybeSingle();

    if (profileErr) throw profileErr;
    if (!profile) {
      throw new Error('Cloud profile for CB-0006 not found on Supabase!');
    }

    console.log(`Cloud profile found for CB-0006 (UUID: ${profile.id}). Updating its email to 'temp_reverse_sync_test@example.com'...`);
    const { error: updateErr } = await supabaseAdmin
      .from('clientes_b2b_perfiles')
      .update({ email: 'temp_reverse_sync_test@example.com' })
      .eq('id', profile.id);
    if (updateErr) throw updateErr;

    // 3. Run the sync script
    console.log('\n🚀 Executing syncB2BClientesListas.js...');
    const { execSync } = require('child_process');
    const syncOutput = execSync('node src/actualizaPrecios/syncB2BClientesListas.js', {
      env: { ...process.env, NODE_ENV: 'production' }
    });
    console.log(syncOutput.toString());

    // 4. Verify local DB was updated
    const afterRes = await localClient.query(
      "SELECT email_portal FROM public.bunker_clientes WHERE codigo_bunker_cliente = 'CB-0006'"
    );
    const newLocalEmail = afterRes.rows[0].email_portal;
    console.log(`\nLocal email after sync runs: '${newLocalEmail}'`);
    
    if (newLocalEmail === 'temp_reverse_sync_test@example.com') {
      console.log('🎉 REVERSE SYNCHRONIZATION SUCCESSFUL! Local DB email_portal was updated from Supabase Cloud!');
    } else {
      throw new Error('Reverse synchronization failed: Local DB was not updated.');
    }

    // 5. Restore original local and cloud emails
    console.log('\n🧹 Restoring original state...');
    await localClient.query(
      "UPDATE public.bunker_clientes SET email_portal = $1 WHERE codigo_bunker_cliente = 'CB-0006'",
      [originalEmail]
    );
    
    const { error: restoreErr } = await supabaseAdmin
      .from('clientes_b2b_perfiles')
      .update({ email: originalEmail })
      .eq('id', profile.id);
    if (restoreErr) throw restoreErr;
    
    console.log('   ✅ Restoration complete.');

  } catch (err) {
    console.error('❌ Test failed:', err.message);
  } finally {
    await localClient.end();
  }
}

run();
