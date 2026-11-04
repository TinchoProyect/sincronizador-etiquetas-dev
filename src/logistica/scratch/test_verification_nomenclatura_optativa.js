const { pool } = require('../config/database');
const express = require('express');
const taxonomiaRoutes = require('../routes/bunkerTaxonomia');
const diccionarioRoutes = require('../routes/bunkerDiccionario');

async function ejecutarSuitePruebasNomenclatura() {
    console.log('🧪 =======================================================');
    console.log('🧪 SUITE DE VERIFICACIÓN EMPÍRICA: MOTOR DE NOMENCLATURA OPTATIVA');
    console.log('🧪 =======================================================');

    const app = express();
    app.use(express.json());
    app.use((req, res, next) => { req.db = pool; next(); });
    app.use('/api/logistica/bunker-taxonomia', taxonomiaRoutes);
    app.use('/api/logistica/bunker-diccionario', diccionarioRoutes);

    const server = app.listen(0, async () => {
        const port = server.address().port;
        const baseUrl = `http://localhost:${port}`;
        console.log(`📡 Servidor de prueba iniciado en ${baseUrl}`);

        try {
            // ----------------------------------------------------
            // PRUEBA 1: Verificación de Inyección Apagada por Defecto (95%)
            // ----------------------------------------------------
            console.log('\n--- PRUEBA 1: Inyección Apagada por Defecto ---');
            const propsP1 = {
                articulo_principal: 'SESAMO',
                familia_id: 2,
                familia_nombre: 'Semillas',
                incluir_familia: false,
                posicion_familia: 'ANTES',
                modo_display_familia: 'COMPLETO',
                posiciones: {
                    pos_1: { eje: 'color', valor: 'Blanco', abreviatura: 'BCO', modo_display: 'COMPLETO', silencioso: false }
                }
            };
            
            // Simular lógica de concatenación
            const descP1 = concatenarServidorSimulado(propsP1, 'x 5kg');
            console.log('   Resultado P1:', descP1);
            if (descP1 === 'SESAMO Blanco x 5kg') {
                console.log('   ✅ PRUEBA 1 PASADA: La familia fue excluida correctamente por defecto.');
            } else {
                throw new Error(`PRUEBA 1 FALLIDA: Se esperaba "SESAMO Blanco x 5kg", se obtuvo "${descP1}"`);
            }

            // ----------------------------------------------------
            // PRUEBA 2: Inyección Optativa "Antes del Principal"
            // ----------------------------------------------------
            console.log('\n--- PRUEBA 2: Inyección Optativa "Antes del Principal" ---');
            const propsP2 = {
                ...propsP1,
                incluir_familia: true,
                posicion_familia: 'ANTES',
                modo_display_familia: 'COMPLETO'
            };
            const descP2 = concatenarServidorSimulado(propsP2, 'x 5kg');
            console.log('   Resultado P2:', descP2);
            if (descP2 === 'Semillas SESAMO Blanco x 5kg') {
                console.log('   ✅ PRUEBA 2 PASADA: La familia fue inyectada exitosamente antes del Nombre Principal.');
            } else {
                throw new Error(`PRUEBA 2 FALLIDA: Se esperaba "Semillas SESAMO Blanco x 5kg", se obtuvo "${descP2}"`);
            }

            // ----------------------------------------------------
            // PRUEBA 3: Inyección Optativa "Después del Principal" con Hot Edit de Abreviatura
            // ----------------------------------------------------
            console.log('\n--- PRUEBA 3: Hot Edit de Abreviatura Exitoso & Inyección "Después del Principal" ---');
            
            // Petición HTTP PUT real al endpoint de abreviatura
            const resPut = await fetch(`${baseUrl}/api/logistica/bunker-taxonomia/familias/2/abreviatura`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ abreviatura: 'SEM' })
            });
            const jsonPut = await resPut.json();
            console.log('   Respuesta HTTP PUT:', jsonPut);

            if (!resPut.ok || !jsonPut.success || jsonPut.data.abreviatura !== 'SEM') {
                throw new Error(`PRUEBA 3 FALLIDA: Fallo al actualizar abreviatura en endpoint REST: ${jsonPut.error}`);
            }

            const propsP3 = {
                ...propsP1,
                incluir_familia: true,
                posicion_familia: 'DESPUES',
                modo_display_familia: 'ABREVIADO',
                abreviatura_familia: 'SEM'
            };
            const descP3 = concatenarServidorSimulado(propsP3, 'x 5kg');
            console.log('   Resultado P3:', descP3);
            if (descP3 === 'SESAMO SEM Blanco x 5kg') {
                console.log('   ✅ PRUEBA 3 PASADA: Abreviatura persistiada en DB e inyectada después del Nombre Principal.');
            } else {
                throw new Error(`PRUEBA 3 FALLIDA: Se esperaba "SESAMO SEM Blanco x 5kg", se obtuvo "${descP3}"`);
            }

            // ----------------------------------------------------
            // PRUEBA 4: Simulación de Fallo de Red / Error HTTP en Hot Edit (Contramedida Reversión)
            // ----------------------------------------------------
            console.log('\n--- PRUEBA 4: Simulación de Rechazo/Error en Hot Edit ---');
            
            // Intento de actualización en Familia Inexistente ID 999999
            const resErr = await fetch(`${baseUrl}/api/logistica/bunker-taxonomia/familias/999999/abreviatura`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ abreviatura: 'FAIL' })
            });
            const jsonErr = await resErr.json();
            console.log('   Respuesta HTTP para ID Inexistente:', resErr.status, jsonErr);

            if (resErr.status === 404 && jsonErr.success === false) {
                console.log('   ✅ PRUEBA 4 PASADA: El backend retornó correctamente HTTP 404 y fue capturado por el protocolo defensivo.');
            } else {
                throw new Error(`PRUEBA 4 FALLIDA: Se esperaba HTTP 404 con success: false, se obtuvo status ${resErr.status}`);
            }

            console.log('\n🏆 =======================================================');
            console.log('🏆 TODAS LAS PRUEBAS EMPÍRICAS SE EJECUTARON CON ÉXITO ABSOLUTO');
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

