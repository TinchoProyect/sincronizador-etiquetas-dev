const { Client } = require('pg');
require('dotenv').config();

async function main() {
  const client = new Client({
    user: 'postgres',
    host: 'localhost',
    database: 'etiquetas',
    password: 'ta3Mionga',
    port: 5432,
  });

  await client.connect();
  try {
    const tablesRes = await client.query(`
      SELECT table_name 
      FROM information_schema.tables 
      WHERE table_schema = 'public' AND table_type = 'BASE TABLE';
    `);

    const term = 'cb60cca3';
    console.log(`Searching for term "${term}" in all public tables...`);

    for (const row of tablesRes.rows) {
      const tableName = row.table_name;
      
      // Get text/varchar/uuid columns
      const colsRes = await client.query(`
        SELECT column_name, data_type 
        FROM information_schema.columns 
        WHERE table_schema = 'public' AND table_name = $1 
          AND (data_type LIKE '%char%' OR data_type LIKE '%text%' OR data_type = 'uuid');
      `, [tableName]);

      if (colsRes.rows.length === 0) continue;

      const conditions = colsRes.rows.map(c => `CAST("${c.column_name}" AS TEXT) ILIKE '%${term}%'`).join(' OR ');
      const queryStr = `SELECT * FROM "${tableName}" WHERE ${conditions} LIMIT 5;`;

      try {
        const searchRes = await client.query(queryStr);
        if (searchRes.rows.length > 0) {
          console.log(`\n🎉 MATCH FOUND in table "${tableName}":`);
          console.table(searchRes.rows);
        }
      } catch (err) {
        // Skip table if query fails for some reason
      }
    }
    console.log('\nSearch completed.');
  } catch (err) {
    console.error(err);
  } finally {
    await client.end();
  }
}

main();
