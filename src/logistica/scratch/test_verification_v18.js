const { pool } = require('../config/database');
const express = require('express');
const diccionarioRoutes = require('../routes/bunkerDiccionario');

async function ejecutarSuiteVerificacionV18() {
    console.log('🧪 =======================================================');
    console.log('🧪 SUITE DE VERIFICACIÓN EMPÍRICA v1.8: JSONB Y ANTI-CONTAMINACIÓN CRUZADA');
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
            // PRUEBA 1: Verificación de Formato JSONB en Backend (GET /bunker-diccionario)
            // ----------------------------------------------------
            console.log('\n--- PRUEBA 1: Extracción Relacional JSONB en Backend ---');
            
            const resDict = await fetch(`${baseUrl}/api/logistica/bunker-diccionario`);
            const jsonDict = await resDict.json();
            console.log('   Respuesta HTTP GET /bunker-diccionario:', resDict.status);

            if (!resDict.ok || !jsonDict.success || !Array.isArray(jsonDict.data)) {
                throw new Error('PRUEBA 1 FALLIDA: Fallo al obtener el diccionario enriquecido.');
            }

            const terminosConVinculaciones = jsonDict.data.filter(t => Array.isArray(t.vinculaciones_relacionales) && t.vinculaciones_relacionales.length > 0);
            console.log(`   Total de términos recuperados: ${jsonDict.data.length}`);
            console.log(`   Términos con vinculaciones_relacionales JSONB: ${terminosConVinculaciones.length}`);

            // Verificar que el formato de vinculaciones_relacionales sea objetos { familia_id, categoria }
            let todosTienenFormatoCorrecto = true;
            terminosConVinculaciones.forEach(t => {
                t.vinculaciones_relacionales.forEach(v => {
                    if (typeof v.familia_id !== 'number' || typeof v.categoria !== 'string') {
                        todosTienenFormatoCorrecto = false;
                    }
                });
            });

            if (!todosTienenFormatoCorrecto) {
                throw new Error('PRUEBA 1 FALLIDA: Se detectaron vinculaciones_relacionales sin formato { familia_id, categoria }.');
            }

            console.log('   Muestra de términos con vinculaciones JSONB:');
            console.table(terminosConVinculaciones.slice(0, 10).map(t => ({
                id: t.id,
                termino: t.termino,
                categoria: t.categoria,
                vinculaciones: JSON.stringify(t.vinculaciones_relacionales)
            })));

            console.log('   ✅ PRUEBA 1 PASADA: El Backend entrega la estructura JSONB { familia_id, categoria } correctamente.');

            // ----------------------------------------------------
            // PRUEBA 2: Verificación del Caso "Granolas" en Familia Producción (ID 42)
            // ----------------------------------------------------
            console.log('\n--- PRUEBA 2: Verificación de Cero Contaminación Cruzada (Caso Granolas) ---');
            
            const granolasTermino = jsonDict.data.find(t => t.termino.toLowerCase() === 'granolas');
            if (!granolasTermino) {
                throw new Error('PRUEBA 2 FALLIDA: Término Granolas no encontrado en el diccionario.');
            }

            console.log('   Objeto Granolas obtenido de la API:', {
                id: granolasTermino.id,
                termino: granolasTermino.termino,
                categoria: granolasTermino.categoria,
                vinculaciones: granolasTermino.vinculaciones_relacionales
            });

            const evaluarTriaje = (familiaId, categoriaEdicion) => {
                const catClean = categoriaEdicion.trim().toLowerCase();
                const tCatClean = (granolasTermino.categoria || '').trim().toLowerCase();
                const esDeEstaCategoriaNativa = (tCatClean === catClean);

                const vinculaciones = Array.isArray(granolasTermino.vinculaciones_relacionales) ? granolasTermino.vinculaciones_relacionales : [];

                const registradoEnFamiliaYCategoria = vinculaciones.some(v => 
                    Number(v.familia_id) === Number(familiaId) && 
                    (v.categoria || '').trim().toLowerCase() === catClean
                );

                const registradoEnOtrasFamiliasMismaCategoria = vinculaciones.some(v => 
                    (v.categoria || '').trim().toLowerCase() === catClean
                );

                if (registradoEnFamiliaYCategoria) {
                    return 'NIVEL 1 (🔥)';
                } else if (esDeEstaCategoriaNativa || registradoEnOtrasFamiliasMismaCategoria) {
                    return 'NIVEL 2 (⭐)';
                } else {
                    return 'NIVEL 3 (🌐)';
                }
            };

            const resultadoConformacion = evaluarTriaje(42, 'conformacion');
            const resultadoColor = evaluarTriaje(42, 'color');

            console.log(`   Resultado Granolas en Familia 42 para "conformacion": ${resultadoConformacion}`);
            console.log(`   Resultado Granolas en Familia 42 para "color": ${resultadoColor}`);

            if (resultadoConformacion === 'NIVEL 1 (🔥)' && resultadoColor === 'NIVEL 3 (🌐)') {
                console.log('   ✅ PRUEBA 2 PASADA: Granolas ingresa al Nivel 1 en Conformación y al Nivel 3 en Color (0 Contaminación Cruzada).');
            } else {
                throw new Error(`PRUEBA 2 FALLIDA: Triaje incorrecto. Conformación: ${resultadoConformacion}, Color: ${resultadoColor}`);
            }

            console.log('\n🏆 =======================================================');
            console.log('🏆 SUITE DE VERIFICACIÓN v1.8 COMPLETADA CON ÉXITO ABSOLUTO');
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

ejecutarSuiteVerificacionV18();
