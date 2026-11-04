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
        const mpbSrc = await pool.query(`SELECT articulo_numero, descripcion, kilos_unidad FROM public.stock_real_consolidado WHERE articulo_numero = 'MPB'`);
        console.log('stock_real_consolidado MPB:', mpbSrc.rows);

        const mpbBa = await pool.query(`SELECT articulo_id, descripcion, kilos_unidad FROM public.bunker_articulos WHERE articulo_id = 'MPB'`);
        console.log('bunker_articulos MPB:', mpbBa.rows);

    } catch (err) {
        console.error(err);
    } finally {
        await pool.end();
    }
}

main();
