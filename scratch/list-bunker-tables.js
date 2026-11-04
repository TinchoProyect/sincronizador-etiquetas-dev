require('dotenv').config();
const { Client } = require('pg');

const client = new Client({
  user: process.env.DB_USER,
  host: process.env.DB_HOST,
  database: process.env.DB_NAME,
  password: process.env.DB_PASSWORD,
  port: process.env.DB_PORT,
});

client.connect()
  .then(async () => {
    const res = await client.query(`
      SELECT table_name 
      FROM information_schema.tables 
      WHERE table_schema = 'public' AND table_name LIKE '%bunker%'
      ORDER BY table_name
    `);
    console.log('Bunker Tables:', res.rows.map(r => r.table_name));
    
    for (const table of res.rows.map(r => r.table_name)) {
      const colRes = await client.query(`
        SELECT column_name, data_type 
        FROM information_schema.columns 
        WHERE table_name = $1
      `, [table]);
      console.log(`\nTable: ${table}`);
      console.log(colRes.rows.map(c => `${c.column_name}: ${c.data_type}`).join('\n'));
    }

    client.end();
  })
  .catch(err => {
    console.error('Connection error:', err);
  });
