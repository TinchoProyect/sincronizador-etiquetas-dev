const { Client } = require('pg');

const regions = [
  'sa-east-1',
  'us-east-1',
  'us-east-2',
  'us-west-1',
  'us-west-2',
  'eu-central-1',
  'eu-west-1'
];

async function testRegion(region) {
  const host = `aws-0-${region}.pooler.supabase.com`;
  console.log(`📡 Testing connection to pooler in region [${region}] (${host})...`);
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
    console.log(`🎉 SUCCESS! Connected to pooler in region [${region}]!`);
    await client.end();
    return true;
  } catch (err) {
    console.log(`❌ Region [${region}] failed: ${err.message}`);
    try { await client.end(); } catch (e) {}
    return false;
  }
}

async function main() {
  for (const region of regions) {
    const ok = await testRegion(region);
    if (ok) {
      console.log(`\nFound correct region: ${region}`);
      process.exit(0);
    }
  }
  console.log('\nCould not connect to any tested region.');
  process.exit(1);
}

main();
