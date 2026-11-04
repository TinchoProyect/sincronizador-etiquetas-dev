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
        console.log('=== 🔍 DIAGNÓSTICO PROFUNDO PLANTILLAS Y CATEGORÍAS ===\n');

        const resFamCats = await pool.query(`
            SELECT fc.familia_id, f.nombre as familia_nombre, fc.categoria, fc.orden_posicional
            FROM public.bunker_familia_categorias fc
            JOIN public.bunker_familias f ON f.id = fc.familia_id
            ORDER BY fc.familia_id, fc.orden_posicional
        `);
        console.log('1. Plantillas de Categorías por Familia (bunker_familia_categorias):');
        console.table(resFamCats.rows);

        const resCats = await pool.query(`
            SELECT DISTINCT categoria FROM public.bunker_relacion_atributo_principal
        `);
        console.log('\n2. Categorías presentes en bunker_relacion_atributo_principal:');
        console.table(resCats.rows);

        const resDicCats = await pool.query(`
            SELECT DISTINCT categoria FROM public.bunker_diccionario
        `);
        console.log('\n3. Categorías presentes en bunker_diccionario:');
        console.table(resDicCats.rows);

    } catch (e) {
        console.error('Error en diagnóstico:', e);
    } finally {
        await pool.end();
    }
}

main();
