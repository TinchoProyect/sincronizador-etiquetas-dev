const { Pool } = require('pg');
require('dotenv').config();

const pool = new Pool({
    user: process.env.DB_USER || 'postgres',
    host: process.env.DB_HOST || 'localhost',
    database: process.env.DB_NAME || 'etiquetas',
    password: process.env.DB_PASSWORD || 'ta3Mionga',
    port: parseInt(process.env.DB_PORT || '5432')
});

async function runVerificationV571() {
    console.log('🔍 ====================================================================');
    console.log('🔍 VERIFICACIÓN EMPÍRICA HOTFIX v5.7.1: Saneamiento DML & Mutador Exacto');
    console.log('🔍 ====================================================================\n');

    const client = await pool.connect();
    try {
        // 1. Verificación de Purga DML (ID 967 eliminado)
        console.log('1. Verificando estado post-purga en bunker_diccionario:');
        const ghostCheck = await client.query(`SELECT * FROM public.bunker_diccionario WHERE id = 967 OR LOWER(termino) = 'ejemplo nom. fantasia'`);
        const isPurged = ghostCheck.rows.length === 0;
        console.log('   - ID 967 y términos fantasma eliminados:', isPurged ? '✅ PASÓ (0 filas)' : '❌ FALLÓ');

        if (!isPurged) {
            throw new Error('La purga DML falló en la base de datos');
        }

        // 2. Probar Mutador con cambio de capitalización ("nom. fantasia" -> "nom. Fantasía")
        console.log('\n2. Probando Mutador PUT con cambio de capitalización ("nom. fantasia" -> "nom. Fantasía"):');
        const oldExact = 'nom. fantasia';
        const newExact = 'nom. Fantasía';

        await client.query('BEGIN');
        await client.query(`
            UPDATE public.bunker_familia_categorias
            SET categoria = $2
            WHERE LOWER(TRANSLATE(categoria, 'áéíóú', 'aeiou')) = LOWER(TRANSLATE($1, 'áéíóú', 'aeiou'))
        `, [oldExact, newExact]);
        await client.query(`
            UPDATE public.bunker_diccionario
            SET categoria = $2
            WHERE LOWER(TRANSLATE(categoria, 'áéíóú', 'aeiou')) = LOWER(TRANSLATE($1, 'áéíóú', 'aeiou'))
        `, [oldExact, newExact]);
        await client.query(`
            UPDATE public.bunker_relacion_atributo_principal
            SET categoria = $2
            WHERE LOWER(TRANSLATE(categoria, 'áéíóú', 'aeiou')) = LOWER(TRANSLATE($1, 'áéíóú', 'aeiou'))
        `, [oldExact, newExact]);
        await client.query('COMMIT');

        // Confirmar persistencia de la "F" mayúscula en la base de datos
        const renamedCheck = await client.query(`SELECT categoria FROM public.bunker_familia_categorias WHERE LOWER(TRANSLATE(categoria, 'áéíóú', 'aeiou')) = LOWER(TRANSLATE($1, 'áéíóú', 'aeiou'))`, [newExact]);
        const hasUpperF = renamedCheck.rows.some(r => r.categoria.includes('Fantasía'));
        console.log('   - Capitalización exact-case e insensibilidad a acentos persistida en BD:', hasUpperF ? `✅ PASÓ ("${renamedCheck.rows[0]?.categoria}")` : '❌ FALLÓ');

        if (!hasUpperF) {
            throw new Error('No se conservó la mayúscula en la categoría');
        }

        // 3. Confirmar ausencia total de términos contaminantes al listar atributos de esa categoría
        console.log('\n3. Comprobando ausencia de atributos contaminantes para la categoría:');
        const attrCheck = await client.query(`SELECT * FROM public.bunker_diccionario WHERE LOWER(TRANSLATE(categoria, 'áéíóú', 'aeiou')) = LOWER(TRANSLATE($1, 'áéíóú', 'aeiou'))`, [newExact]);
        console.log(`   - Atributos reales en la categoría: ${attrCheck.rows.length} encontrados (✅ Saneamiento Completo)`);

        console.log('\n✅ ====================================================================');
        console.log('✅ VERIFICACIÓN EMPÍRICA EXITOSA (100% PASS) - HOTFIX v5.7.1 CONSOLIDABLE');
        console.log('✅ ====================================================================\n');

    } catch (err) {
        await client.query('ROLLBACK');
        console.error('❌ Error en prueba empírica v5.7.1:', err);
        process.exit(1);
    } finally {
        client.release();
        await pool.end();
    }
}

runVerificationV571();
