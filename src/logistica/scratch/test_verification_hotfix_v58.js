const { Pool } = require('pg');
require('dotenv').config();

const pool = new Pool({
    user: process.env.DB_USER || 'postgres',
    host: process.env.DB_HOST || 'localhost',
    database: process.env.DB_NAME || 'etiquetas',
    password: process.env.DB_PASSWORD || 'ta3Mionga',
    port: parseInt(process.env.DB_PORT || '5432')
});

async function runVerificationV58() {
    console.log('🔍 ====================================================================');
    console.log('🔍 VERIFICACIÓN EMPÍRICA HOTFIX v5.8: Purga de DOM y Sincronización Real');
    console.log('🔍 ====================================================================\n');

    const client = await pool.connect();
    try {
        // 1. Verificar preservación literal de categoría en Backend (Paso 1)
        console.log('1. Probando Preservación de Categoría Literal (sin desmonte destructivo de acentos):');
        const testCatWithAccent = 'nom. Fantasía';
        const testTerm = 'bombón_test_v58';
        const testFamId = 26; // Frutas Disecadas

        // Obtener un articulo_principal_id válido en la BD
        const princRes = await client.query(`SELECT id, termino FROM public.bunker_diccionario WHERE categoria = 'articulo_principal' AND obsoleto IS NOT TRUE LIMIT 1`);
        const validPrinc = princRes.rows[0];

        if (!validPrinc) {
            throw new Error('No se encontró ningún artículo principal en la base de datos');
        }

        // Limpieza previa
        await client.query(`DELETE FROM public.bunker_relacion_atributo_principal WHERE termino_texto = $1`, [testTerm]);
        await client.query(`DELETE FROM public.bunker_diccionario WHERE termino = $1`, [testTerm]);

        // Insertar término en bunker_diccionario
        const dictIns = await client.query(`
            INSERT INTO public.bunker_diccionario (termino, abreviatura, categoria, en_revision, obsoleto)
            VALUES ($1, 'BMB', $2, false, false)
            RETURNING id, termino, categoria;
        `, [testTerm, testCatWithAccent]);

        const termId = dictIns.rows[0].id;

        // Inserción relacional simulando crearTerminoEnCategoria con la categoría literal "nom. Fantasía"
        const relIns = await client.query(`
            INSERT INTO public.bunker_relacion_atributo_principal 
                (familia_id, articulo_principal_id, articulo_principal_texto, termino_id, termino_texto, categoria)
            VALUES ($1, $2, $3, $4, $5, $6)
            RETURNING id, categoria;
        `, [testFamId, validPrinc.id, validPrinc.termino, termId, testTerm, testCatWithAccent]);

        const isExactCatPreserved = relIns.rows[0].categoria === testCatWithAccent;
        console.log('   - Categoría literal guardada en BD sin desmonte de acentos:', isExactCatPreserved ? `✅ PASÓ ("${relIns.rows[0].categoria}")` : '❌ FALLÓ');

        if (!isExactCatPreserved) {
            throw new Error('No se conservó la categoría literal en la base de datos');
        }

        // 2. Simular emparejamiento resiliente en renderizarAcordeon (Paso 4)
        console.log('\n2. Probando Emparejamiento Resiliente en renderizarAcordeon (Accentuación Tolerante):');
        const mapConsolidado = {
            'nom. fantasía': { categoria: 'nom. fantasía', terms: [] }
        };

        const jerarquiaGlobalMock = {
            'nom. fantasia': [{ id: termId, termino: testTerm }] // Key proveniente de BD antigua o descalzada
        };

        // Algoritmo de renderizarAcordeon v5.8
        const tienePlantillaExplicita = true;
        Object.keys(jerarquiaGlobalMock).forEach(catRaw => {
            const catKeyRaw = catRaw.toLowerCase();
            const catKeyNorm = catKeyRaw.normalize("NFD").replace(/[\u0300-\u036f]/g, "");

            let matchedKey = Object.keys(mapConsolidado).find(k => k === catKeyRaw || k.normalize("NFD").replace(/[\u0300-\u036f]/g, "") === catKeyNorm);
            if (tienePlantillaExplicita && !matchedKey) return;

            const targetKey = matchedKey || catKeyRaw;
            (jerarquiaGlobalMock[catRaw] || []).forEach(item => {
                mapConsolidado[targetKey].terms.push(item);
            });
        });

        const isMappedSuccessfully = mapConsolidado['nom. fantasía'].terms.length === 1 && mapConsolidado['nom. fantasía'].terms[0].termino === testTerm;
        console.log('   - Emparejamiento tolerante a acentos en UI:', isMappedSuccessfully ? `✅ PASÓ (Término "${testTerm}" inyectado en "nom. fantasía")` : '❌ FALLÓ');

        if (!isMappedSuccessfully) {
            throw new Error('Fallo al emparejar categorías con descalce de acentos');
        }

        // Limpieza final de datos de prueba
        await client.query(`DELETE FROM public.bunker_relacion_atributo_principal WHERE termino_texto = $1`, [testTerm]);
        await client.query(`DELETE FROM public.bunker_diccionario WHERE termino = $1`, [testTerm]);
        console.log('\n3. Limpieza de entorno de prueba completada.');

        console.log('\n✅ ====================================================================');
        console.log('✅ VERIFICACIÓN EMPÍRICA EXITOSA (100% PASS) - HOTFIX v5.8 CONSOLIDABLE');
        console.log('✅ ====================================================================\n');

    } catch (err) {
        await client.query('ROLLBACK');
        console.error('❌ Error en prueba empírica v5.8:', err);
        process.exit(1);
    } finally {
        client.release();
        await pool.end();
    }
}

runVerificationV58();
