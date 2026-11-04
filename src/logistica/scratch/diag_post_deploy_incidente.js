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
        console.log('=== 🔍 DIAGNÓSTICO EMPÍRICO FORENSE: INCIDENTE PRODUCCIÓN v5.67-rev3 ===\n');

        // 1. Consultar bunker_familia_categorias para Familia 42 (Producción)
        const resFc = await pool.query(`
            SELECT id, familia_id, categoria, orden_posicional
            FROM public.bunker_familia_categorias
            WHERE familia_id = 42
            ORDER BY orden_posicional;
        `);
        console.log('1. Categorías de la Familia 42 ("Producción") en bunker_familia_categorias:');
        console.table(resFc.rows);

        // 2. Consultar relaciones en bunker_relacion_atributo_principal para Familia 42 y Artículo Principal 902 ("Unidad Productiva")
        const resRel = await pool.query(`
            SELECT id, familia_id, articulo_principal_id, articulo_principal_texto, 
                   termino_id, termino_texto, categoria, categoria_id
            FROM public.bunker_relacion_atributo_principal
            WHERE familia_id = 42 OR LOWER(termino_texto) LIKE '%grana%'
            ORDER BY id DESC;
        `);
        console.log('\n2. Relaciones en bunker_relacion_atributo_principal para Familia 42 o "grana":');
        console.table(resRel.rows);

        // 3. Consultar término "Grana flor" o "Grana sol" en bunker_diccionario
        const resDic = await pool.query(`
            SELECT id, termino, abreviatura, categoria, en_revision, obsoleto
            FROM public.bunker_diccionario
            WHERE LOWER(termino) LIKE '%grana%' OR id IN (SELECT termino_id FROM public.bunker_relacion_atributo_principal WHERE familia_id = 42);
        `);
        console.log('\n3. Términos en bunker_diccionario ("Grana" o asignados a Familia 42):');
        console.table(resDic.rows);

    } catch (e) {
        console.error('Error en diagnóstico forense:', e);
    } finally {
        await pool.end();
    }
}

main();
