const { Pool } = require('pg');
const pool = new Pool({
    host: 'localhost',
    user: 'postgres',
    password: 'ta3Mionga',
    database: 'etiquetas'
});

async function inspectSchema() {
    const res = await pool.query(`
        SELECT column_name 
        FROM information_schema.columns 
        WHERE table_name = 'articulos'
    `);
    console.log('Columnas de public.articulos:', res.rows.map(r => r.column_name));
    pool.end();
}

inspectSchema().catch(console.error);
