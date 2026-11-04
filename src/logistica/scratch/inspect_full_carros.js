const { Pool } = require('pg');
require('dotenv').config();

const pool = new Pool({
  user: process.env.DB_USER || 'postgres',
  host: process.env.DB_HOST || 'localhost',
  database: process.env.DB_NAME || 'sincronizador_etiquetas',
  password: process.env.DB_PASSWORD || 'mar1978',
  port: process.env.DB_PORT || 5432,
});

async function main() {
    try {
        const carros = [2655, 2611, 2532, 2508];

        console.log('=== 1. produccion_externa_historial COMPLETO ===');
        const peh = await pool.query(`SELECT * FROM public.produccion_externa_historial WHERE carro_id = ANY($1::int[])`, [carros]);
        console.log(peh.rows);

        console.log('\n=== 2. stock_ventas_movimientos COMPLETO ===');
        const svm = await pool.query(`SELECT * FROM public.stock_ventas_movimientos WHERE carro_id = ANY($1::int[])`, [carros]);
        console.log(svm.rows);

        console.log('\n=== 3. Tablas relativas a carros (si existen) ===');
        const tablesRes = await pool.query(`
            SELECT table_name 
            FROM information_schema.tables 
            WHERE table_schema = 'public' AND (table_name LIKE '%carro%' OR table_name LIKE '%produccion%' OR table_name LIKE '%historial%')
        `);
        console.log('Tablas encontradas:', tablesRes.rows.map(r => r.table_name));

    } catch (err) {
        console.error(err);
    } finally {
        await pool.end();
    }
}

main();
