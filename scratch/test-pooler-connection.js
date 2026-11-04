const { Client } = require('pg');

async function main() {
  console.log('📡 Testing connection to Supabase pooler...');
  const client = new Client({
    user: 'postgres.zysyxtbcvgswancxtpib',
    host: 'aws-0-sa-east-1.pooler.supabase.com',
    database: 'postgres',
    password: 'wvvx9vZyO5eoZ3Nh',
    port: 6543,
    ssl: {
      rejectUnauthorized: false
    }
  });

  try {
    await client.connect();
    console.log('✅ Connected successfully to Supabase pooler!');
    const res = await client.query('SELECT NOW()');
    console.log('Database time:', res.rows[0].now);
  } catch (err) {
    console.error('❌ Connection failed:', err.message);
  } finally {
    await client.end();
  }
}

main();
