const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');
require('dotenv').config();

const pool = new Pool({
  user: process.env.DB_USER || 'postgres',
  host: process.env.DB_HOST || 'localhost',
  database: process.env.DB_NAME || 'etiquetas',
  password: process.env.DB_PASSWORD || 'ta3Mionga',
  port: parseInt(process.env.DB_PORT || '5432'),
});

async function run() {
  const client = await pool.connect();
  try {
    const sqlPath = path.join(__dirname, '..', 'src', 'logistica', 'migrations', '23_onboarding_b2b.sql');
    console.log(`Reading migration file from ${sqlPath}...`);
    const sql = fs.readFileSync(sqlPath, 'utf8');
    
    console.log('Executing migration query...');
    await client.query(sql);
    console.log('🚀 Migration 23_onboarding_b2b.sql executed successfully!');
  } catch (err) {
    console.error('❌ Migration failed:', err.message);
  } finally {
    client.release();
    await pool.end();
  }
}

run();
