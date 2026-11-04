const { spawn } = require('child_process');
const path = require('path');
const { createClient } = require(path.join(__dirname, '../b2b-portal/node_modules/@supabase/supabase-js'));
require('dotenv').config();

const SUPABASE_URL = process.env.SUPABASE_B2B_URL;
const SUPABASE_KEY = process.env.SUPABASE_B2B_SERVICE_KEY;
const ANON_KEY = process.env.SUPABASE_B2B_ANON_KEY;

if (!SUPABASE_URL || !SUPABASE_KEY || !ANON_KEY) {
  console.error('Error: Supabase environment variables missing in .env');
  process.exit(1);
}

// Client simulating the customer's cell phone (anonymous)
const supabase = createClient(SUPABASE_URL, ANON_KEY);

// Client simulating admin backend operations (bypassing RLS, managing users)
const supabaseAdmin = createClient(SUPABASE_URL, SUPABASE_KEY, {
  auth: {
    autoRefreshToken: false,
    persistSession: false
  }
});

function killPort3005() {
  return new Promise((resolve) => {
    console.log('🧹 Clearing port 3005...');
    const kp = spawn('npx', ['kill-port', '3005'], { shell: true });
    kp.on('exit', () => {
      setTimeout(resolve, 1000);
    });
  });
}

async function cleanupDb(email, token, userUuid) {
  console.log('🧹 Cleaning up test user and invitation from Supabase Cloud...');
  try {
    if (userUuid) {
      const { error: deleteUserErr } = await supabaseAdmin.auth.admin.deleteUser(userUuid);
      if (deleteUserErr) {
        console.error('⚠️ Could not delete auth user:', deleteUserErr.message);
      } else {
        console.log('   ✅ Deleted auth user:', email);
      }
    }
    
    if (token) {
      const { error: deleteInviteErr } = await supabaseAdmin
        .from('clientes_b2b_invitaciones')
        .delete()
        .eq('token', token);
      if (deleteInviteErr) {
        console.error('⚠️ Could not delete invitation token:', deleteInviteErr.message);
      } else {
        console.log('   ✅ Deleted invitation token:', token);
      }
    }
  } catch (err) {
    console.error('❌ Cleanup failed:', err.message);
  }
}

async function run() {
  await killPort3005();

  console.log('🚀 Spawning logistics server...');
  const serverPath = path.join(__dirname, '..', 'src', 'logistica', 'app.js');
  const server = spawn('node', [serverPath], {
    cwd: path.join(__dirname, '..'),
    env: { ...process.env, PORT_LOGISTICA: '3005' }
  });

  // Wait 3 seconds for server to start
  await new Promise(r => setTimeout(r, 3000));

  const testEmail = `test_empirical_${Math.floor(Math.random() * 100000)}@example.com`;
  let token = null;
  let userUuid = null;

  console.log(`\n1️⃣  [BACKEND] Generating invitation for CB-0002 to email: ${testEmail}...`);
  try {
    const response = await fetch('http://localhost:3005/api/logistica/b2b-onboarding/invitar', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        cliente_id: 'CB-0002',
        canal: 'email',
        destino: testEmail,
        mensajeTexto: 'Código: [Codigo_Activacion] Link: [Enlace_Al_Portal]'
      })
    });

    const resJson = await response.json();
    if (!response.ok || !resJson.success) {
      throw new Error(resJson.message || 'Invitation generation failed');
    }

    // Retrieve the token from Supabase using admin client
    const { data: dbRes, error: dbErr } = await supabaseAdmin
      .from('clientes_b2b_invitaciones')
      .select('token')
      .eq('email_portal', testEmail)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (dbErr) throw dbErr;
    if (!dbRes) {
      throw new Error('Invitation was not saved in Supabase Cloud!');
    }
    
    token = dbRes.token;
    console.log(`   ✅ Invitation successfully generated in Supabase Cloud! Token: ${token}`);

  } catch (err) {
    console.error('❌ Step 1 failed:', err.message);
    server.kill('SIGINT');
    process.exit(1);
  }

  console.log(`\n2️⃣  [PHONE STEP 1] Validating invitation token directly against Supabase Cloud...`);
  try {
    const { data: inviteData, error: inviteErr } = await supabase
      .from('clientes_b2b_invitaciones')
      .select('*')
      .eq('token', token)
      .single();

    if (inviteErr) throw inviteErr;
    console.log(`   ✅ Token validation success! Client: ${inviteData.razon_social} (ID: ${inviteData.cliente_id})`);

  } catch (err) {
    console.error('❌ Step 2 failed:', err.message);
    await cleanupDb(testEmail, token, userUuid);
    server.kill('SIGINT');
    process.exit(1);
  }

  console.log(`\n3️⃣  [PHONE STEP 2] Signing up directly via Supabase Auth (Cloud Signup Fallback)...`);
  try {
    const { data: authData, error: authErr } = await supabase.auth.signUp({
      email: testEmail,
      password: 'EmpiricalTestPassword123!',
      options: {
        data: {
          cliente_id: 'CB-0002',
          nombre_completo: 'Nicolás Test',
          nombre_empresa: 'Tus Frutos Secos',
          invitation_token: token
        }
      }
    });

    if (authErr) throw authErr;
    userUuid = authData.user.id;
    console.log(`   ✅ Auth user created successfully! UUID: ${userUuid}`);

  } catch (err) {
    console.error('❌ Step 3 failed. Full Error Object:', err);
    console.error('JSON stringified error:', JSON.stringify(err, null, 2));
    await cleanupDb(testEmail, token, userUuid);
    server.kill('SIGINT');
    process.exit(1);
  }

  // Wait 2 seconds for trigger execution
  await new Promise(r => setTimeout(r, 2000));

  console.log(`\n4️⃣  [VERIFICATION] Verifying trigger outcomes in Supabase Cloud database...`);
  try {
    // 1. Verify profile creation
    const { data: profileRes, error: profileErr } = await supabaseAdmin
      .from('clientes_b2b_perfiles')
      .select('*')
      .eq('id', userUuid)
      .maybeSingle();

    if (profileErr) throw profileErr;
    if (!profileRes) {
      throw new Error('B2B Profile was NOT created by the trigger!');
    }
    console.log('   ✅ Trigger verified: B2B profile created successfully in public.clientes_b2b_perfiles!');

    // 2. Verify invitation marked as used
    const { data: inviteRes, error: inviteStatusErr } = await supabaseAdmin
      .from('clientes_b2b_invitaciones')
      .select('usado')
      .eq('token', token)
      .single();

    if (inviteStatusErr) throw inviteStatusErr;
    if (!inviteRes.usado) {
      throw new Error('Invitation token was NOT marked as used!');
    }
    console.log('   ✅ Trigger verified: Invitation token marked as usado = true!');

    // 3. Verify auto email confirmed
    const { data: authRes, error: authFetchErr } = await supabaseAdmin.auth.admin.getUserById(userUuid);
    if (authFetchErr) throw authFetchErr;
    if (!authRes.user.email_confirmed_at) {
      throw new Error('Email was NOT automatically confirmed in Auth.users!');
    }
    console.log('   ✅ Trigger verified: Email confirmed automatically (email_confirmed_at is set)!');

    console.log('\n🎉 ALL END-TO-END FLOW CHECKS PASSED SUCCESSFULLY!');

  } catch (err) {
    console.error('❌ Step 4 failed:', err.message);
  } finally {
    await cleanupDb(testEmail, token, userUuid);
    server.kill('SIGINT');
  }

  process.exit(0);
}

run();
