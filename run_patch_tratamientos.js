require('dotenv').config(); // para BD Produccion
const { Pool } = require('pg');

async function runPatch() {
  // Primero corremos para test, luego produccion
  const envs = [
      { name: 'TEST', file: '.env.test' },
      { name: 'PROD', file: '.env' }
  ];

  for (const env of envs) {
      require('dotenv').config({ path: env.file, override: true });
      
      const pool = new Pool({
          user: process.env.DB_USER,
          host: process.env.DB_HOST,
          database: process.env.DB_NAME,
          password: process.env.DB_PASSWORD,
          port: process.env.DB_PORT,
      });

      console.log(`\n=== Corriendo parche en entorno ${env.name} BD: ${process.env.DB_NAME} ===`);

      try {
          const client = await pool.connect();
          try {
              console.log('Aplicando DROP NOT NULL a articulo_numero...');
              await client.query(`ALTER TABLE public.mantenimiento_tratamientos_items ALTER COLUMN articulo_numero DROP NOT NULL;`);
              console.log('✅ Parche aplicado con éxito.');
          } finally {
              client.release();
          }
      } catch (err) {
          console.error(`❌ Error en conexión o ejecución:`, err.message);
      } finally {
          await pool.end();
      }
  }
}

runPatch().then(() => console.log('\nFinalizado.')).catch(console.error);
