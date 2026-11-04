const { Client } = require('pg');
require('dotenv').config();

async function run() {
  const pgClient = new Client({
    user: 'postgres',
    host: 'db.zysyxtbcvgswancxtpib.supabase.co',
    database: 'postgres',
    password: 'wvvx9vZyO5eoZ3Nh',
    port: 5432,
  });

  try {
    await pgClient.connect();
    console.log('Connected to Supabase database. Fetching trigger source...');

    const res = await pgClient.query(`
      SELECT prosrc 
      FROM pg_proc 
      WHERE proname = 'handle_new_b2b_user';
    `);

    if (res.rows.length === 0) {
      console.log('⚠️ Trigger function handle_new_b2b_user not found!');
    } else {
      console.log('=========================================');
      console.log('📋 DEPLOYED TRIGGER FUNCTION SOURCE CODE:');
      console.log('=========================================');
      console.log(res.rows[0].prosrc);
      console.log('=========================================');
    }

  } catch (err) {
    console.error('Connection failed:', err.message);
  } finally {
    await pgClient.end();
  }
}

run();
