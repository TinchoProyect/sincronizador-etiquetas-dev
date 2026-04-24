const { Pool } = require('pg');
require('dotenv').config();

const pool = new Pool({
  user: process.env.DB_USER || 'postgres',
  host: process.env.DB_HOST || 'localhost',
  database: process.env.DB_NAME || 'lamda',
  password: process.env.DB_PASSWORD || '1234',
  port: process.env.DB_PORT || 5432,
});

async function run() {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    
    // Add en_pausa
    await client.query(`ALTER TABLE rutas ADD COLUMN IF NOT EXISTS en_pausa BOOLEAN DEFAULT false;`);
    
    // Add inicio_ultima_pausa
    await client.query(`ALTER TABLE rutas ADD COLUMN IF NOT EXISTS inicio_ultima_pausa TIMESTAMP WITH TIME ZONE NULL;`);
    
    // Add tiempo_pausado_minutos
    await client.query(`ALTER TABLE rutas ADD COLUMN IF NOT EXISTS tiempo_pausado_minutos INTEGER DEFAULT 0;`);
    
    // Add duracion_neta_minutos
    await client.query(`ALTER TABLE rutas ADD COLUMN IF NOT EXISTS duracion_neta_minutos INTEGER NULL;`);
    
    await client.query('COMMIT');
    console.log('✅ Base de datos actualizada con éxito (en_pausa, inicio_ultima_pausa, tiempo_pausado_minutos, duracion_neta_minutos)');
  } catch(e) {
    await client.query('ROLLBACK');
    console.error('❌ Error al actualizar la base de datos:', e);
  } finally {
    client.release();
    pool.end();
  }
}

run();