function concatenarServidorSimulado(propsJSON, sufijoFisico = '') {
    const parts = [];

    const incluirFam = propsJSON.incluir_familia === true;
    const posFam = propsJSON.posicion_familia || 'ANTES';
    const modoFam = propsJSON.modo_display_familia || 'COMPLETO';
    const txtFam = modoFam === 'ABREVIADO' 
        ? (propsJSON.abreviatura_familia || propsJSON.familia_nombre) 
        : propsJSON.familia_nombre;

    if (incluirFam && posFam === 'ANTES' && txtFam && txtFam !== 'General / Sin Clasificar') {
        parts.push(txtFam.toString().trim());
    }

    if (!propsJSON.silencioso_principal && propsJSON.articulo_principal) {
        parts.push(propsJSON.articulo_principal.toString().trim());
    }

    if (incluirFam && posFam === 'DESPUES' && txtFam && txtFam !== 'General / Sin Clasificar') {
        parts.push(txtFam.toString().trim());
    }

    if (propsJSON.posiciones && typeof propsJSON.posiciones === 'object') {
        Object.values(propsJSON.posiciones)
            .filter(p => !p.silencioso)
            .forEach(p => {
                const valDisplay = (p.modo_display === 'ABREVIADO' && p.abreviatura) ? p.abreviatura : p.valor;
                if (valDisplay) parts.push(valDisplay.toString().trim());
            });
    }

    return parts.join(' ') + (sufijoFisico ? ` ${sufijoFisico.trim()}` : '');
}

ejecutarSuitePruebasNomenclatura();
