const { Client } = require('pg');

async function tryConnect(region) {
  const host = `aws-0-${region}.pooler.supabase.com`;
  const client = new Client({
    user: 'postgres.zysyxtbcvgswancxtpib',
    host: host,
    database: 'postgres',
    password: 'wvvx9vZyO5eoZ3Nh',
    port: 5432,
    connectionTimeoutMillis: 5000,
  });

  try {
    await client.connect();
    console.log(`✅ Success connecting to host: ${host}`);
    await client.end();
    return true;
  } catch (err) {
    console.log(`❌ Failed connecting to host: ${host} - ${err.message}`);
    return false;
  }
}

async function main() {
  const regions = ['sa-east-1', 'us-east-1', 'us-east-2', 'us-west-1', 'us-west-2', 'eu-west-1', 'eu-west-2', 'eu-west-3'];
  for (const region of regions) {
    const ok = await tryConnect(region);
    if (ok) {
      break;
    }
  }
}

main();
