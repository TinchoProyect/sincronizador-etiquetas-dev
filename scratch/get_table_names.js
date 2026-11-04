const { Client } = require('pg');
require('dotenv').config();

async function main() {
  const client = new Client({
    user: process.env.DB_USER || 'postgres',
    host: process.env.DB_HOST || 'localhost',
    database: process.env.DB_NAME || 'etiquetas',
    password: process.env.DB_PASSWORD || 'ta3Mionga',
    port: parseInt(process.env.DB_PORT || '5432'),
  });

  await client.connect();
  try {
    const res = await client.query(`
      SELECT table_name 
      FROM information_schema.tables 
      WHERE table_schema = 'public'
      ORDER BY table_name;
    `);
    const tables = res.rows.map(r => r.table_name);
    console.log('ALL TABLES IN DB:');
    console.log(tables);
  } catch (err) {
    console.error(err);
  } finally {
    await client.end();
  }
}

main();
