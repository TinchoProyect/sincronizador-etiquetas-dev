const { Pool } = require('pg');
const fs = require('fs');
const path = require('path');
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
    console.log('🚀 [MIGRATION-27] Ejecutando DDL de Familias y Moldes...');
    const sqlPath = path.join(__dirname, '../src/logistica/migrations/27_nuevo_paradigma_bunker_familias.sql');
    const sql = fs.readFileSync(sqlPath, 'utf8');
    
    await client.query(sql);
    console.log('✅ [MIGRATION-27] DDL y Moldes creados con éxito.');

    console.log('⚡ [MIGRATION-27] Ejecutando migración de datos históricos...');
    await client.query('CALL public.migrar_bunker_hacia_nuevo_paradigma(500);');
    console.log('🎉 [MIGRATION-27] Migración de datos históricos completada exitosamente!');
  } catch (err) {
    console.error('❌ [MIGRATION-27] Error ejecutando la migración:', err);
  } finally {
    client.release();
    pool.end();
  }
}

run();
