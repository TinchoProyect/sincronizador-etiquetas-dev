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

        console.log('=== 1. auditoria_preparacion_carro ===');
        const apc = await pool.query(`SELECT * FROM public.auditoria_preparacion_carro WHERE carro_id = ANY($1::int[])`, [carros]);
        console.log(apc.rows);

        console.log('\n=== 2. auditoria_produccion_individual ===');
        const api = await pool.query(`SELECT * FROM public.auditoria_produccion_individual WHERE carro_id = ANY($1::int[])`, [carros]);
        console.log(api.rows);

        console.log('\n=== 3. carros_produccion ===');
        const cp = await pool.query(`SELECT * FROM public.carros_produccion WHERE id = ANY($1::int[])`, [carros]);
        console.log(cp.rows);

        console.log('\n=== 4. carros_articulos ===');
        const ca = await pool.query(`SELECT * FROM public.carros_articulos WHERE carro_id = ANY($1::int[])`, [carros]);
        console.log(ca.rows);

    } catch (err) {
        console.error(err);
    } finally {
        await pool.end();
    }
}

main();
