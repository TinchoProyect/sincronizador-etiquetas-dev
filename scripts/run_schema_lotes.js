const { Client } = require('pg');
const fs = require('fs');
const path = require('path');

async function run() {
  const client = new Client({
    user: 'postgres',
    host: 'localhost',
    database: 'etiquetas',
    password: 'ta3Mionga',
    port: 5432,
  });

  try {
    await client.connect();
    
    const sqlPath = path.join(__dirname, '..', 'scripts_db', '05_bunker_lotes_schema.sql');
    const sqlQuery = fs.readFileSync(sqlPath, 'utf8');
    
    console.log("Ejecutando script de BD...");
    await client.query(sqlQuery);
    console.log("Tablas creadas exitosamente.");

  } catch (err) {
    console.error('Error', err);
  } finally {
    await client.end();
  }
}

run();
