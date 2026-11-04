const { Pool } = require('pg');
const pool = new Pool({
    host: 'localhost',
    user: 'postgres',
    password: 'ta3Mionga',
    database: 'etiquetas'
});

async function findSemillaInArticulos() {
    console.log('🔍 Buscando en public.articulos...');
    const res = await pool.query(`
        SELECT numero, nombre, codigo_barras
        FROM public.articulos
        WHERE nombre ILIKE '%semilla%' OR nombre ILIKE '%pasas%' OR nombre ILIKE '%sin%'
    `);
    console.log('Artículos encontrados en public.articulos:', res.rows);
    pool.end();
}

findSemillaInArticulos().catch(console.error);
