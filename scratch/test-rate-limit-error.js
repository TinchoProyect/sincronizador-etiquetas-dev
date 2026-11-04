const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

const SUPABASE_URL = process.env.SUPABASE_B2B_URL;
const ANON_KEY = process.env.SUPABASE_B2B_ANON_KEY;

const supabase = createClient(SUPABASE_URL, ANON_KEY);

async function run() {
  console.log('Triggering consecutive signups to hit Rate Limit...');
  
  for (let i = 0; i < 15; i++) {
    const email = `test_rate_limit_${i}_${Math.floor(Math.random() * 10000)}@example.com`;
    const { data, error } = await supabase.auth.signUp({
      email: email,
      password: 'TestPassword123!'
    });

    if (error) {
      console.log(`\n--- RATE LIMIT HIT AT ATTEMPT ${i} ---`);
      console.log('typeof error:', typeof error);
      console.log('error object:', error);
      console.log('error.message:', error.message);
      console.log('typeof error.message:', typeof error.message);
      console.log('JSON.stringify(error):', JSON.stringify(error));
      break;
    } else {
      console.log(`Signup ${i} succeeded: ${email}`);
    }
  }
  
  process.exit(0);
}

run();
