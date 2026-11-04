require('dotenv').config();
console.log('SUPABASE_B2B_URL:', process.env.SUPABASE_B2B_URL);
console.log('DB Host should be: db.' + (process.env.SUPABASE_B2B_URL || '').replace('https://', '') + ' or similar.');
