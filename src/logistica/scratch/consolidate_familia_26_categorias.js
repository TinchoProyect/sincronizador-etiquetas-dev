const { Pool } = require('pg');
require('dotenv').config();

const pool = new Pool({
    user: process.env.DB_USER || 'postgres',
    host: process.env.DB_HOST || 'localhost',
    database: process.env.DB_NAME || 'etiquetas',
    password: process.env.DB_PASSWORD || 'ta3Mionga',
    port: parseInt(process.env.DB_PORT || '5432')
});

async function updateFamilia26Categories() {
    const client = await pool.connect();
    try {
        await client.query('BEGIN');

        // Eliminar claves legacy desnormalizadas si 'nom. Fantasía' ya existe
        await client.query(`
            DELETE FROM public.bunker_familia_categorias
            WHERE familia_id = 26
              AND categoria != 'nom. Fantasía'
              AND LOWER(TRANSLATE(categoria, 'áéíóúÁÉÍÓÚ', 'aeiouAEIOU')) = 'nom. fantasia';
        `);

        await client.query('COMMIT');
        console.log('✅ Duplicados legacy eliminados de bunker_familia_categorias para Familia 26.');

    } catch (e) {
        await client.query('ROLLBACK');
        console.error('Error al actualizar categorias de familia 26:', e);
    } finally {
        client.release();
        await pool.end();
    }
}

updateFamilia26Categories();
