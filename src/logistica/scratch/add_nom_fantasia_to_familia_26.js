const { Pool } = require('pg');
require('dotenv').config();

const pool = new Pool({
    user: process.env.DB_USER || 'postgres',
    host: process.env.DB_HOST || 'localhost',
    database: process.env.DB_NAME || 'etiquetas',
    password: process.env.DB_PASSWORD || 'ta3Mionga',
    port: parseInt(process.env.DB_PORT || '5432')
});

async function addNomFantasiaToFam26() {
    const client = await pool.connect();
    try {
        await client.query('BEGIN');

        await client.query(`
            INSERT INTO public.bunker_familia_categorias (familia_id, categoria, orden_posicional)
            VALUES (26, 'nom. Fantasía', 1)
            ON CONFLICT (familia_id, categoria) DO UPDATE SET orden_posicional = 1;
        `);

        await client.query('COMMIT');
        console.log('✅ "nom. Fantasía" insertada como Posición 1 en plantilla maestra de Familia 26.');
    } catch(e) {
        await client.query('ROLLBACK');
        console.error('Error al insertar nom. Fantasia:', e);
    } finally {
        client.release();
        await pool.end();
    }
}

addNomFantasiaToFam26();
