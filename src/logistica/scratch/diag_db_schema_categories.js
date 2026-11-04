const { Pool } = require('pg');
require('dotenv').config();

const pool = new Pool({
    user: process.env.DB_USER || 'postgres',
    host: process.env.DB_HOST || 'localhost',
    database: process.env.DB_NAME || 'etiquetas',
    password: process.env.DB_PASSWORD || 'ta3Mionga',
    port: parseInt(process.env.DB_PORT || '5432')
});

async function main() {
    try {
        console.log('=== 🔍 DIAGNÓSTICO ESTRUCTURAL DDL: bunker_familia_categorias & bunker_relacion_atributo_principal ===\n');

        // Columnas de bunker_familia_categorias
        const resFcCols = await pool.query(`
            SELECT column_name, data_type, is_nullable
            FROM information_schema.columns
            WHERE table_name = 'bunker_familia_categorias'
            ORDER BY ordinal_position;
        `);
        console.log('1. Columnas de bunker_familia_categorias:');
        console.table(resFcCols.rows);

        // Columnas de bunker_relacion_atributo_principal
        const resRelCols = await pool.query(`
            SELECT column_name, data_type, is_nullable
            FROM information_schema.columns
            WHERE table_name = 'bunker_relacion_atributo_principal'
            ORDER BY ordinal_position;
        `);
        console.log('\n2. Columnas de bunker_relacion_atributo_principal:');
        console.table(resRelCols.rows);

        // Filas de bunker_familia_categorias con sus PK IDs
        const resFcRows = await pool.query(`
            SELECT id, familia_id, categoria, orden_posicional
            FROM public.bunker_familia_categorias
            ORDER BY familia_id, orden_posicional;
        `);
        console.log('\n3. Filas de bunker_familia_categorias (con PK id):');
        console.table(resFcRows.rows);

    } catch (e) {
        console.error('Error en diagnóstico DDL:', e);
    } finally {
        await pool.end();
    }
}

main();
