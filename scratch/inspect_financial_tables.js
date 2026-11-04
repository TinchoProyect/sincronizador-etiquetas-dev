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
    console.log('--- SEARCHING FOR TABLES ---');
    const res = await client.query(`
      SELECT table_name 
      FROM information_schema.tables 
      WHERE table_schema = 'public'
        AND (table_name LIKE '%cuenta%' 
             OR table_name LIKE '%corriente%'
             OR table_name LIKE '%movimiento%'
             OR table_name LIKE '%factura%'
             OR table_name LIKE '%recibo%'
             OR table_name LIKE '%pago%')
      ORDER BY table_name;
    `);
    console.table(res.rows);

    // Let's print columns of some tables if they exist:
    const tables = res.rows.map(r => r.table_name);
    
    for (const table of tables) {
      console.log(`\n--- COLUMNS IN ${table} ---`);
      const cols = await client.query(`
        SELECT column_name, data_type, is_nullable
        FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = $1
        ORDER BY ordinal_position;
      `, [table]);
      console.table(cols.rows);

      // Check if there is data
      const data = await client.query(`SELECT COUNT(*) FROM ${table};`);
      console.log(`Row count: ${data.rows[0].count}`);
    }

  } catch (err) {
    console.error(err);
  } finally {
    await client.end();
  }
}

main();
