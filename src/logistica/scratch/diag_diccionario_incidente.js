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
        console.log('=== 🔍 DIAGNÓSTICO INCIDENTE DICCIONARIO BÚNKER ===\n');

        // 1. Consultar familias y sus plantillas en bunker_familia_categorias
        const resFamCats = await pool.query(`
            SELECT fc.familia_id, f.nombre as familia_nombre, fc.categoria, fc.orden_posicional
            FROM public.bunker_familia_categorias fc
            JOIN public.bunker_familias f ON f.id = fc.familia_id
            ORDER BY fc.familia_id, fc.orden_posicional
        `);
        console.log('1. Plantillas de Categorías por Familia (bunker_familia_categorias):');
        console.table(resFamCats.rows);

        // 2. Consultar relaciones de atributos por artículo principal en bunker_relacion_atributo_principal
        const resRel = await pool.query(`
            SELECT r.id, r.familia_id, r.articulo_principal_id, r.articulo_principal_texto, 
                   r.termino_id, r.termino_texto, r.categoria
            FROM public.bunker_relacion_atributo_principal r
            ORDER BY r.id DESC
            LIMIT 25
        `);
        console.log('\n2. Últimas relaciones en bunker_relacion_atributo_principal:');
        console.table(resRel.rows);

        // 3. Consultar últimos términos creados en bunker_diccionario
        const resDic = await pool.query(`
            SELECT d.id, d.termino, d.abreviatura, d.categoria, d.en_revision, d.obsoleto
            FROM public.bunker_diccionario d
            ORDER BY d.id DESC
            LIMIT 25
        `);
        console.log('\n3. Últimos términos en bunker_diccionario:');
        console.table(resDic.rows);

    } catch (e) {
        console.error('Error en diagnóstico:', e);
    } finally {
        await pool.end();
    }
}

main();
