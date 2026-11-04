const { Client } = require('pg');

async function testPrefix(prefix) {
  const host = `${prefix}-sa-east-1.pooler.supabase.com`;
  console.log(`Testing host: ${host}`);
  const client = new Client({
    user: 'postgres.zysyxtbcvgswancxtpib',
    host: host,
    database: 'postgres',
    password: 'wvvx9vZyO5eoZ3Nh',
    port: 6543,
    ssl: {
      rejectUnauthorized: false
    },
    connectionTimeoutMillis: 5000
  });

  try {
    await client.connect();
    console.log(`🎉 SUCCESS! Connected to host: ${host}`);
    await client.end();
    return true;
  } catch (err) {
    console.log(`❌ Host [${host}] failed: ${err.message}`);
    try { await client.end(); } catch (e) {}
    return false;
  }
}

async function main() {
  const prefixes = ['aws-0', 'aws-1', 'aws-2', 'aws-3', 'aws-4', 'aws-5'];
  for (const prefix of prefixes) {
    const ok = await testPrefix(prefix);
    if (ok) {
      process.exit(0);
    }
  }
}
main();
