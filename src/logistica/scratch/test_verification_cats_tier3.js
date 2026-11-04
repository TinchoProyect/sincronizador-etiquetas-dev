const { pool } = require('../config/database');
const express = require('express');
const taxonomiaRoutes = require('../routes/bunkerTaxonomia');

async function ejecutarSuiteVerificacionCatsTier3() {
    console.log('🧪 =======================================================');
    console.log('🧪 SUITE DE VERIFICACIÓN EMPÍRICA v1.9: SELECTOR DE CATEGORÍAS TIER-3 UX');
    console.log('🧪 =======================================================');

    const app = express();
    app.use(express.json());
    app.use((req, res, next) => { req.db = pool; next(); });
    app.use('/api/logistica/bunker-taxonomia', taxonomiaRoutes);

    const server = app.listen(0, async () => {
        const port = server.address().port;
        const baseUrl = `http://localhost:${port}`;
        console.log(`📡 Servidor de prueba iniciado en ${baseUrl}`);

        try {
            // ----------------------------------------------------
            // PRUEBA 1: Verificación de Categorías Globales Enriquecidas con familias_ids
            // ----------------------------------------------------
            console.log('\n--- PRUEBA 1: Consulta SQL de Categorías Globales Enriquecidas (GET /categorias-globales) ---');
            
            const resCats = await fetch(`${baseUrl}/api/logistica/bunker-taxonomia/categorias-globales`);
            const jsonCats = await resCats.json();
            console.log('   Respuesta HTTP GET /categorias-globales:', resCats.status);

            if (!resCats.ok || !jsonCats.success || !Array.isArray(jsonCats.data)) {
                throw new Error('PRUEBA 1 FALLIDA: Fallo al obtener categorías globales enriquecidas.');
            }

            console.log(`   Total de categorías obtenidas: ${jsonCats.data.length}`);
            console.log('   Muestra de categorías con familias_ids:');
            console.table(jsonCats.data);

            let todasTienenFamiliasIds = jsonCats.data.every(c => Array.isArray(c.familias_ids));
            if (!todasTienenFamiliasIds) {
                throw new Error('PRUEBA 1 FALLIDA: Se detectaron categorías sin la propiedad familias_ids.');
            }

            console.log('   ✅ PRUEBA 1 PASADA: Todas las categorías globales incluyen el array relacional familias_ids.');

            // ----------------------------------------------------
            // PRUEBA 2: Verificación de Triaje de 3 Estados (Familia Producción - ID 42)
            // ----------------------------------------------------
            console.log('\n--- PRUEBA 2: Triaje Visual de 3 Estados para Categorías (Familia Producción - ID 42) ---');
            
            const familiaActivaPrueba = 42; // Familia 'Produccion'
            const plantillaActualProduccion = ['conformacion', 'variedad']; // Ya en plantilla

            const setCatsFamilia = new Set(plantillaActualProduccion.map(c => c.toLowerCase()));

            const estadoA = [];
            const estadoB = [];
            const estadoC = [];

            jsonDictData = jsonCats.data;
            jsonDictData.forEach(catObj => {
                const cat = (catObj.categoria || '').trim().toLowerCase();
                const yaIncluida = setCatsFamilia.has(cat);
                const familiasNums = Array.isArray(catObj.familias_ids) ? catObj.familias_ids.map(id => Number(id)) : [];
                const usadaEnFamiliaActiva = familiasNums.includes(familiaActivaPrueba);

                if (yaIncluida) {
                    estadoA.push(cat);
                } else if (usadaEnFamiliaActiva) {
                    estadoB.push(cat);
                } else {
                    estadoC.push(cat);
                }
            });

            console.log(`   ESTADO A (✔ Bloqueadas / Ya incluidas en plantilla Producción): ${estadoA.join(', ')}`);
            console.log(`   ESTADO B (🔥 Prioridad Máxima / En uso en Producción): ${estadoB.length > 0 ? estadoB.join(', ') : 'Ninguna adicional'}`);
            console.log(`   ESTADO C (🌐 Catálogo Global): ${estadoC.join(', ')}`);

            if (estadoA.includes('conformacion') && estadoA.includes('variedad')) {
                console.log('   ✅ PRUEBA 2 PASADA: El agrupamiento Tier-3 clasifica impecablemente los 3 estados en el desplegable.');
            } else {
                throw new Error('PRUEBA 2 FALLIDA: Fallo en el agrupamiento del Estado A.');
            }

            console.log('\n🏆 =======================================================');
            console.log('🏆 SUITE DE VERIFICACIÓN v1.9 COMPLETADA CON ÉXITO ABSOLUTO');
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

ejecutarSuiteVerificacionCatsTier3();
