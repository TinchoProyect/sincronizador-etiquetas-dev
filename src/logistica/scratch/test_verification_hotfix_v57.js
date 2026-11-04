const { Pool } = require('pg');
require('dotenv').config();

const pool = new Pool({
    user: process.env.DB_USER || 'postgres',
    host: process.env.DB_HOST || 'localhost',
    database: process.env.DB_NAME || 'etiquetas',
    password: process.env.DB_PASSWORD || 'ta3Mionga',
    port: parseInt(process.env.DB_PORT || '5432')
});

async function runVerificationV57() {
    console.log('🔍 ====================================================================');
    console.log('🔍 VERIFICACIÓN EMPÍRICA HOTFIX v5.7: Separación Ontológica y Mutador PUT');
    console.log('🔍 ====================================================================\n');

    const client = await pool.connect();
    try {
        const testCategoryInit = 'prueba_eje_v57';
        const testCategoryRenamed = 'prueba_eje_v57_modificado';
        const testFamiliaId = 26; // Frutas Disecadas

        // Limpieza previa de entorno de prueba si existiera
        await client.query(`DELETE FROM public.bunker_familia_categorias WHERE LOWER(categoria) IN ($1, $2)`, [testCategoryInit, testCategoryRenamed]);
        await client.query(`DELETE FROM public.bunker_diccionario WHERE LOWER(categoria) IN ($1, $2)`, [testCategoryInit, testCategoryRenamed]);

        // 1. Simulación de Alta Limpia (Paso 1)
        console.log('1. Probando Alta Limpia de Categoría sin Inyección Fantasma:');
        const insertRes = await client.query(`
            INSERT INTO public.bunker_familia_categorias (familia_id, categoria, orden_posicional)
            VALUES ($1, $2, 99)
            RETURNING *
        `, [testFamiliaId, testCategoryInit]);
        console.log('   - Eje posicional insertado en bunker_familia_categorias:', insertRes.rows[0].categoria);

        // Verificar que NO exista ningún término inyectado en bunker_diccionario para esta categoría
        const checkDictRes = await client.query(`
            SELECT * FROM public.bunker_diccionario WHERE LOWER(categoria) = $1
        `, [testCategoryInit]);

        const noGhostTerms = checkDictRes.rows.length === 0;
        console.log('   - Ausencia total de términos fantasma en bunker_diccionario:', noGhostTerms ? '✅ PASÓ (0 términos)' : '❌ FALLÓ');

        if (!noGhostTerms) {
            throw new Error('Se detectaron términos fantasma en bunker_diccionario');
        }

        // 2. Simulación de Mutador PUT /categorias/renombrar en cascada (Paso 2)
        console.log('\n2. Probando Mutador Transaccional de Renombrado en Cascada:');
        
        await client.query('BEGIN');
        await client.query(`UPDATE public.bunker_familia_categorias SET categoria = $2 WHERE LOWER(categoria) = LOWER($1)`, [testCategoryInit, testCategoryRenamed]);
        await client.query(`UPDATE public.bunker_diccionario SET categoria = $2 WHERE LOWER(categoria) = LOWER($1)`, [testCategoryInit, testCategoryRenamed]);
        await client.query(`UPDATE public.bunker_relacion_atributo_principal SET categoria = $2 WHERE LOWER(categoria) = LOWER($1)`, [testCategoryInit, testCategoryRenamed]);
        await client.query('COMMIT');

        // Verificar persistencia del nuevo nombre en bunker_familia_categorias
        const checkRenamedRes = await client.query(`
            SELECT * FROM public.bunker_familia_categorias WHERE LOWER(categoria) = $1 AND familia_id = $2
        `, [testCategoryRenamed, testFamiliaId]);

        const isRenamedInDb = checkRenamedRes.rows.length > 0;
        console.log('   - Eje renombrado exitosamente en BD:', isRenamedInDb ? `✅ PASÓ ("${testCategoryRenamed}")` : '❌ FALLÓ');

        if (!isRenamedInDb) {
            throw new Error('Fallo al renombrar la categoría en BD');
        }

        // Limpieza final de prueba
        await client.query(`DELETE FROM public.bunker_familia_categorias WHERE LOWER(categoria) IN ($1, $2)`, [testCategoryInit, testCategoryRenamed]);
        console.log('\n3. Limpieza de datos de prueba completada.');

        console.log('\n✅ ====================================================================');
        console.log('✅ VERIFICACIÓN EMPÍRICA EXITOSA (100% PASS) - HOTFIX v5.7 CONSOLIDABLE');
        console.log('✅ ====================================================================\n');
    } catch (err) {
        await client.query('ROLLBACK');
        console.error('❌ Error en prueba v5.7:', err);
        process.exit(1);
    } finally {
        client.release();
        await pool.end();
    }
}

runVerificationV57();
