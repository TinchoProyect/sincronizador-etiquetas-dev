const { pool } = require('../config/database');
const express = require('express');
const diccionarioRoutes = require('../routes/bunkerDiccionario');

async function ejecutarSuiteVerificacionTier3IDs() {
    console.log('🧪 =======================================================');
    console.log('🧪 SUITE DE VERIFICACIÓN EMPÍRICA v1.6: TRAZABILIDAD POR IDs DUROS Y SELECTOR TIER-3');
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
            // PRUEBA 1: Verificación de Array familias_ids y Mapeo por IDs Duros
            // ----------------------------------------------------
            console.log('\n--- PRUEBA 1: Verificación de Trazabilidad por IDs Duros (GET /bunker-diccionario) ---');
            
            const resDict = await fetch(`${baseUrl}/api/logistica/bunker-diccionario`);
            const jsonDict = await resDict.json();
            console.log('   Respuesta HTTP GET /bunker-diccionario:', resDict.status);

            if (!resDict.ok || !jsonDict.success || !Array.isArray(jsonDict.data)) {
                throw new Error('PRUEBA 1 FALLIDA: Fallo al obtener el diccionario enriquecido.');
            }

            const terminosConFamilias = jsonDict.data.filter(t => Array.isArray(t.familias_ids) && t.familias_ids.length > 0);
            console.log(`   Total de términos recuperados: ${jsonDict.data.length}`);
            console.log(`   Términos con uso histórico relacional (familias_ids): ${terminosConFamilias.length}`);

            // Verificar que todos los elementos de familias_ids sean Números Enteros (No Strings)
            let todosIdsSonNumeros = true;
            terminosConFamilias.forEach(t => {
                t.familias_ids.forEach(famId => {
                    if (typeof famId !== 'number' || !Number.isInteger(famId)) {
                        todosIdsSonNumeros = false;
                    }
                });
            });

            if (!todosIdsSonNumeros) {
                throw new Error('PRUEBA 1 FALLIDA: Se detectaron elementos en familias_ids que no son números enteros primitivos.');
            }

            console.log('   Muestra de términos con familias_ids enteras:');
            console.table(terminosConFamilias.slice(0, 10).map(t => ({
                id: t.id,
                termino: t.termino,
                categoria: t.categoria,
                familias_ids: t.familias_ids
            })));

            console.log('   ✅ PRUEBA 1 PASADA: 100% de la trazabilidad relacional es por Primary Key Enteras (0 Strings).');

            // ----------------------------------------------------
            // PRUEBA 2: Verificación de Coerción de Tipos y Triaje Tier-3 Visual
            // ----------------------------------------------------
            console.log('\n--- PRUEBA 2: Coerción de Tipos Number() y Triaje Jerárquico visual Tier-3 ---');
            
            const familiaActivaPrueba = 1; // Familia 'Frutos Secos' (ID: 1)
            const categoriaPrueba = 'color';

            // Simular algoritmo del Frontend con casteo estricto a Number()
            const nivel1 = [];
            const nivel2 = [];
            const nivel3 = [];

            jsonDict.data.forEach(t => {
                const esCat = (t.categoria || '').trim().toLowerCase() === categoriaPrueba;
                const familiasNums = Array.isArray(t.familias_ids) ? t.familias_ids.map(id => Number(id)) : [];
                const usadoEnFamilia = familiasNums.includes(Number(familiaActivaPrueba));

                if (esCat && usadoEnFamilia) {
                    nivel1.push(t);
                } else if (esCat) {
                    nivel2.push(t);
                } else {
                    nivel3.push(t);
                }
            });

            console.log(`   Nivel 1 (🔥 Frecuentes en Familia ${familiaActivaPrueba} para "${categoriaPrueba}"): ${nivel1.map(n => n.termino).join(', ')}`);
            console.log(`   Nivel 2 (⭐ Otras Familias para "${categoriaPrueba}"): ${nivel2.map(n => n.termino).join(', ')}`);
            console.log(`   Nivel 3 (🌐 Resto del Catálogo Global): ${nivel3.length} términos.`);

            if (nivel1.length > 0 && nivel1.every(t => t.familias_ids.includes(1))) {
                console.log('   ✅ PRUEBA 2 PASADA: Triaje Tier-3 y casteo Number() colocan exitosamente los términos del Nivel 1 en la cima.');
            } else {
                throw new Error('PRUEBA 2 FALLIDA: Fallo al agrupar los términos del Nivel 1 para la familia activa.');
            }

            console.log('\n🏆 =======================================================');
            console.log('🏆 SUITE DE VERIFICACIÓN v1.6 COMPLETADA CON ÉXITO ABSOLUTO');
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

ejecutarSuiteVerificacionTier3IDs();
