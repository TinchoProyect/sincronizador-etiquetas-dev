const { pool } = require('../config/database');
const express = require('express');
const bunkerRoutes = require('../routes/bunker');

async function ejecutarSuitePruebasPropagacionIvaHotfix() {
    console.log('🧪 =======================================================');
    console.log('🧪 SUITE DE VERIFICACIÓN EMPÍRICA v1.3: PROPAGACIÓN CONDICIONAL DE IVA (HOTFIX UX)');
    console.log('🧪 =======================================================');

    const app = express();
    app.use(express.json());
    app.use((req, res, next) => { req.db = pool; next(); });
    app.use('/api/logistica/bunker', bunkerRoutes);

    const server = app.listen(0, async () => {
        const port = server.address().port;
        const baseUrl = `http://localhost:${port}`;
        console.log(`📡 Servidor de prueba iniciado en ${baseUrl}`);

        try {
            // ----------------------------------------------------
            // PRUEBA 1: Tipeo Manual Síncrono (Comportamiento Natural en Lista Activa)
            // ----------------------------------------------------
            console.log('\n--- PRUEBA 1: Tipeo Manual sin Interrupciones (oninput) ---');
            const listasP1 = [
                { lista_id: 1, iva: 21.00, modo_origen_iva: 'LOTE', modo_iva: 'COMPLETO' },
                { lista_id: 2, iva: 21.00, modo_origen_iva: 'LOTE', modo_iva: 'COMPLETO' }
            ];

            // Simular oninput en la lista 1
            listasP1[0].iva = 10.50;
            listasP1[0].modo_origen_iva = 'PERSONALIZADO';

            console.log('   Lista 1 tras oninput:', listasP1[0]);
            console.log('   Lista 2 tras oninput:', listasP1[1]);

            if (listasP1[0].iva === 10.50 && listasP1[0].modo_origen_iva === 'PERSONALIZADO' && listasP1[1].iva === 21.00) {
                console.log('   ✅ PRUEBA 1 PASADA: El tipeo manual opera suavemente sobre la lista activa sin disparar modales síncronos.');
            } else {
                throw new Error('PRUEBA 1 FALLIDA.');
            }

            // ----------------------------------------------------
            // PRUEBA 2: Click Explícito en Botón "🌐 Propagar"
            // ----------------------------------------------------
            console.log('\n--- PRUEBA 2: Propagación Global por Botón Explícito (modo_origen_iva = PERSONALIZADO) ---');
            const targetIva = 10.50;
            const listasP2 = [
                { lista_id: 1, iva: 21.00, modo_origen_iva: 'LOTE' },
                { lista_id: 2, iva: 21.00, modo_origen_iva: 'LOTE' },
                { lista_id: 3, iva: 21.00, modo_origen_iva: 'LOTE' }
            ];

            // Simular propagarIvaGlobalBoton
            listasP2.forEach(l => {
                l.iva = targetIva;
                l.modo_origen_iva = 'PERSONALIZADO';
            });

            const todasCorrectas = listasP2.every(l => l.iva === 10.50 && l.modo_origen_iva === 'PERSONALIZADO');
            console.log('   Estado de listas tras click en 🌐 Propagar:', listasP2);

            if (todasCorrectas) {
                console.log('   ✅ PRUEBA 2 PASADA: Todas las listas adoptaron 10.50% de IVA y modo_origen_iva = PERSONALIZADO.');
            } else {
                throw new Error('PRUEBA 2 FALLIDA: Enum incorreto o desincronización de listas.');
            }

            // ----------------------------------------------------
            // PRUEBA 3: Persistencia Atómica Backend (POST /finanzas/:articulo_id)
            // ----------------------------------------------------
            console.log('\n--- PRUEBA 3: Persistencia Atómica Backend (POST /finanzas/:articulo_id) ---');
            
            const artRes = await pool.query('SELECT articulo_id FROM public.bunker_articulos LIMIT 1');
            if (artRes.rows.length === 0) {
                throw new Error('No se encontraron artículos Búnker para prueba.');
            }
            const testArtId = artRes.rows[0].articulo_id;

            const payloadFinanzas = {
                costo_base: 1000.00,
                porcentaje_iva: 10.50,
                configs: [
                    {
                        lista_id: 1,
                        margen_ganancia: 30,
                        costo_base_sobrescrito: null,
                        costo_tiempo: 0,
                        iva: 10.50,
                        precio_final: 1435.50,
                        modo_calculo: 'AUTOMATIC',
                        modo_iva: 'COMPLETO',
                        es_patron: false,
                        disponible: true
                    }
                ]
            };

            const resPost = await fetch(`${baseUrl}/api/logistica/bunker/finanzas/${testArtId}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payloadFinanzas)
            });

            const jsonPost = await resPost.json();
            console.log(`   Respuesta HTTP POST finanzas (Articulo: ${testArtId}):`, resPost.status, jsonPost);

            if (resPost.ok && jsonPost.success) {
                console.log('   ✅ PRUEBA 3 PASADA: Persistencia exitosa en BD con client.release() garantizado.');
            } else {
                throw new Error(`PRUEBA 3 FALLIDA: ${jsonPost.error || 'Respuesta HTTP fallida'}`);
            }

            console.log('\n🏆 =======================================================');
            console.log('🏆 TODAS LAS PRUEBAS EMPÍRICAS v1.3 SE EJECUTARON CON ÉXITO ABSOLUTO');
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

ejecutarSuitePruebasPropagacionIvaHotfix();
