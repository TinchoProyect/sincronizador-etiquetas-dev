const { Pool } = require('pg');
require('dotenv').config();

const pool = new Pool({
    user: process.env.DB_USER || 'postgres',
    host: process.env.DB_HOST || 'localhost',
    database: process.env.DB_NAME || 'etiquetas',
    password: process.env.DB_PASSWORD || 'ta3Mionga',
    port: parseInt(process.env.DB_PORT || '5432')
});

async function runDMLPurge() {
    console.log('⚡ ====================================================================');
    console.log('⚡ EJECUCIÓN DE PURGA DML RETROSPECTIVA v5.7.1 (POSTGRESQL)');
    console.log('⚡ ====================================================================\n');

    const client = await pool.connect();
    try {
        await client.query('BEGIN');

        // 1. Purga específica de ID 967 y términos fantasma
        const deleteRes = await client.query(`
            DELETE FROM public.bunker_diccionario
            WHERE id = 967
               OR LOWER(termino) LIKE 'ejemplo %'
               OR (LOWER(termino) = LOWER(categoria) AND creado_en >= '2026-07-28')
            RETURNING id, termino, categoria;
        `);

        await client.query('COMMIT');

        console.log(`✅ Purga DML ejecutada exitosamente (${deleteRes.rows.length} filas eliminadas):`);
        console.table(deleteRes.rows);

        // Verificación de sanidad: SELECT id=967
        const verifyRes = await client.query(`SELECT id FROM public.bunker_diccionario WHERE id = 967`);
        console.log(`\nVerificación post-purga (ID 967 en bunker_diccionario): ${verifyRes.rows.length === 0 ? '✅ ELIMINADO (0 filas)' : '❌ PERMANECE'}`);

    } catch (err) {
        await client.query('ROLLBACK');
        console.error('❌ Error en script de purga DML:', err);
        process.exit(1);
    } finally {
        client.release();
        await pool.end();
    }
}

runDMLPurge();
