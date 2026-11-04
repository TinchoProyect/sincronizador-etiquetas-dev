const { Pool } = require('pg');
const pool = new Pool({
    host: 'localhost',
    user: 'postgres',
    password: 'ta3Mionga',
    database: 'etiquetas'
});

async function main() {
    const res = await pool.query("SELECT id, termino, abreviatura, categoria FROM public.bunker_diccionario WHERE termino ILIKE '%acei%'");
    console.log('Filas encontradas para acei:');
    console.table(res.rows);
    pool.end();
}

main().catch(console.error);
