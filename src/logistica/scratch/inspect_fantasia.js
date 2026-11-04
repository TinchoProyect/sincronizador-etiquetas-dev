const { Pool } = require('pg');
require('dotenv').config();

const pool = new Pool({
    user: process.env.DB_USER || 'postgres',
    host: process.env.DB_HOST || 'localhost',
    database: process.env.DB_NAME || 'etiquetas',
    password: process.env.DB_PASSWORD || 'ta3Mionga',
    port: parseInt(process.env.DB_PORT || '5432')
});

async function inspectCategories() {
    const res = await pool.query(`SELECT * FROM public.bunker_familia_categorias WHERE LOWER(categoria) LIKE '%fantasia%' OR LOWER(categoria) LIKE '%nom%'`);
    console.table(res.rows);
    await pool.end();
}

inspectCategories();
