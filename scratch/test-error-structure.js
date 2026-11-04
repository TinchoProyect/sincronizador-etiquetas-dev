const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

const SUPABASE_URL = process.env.SUPABASE_B2B_URL;
const ANON_KEY = process.env.SUPABASE_B2B_ANON_KEY;

const supabase = createClient(SUPABASE_URL, ANON_KEY);

async function run() {
  console.log('Sending invalid signUp request to check error structure...');
  const { data, error } = await supabase.auth.signUp({
    email: 'invalid-email-format',
    password: '12'
  });

  console.log('--- ERROR OBJECT ---');
  console.log('typeof error:', typeof error);
  console.log('error structure:', error);
  console.log('JSON.stringify(error):', JSON.stringify(error));
  
  console.log('\n--- ERROR.MESSAGE ---');
  console.log('error.message:', error.message);
  console.log('typeof error.message:', typeof error.message);
  console.log('JSON.stringify(error.message):', JSON.stringify(error.message));
  
  process.exit(0);
}

run();
