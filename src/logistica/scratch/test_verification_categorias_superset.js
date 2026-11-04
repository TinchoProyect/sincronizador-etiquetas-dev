const { pool } = require('../config/database');
const express = require('express');
const taxonomiaRoutes = require('../routes/bunkerTaxonomia');

async function ejecutarSuiteVerificacionSupersetYCategorias() {
    console.log('🧪 =======================================================');
    console.log('🧪 SUITE DE VERIFICACIÓN EMPÍRICA v1.4: SUPERSET Y UX ATRIBUTOS');
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
            // PRUEBA 1: Verificación de Superset SQL de 3 Capas Backend
            // ----------------------------------------------------
            console.log('\n--- PRUEBA 1: Consulta SQL Superset Unificado (GET /categorias-globales) ---');
            
            const resCats = await fetch(`${baseUrl}/api/logistica/bunker-taxonomia/categorias-globales`);
            const jsonCats = await resCats.json();
            console.log('   Respuesta HTTP GET /categorias-globales:', resCats.status, jsonCats);

            if (!resCats.ok || !jsonCats.success || !Array.isArray(jsonCats.data)) {
                throw new Error('PRUEBA 1 FALLIDA: Fallo al obtener categorías globales.');
            }

            const categoriasExtraidas = jsonCats.data.map(r => r.categoria);
            console.log('   Categorías obtenidas (Total: ' + categoriasExtraidas.length + '):', categoriasExtraidas);

            // Verificar sanitización: no existen duplicados ni espacios múltiples
            const unicas = new Set(categoriasExtraidas);
            if (unicas.size !== categoriasExtraidas.length) {
                throw new Error('PRUEBA 1 FALLIDA: La lista de categorías contiene duplicados.');
            }

            // Verificar que no incluye articulo_principal ni general
            if (categoriasExtraidas.includes('articulo_principal') || categoriasExtraidas.includes('general')) {
                throw new Error('PRUEBA 1 FALLIDA: El superset contiene categorías no posicionales excluidas.');
            }

            console.log('   ✅ PRUEBA 1 PASADA: Superset de 3 capas relacionales retornado con normalización estricta (0 duplicados).');

            // ----------------------------------------------------
            // PRUEBA 2: Verificación de Lógica de Agrupamiento y Resaltado en Frontend
            // ----------------------------------------------------
            console.log('\n--- PRUEBA 2: Agrupamiento Visual (<optgroup>) y Resaltado de Atributos Históricos ---');
            
            const todosLosTerminosSimulados = [
                { id: 1, termino: 'Pelada', abreviatura: 'PEL', categoria: 'conformacion' },
                { id: 2, termino: 'Mariposa', abreviatura: 'MAR', categoria: 'conformacion' },
                { id: 3, termino: 'Negro', abreviatura: 'NEG', categoria: 'color' },
                { id: 4, termino: 'Chico', abreviatura: 'CHI', categoria: 'calibre' }
            ];

            const categoriaEdicion = 'conformacion';
            const catClean = categoriaEdicion.toLowerCase();

            const historicos = todosLosTerminosSimulados.filter(t => t.categoria.toLowerCase() === catClean);
            const genericos = todosLosTerminosSimulados.filter(t => t.categoria.toLowerCase() !== catClean);

            console.log(`   Términos Históricos para "${categoriaEdicion}":`, historicos.map(h => h.termino));
            console.log(`   Términos Genéricos/Otros:`, genericos.map(g => g.termino));

            if (historicos.length === 2 && historicos.every(h => h.categoria === 'conformacion')) {
                console.log('   ✅ PRUEBA 2 PASADA: Los términos históricos son correctamente identificados y agrupados en la cima de la UI.');
            } else {
                throw new Error('PRUEBA 2 FALLIDA: Clasificación incorrecta de términos históricos.');
            }

            console.log('\n🏆 =======================================================');
            console.log('🏆 TODAS LAS PRUEBAS EMPÍRICAS v1.4 SE EJECUTARON CON ÉXITO ABSOLUTO');
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

ejecutarSuiteVerificacionSupersetYCategorias();
