const { Client } = require('pg');

const regions = [
  'sa-east-1',
  'us-east-1',
  'us-east-2',
  'us-west-1',
  'us-west-2',
  'ca-central-1',
  'eu-west-1',
  'eu-west-2',
  'eu-west-3',
  'eu-central-1',
  'eu-central-2',
  'eu-north-1',
  'eu-south-1',
  'eu-south-2',
  'ap-east-1',
  'ap-south-1',
  'ap-south-2',
  'ap-southeast-1',
  'ap-southeast-2',
  'ap-southeast-3',
  'ap-southeast-4',
  'ap-northeast-1',
  'ap-northeast-2',
  'ap-northeast-3',
  'me-south-1',
  'me-central-1',
  'af-south-1'
];

async function tryConnect(region) {
  const host = `aws-0-${region}.pooler.supabase.com`;
  const client = new Client({
    user: 'postgres.zysyxtbcvgswancxtpib',
    host: host,
    database: 'postgres',
    password: 'wvvx9vZyO5eoZ3Nh',
    port: 5432, // session mode
    connectionTimeoutMillis: 3000,
  });

  try {
    await client.connect();
    console.log(`🎉 SUCCESS connecting to host: ${host}`);
    await client.end();
    return true;
  } catch (err) {
    if (!err.message.includes('tenant/user postgres.zysyxtbcvgswancxtpib not found')) {
      console.log(`❓ Potential connect to host: ${host} - ${err.message}`);
    }
    return false;
  }
}

async function main() {
  console.log(`🔍 Probing ${regions.length} regions...`);
  for (const region of regions) {
    const ok = await tryConnect(region);
    if (ok) {
      console.log(`⭐ Region found: ${region}`);
      break;
    }
  }
  console.log('🏁 Probing completed.');
}

main();
