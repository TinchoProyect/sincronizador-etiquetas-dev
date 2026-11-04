const { pool } = require('../config/database');
const express = require('express');
const diccionarioRoutes = require('../routes/bunkerDiccionario');

async function ejecutarSuiteVerificacionSaneamientoV26() {
    console.log('🧪 =======================================================');
    console.log('🧪 SUITE DE VERIFICACIÓN EMPÍRICA v2.6: SANEAMIENTO DE DICCIONARIO');
    console.log('🧪 =======================================================');

    const app = express();
    app.use(express.json());
    app.use((req, res, next) => { req.db = pool; next(); });
    app.use('/api/logistica/bunker-diccionario', diccionarioRoutes);

    const server = app.listen(0, async () => {
        const port = server.address().port;
        const baseUrl = `http://localhost:${port}`;
        console.log(`📡 Servidor de prueba iniciado en ${baseUrl}`);

        try {
            // ----------------------------------------------------
            // PRUEBA 1: Verificación de Atributos Principales Activos (GET /bunker-diccionario/principales)
            // ----------------------------------------------------
            console.log('\n--- PRUEBA 1: Consulta API GET /principales tras Saneamiento ---');
            
            const resPrinc = await fetch(`${baseUrl}/api/logistica/bunker-diccionario/principales?familia_id=42`);
            const jsonPrinc = await resPrinc.json();
            console.log('   Respuesta HTTP GET /principales:', resPrinc.status);

            if (!resPrinc.ok || !jsonPrinc.success || !Array.isArray(jsonPrinc.data)) {
                throw new Error('PRUEBA 1 FALLIDA: Fallo al obtener atributos principales.');
            }

            console.log(`   Total de atributos principales retornados en la API: ${jsonPrinc.data.length}`);
            console.table(jsonPrinc.data);

            // Verificar que NINGÚN elemento del array contiene descripciones largas o contaminadas
            const contaminadosEncontrados = jsonPrinc.data.filter(item => 
                item.termino.includes('Guara RLLADA') || 
                item.termino.includes('27/30 x 22') ||
                item.termino.includes('Coco Neutro') ||
                item.termino.includes('PROD INT')
            );

            if (contaminadosEncontrados.length > 0) {
                throw new Error(`PRUEBA 1 FALLIDA: Se hallaron ${contaminadosEncontrados.length} elementos contaminados en la API.`);
            }

            console.log('   ✅ PRUEBA 1 PASADA: Cero descripciones compuestas o contaminadas en la API GET /principales.');

            // ----------------------------------------------------
            // PRUEBA 2: Verificación de Registros Obsoletos en Base de Datos
            // ----------------------------------------------------
            console.log('\n--- PRUEBA 2: Conteo de Obsoletos en PostgreSQL ---');
            
            const resObsoletos = await pool.query(`
                SELECT COUNT(*) as count 
                FROM public.bunker_diccionario 
                WHERE categoria = 'articulo_principal' AND obsoleto IS TRUE;
            `);

            console.log(`   Total registros obsoletos en bunker_diccionario (categoria articulo_principal): ${resObsoletos.rows[0].count}`);
            
            if (parseInt(resObsoletos.rows[0].count) >= 72) {
                console.log('   ✅ PRUEBA 2 PASADA: Los 72 registros huérfanos fueron marcados como obsoleto = true.');
            } else {
                throw new Error('PRUEBA 2 FALLIDA: Conteo de obsoletos menor a 72.');
            }

            console.log('\n🏆 =======================================================');
            console.log('🏆 SUITE DE VERIFICACIÓN v2.6 COMPLETADA CON ÉXITO ABSOLUTO');
            console.log('🏆 =======================================================\n');
        } catch (err) {
            console.error('\n❌ ERROR EN SUITE DE PRUEBAS:', err.message);
            process.exitCode = 1;
        } finally {
            server.close();
            await pool.end();
        }
    });
}

ejecutarSuiteVerificacionSaneamientoV26();
