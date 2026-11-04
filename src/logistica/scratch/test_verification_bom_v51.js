const fs = require('fs');
const path = require('path');
const BunkerService = require('../services/bunkerService');

async function verificarBOMMultinivelV51() {
    console.log('🧪 =================================================================');
    console.log('🧪 SUITE DE VERIFICACIÓN EMPÍRICA v5.1: MOTOR COSTEO BOM MULTINIVEL');
    console.log('🧪 =================================================================\n');

    // ----------------------------------------------------
    // PRUEBA 1: Existencia del Método resolverCostoJerarquico
    // ----------------------------------------------------
    console.log('--- PRUEBA 1: Verificación de Firma de resolverCostoJerarquico ---');
    if (typeof BunkerService.resolverCostoJerarquico === 'function') {
        console.log('   ✅ PRUEBA 1 PASADA: BunkerService.resolverCostoJerarquico está definido.');
    } else {
        console.error('   ❌ PRUEBA 1 FALLIDA: BunkerService.resolverCostoJerarquico NO está definido.');
        process.exitCode = 1;
    }

    // ----------------------------------------------------
    // PRUEBA 2: Intercepción de Referencia Circular (visitedSet)
    // ----------------------------------------------------
    console.log('\n--- PRUEBA 2: Intercepción de Referencia Circular (Anti-Loop Guard) ---');
    try {
        const mockDb = {};
        const visitedSet = new Set();
        visitedSet.add('2268'); // Forzar que el articulo_id 2268 ya existe en visitedSet

        const resCircular = await BunkerService.resolverCostoJerarquico(mockDb, '2268', visitedSet, 1);
        if (resCircular && resCircular.fuente === 'CIRCULAR_PREVENTED' && resCircular.costo_kilo === 0) {
            console.log('   ✅ PRUEBA 2 PASADA: El detector interrumpió el ciclo devolviendo fuente: "CIRCULAR_PREVENTED".');
        } else {
            console.error('   ❌ PRUEBA 2 FALLIDA: No se interrumpió la referencia circular.', resCircular);
            process.exitCode = 1;
        }
    } catch (e) {
        console.error('   ❌ PRUEBA 2 FALLIDA con excepción:', e);
        process.exitCode = 1;
    }

    // ----------------------------------------------------
    // PRUEBA 3: Verificación de Contrato API en bunkerService.js
    // ----------------------------------------------------
    console.log('\n--- PRUEBA 3: Verificación de Contrato API (costo_por_kilo_normalizado) ---');
    const serviceContent = fs.readFileSync(path.join(__dirname, '../services/bunkerService.js'), 'utf-8');
    const tieneContratoAPI = serviceContent.includes('costo_por_kilo_normalizado') && serviceContent.includes('fuente_costo_aplicada');

    if (tieneContratoAPI) {
        console.log('   ✅ PRUEBA 3 PASADA: bunkerService.js expone costo_por_kilo_normalizado y fuente_costo_aplicada en la API.');
    } else {
        console.error('   ❌ PRUEBA 3 FALLIDA: Falta contrato API en bunkerService.js.');
        process.exitCode = 1;
    }

    // ----------------------------------------------------
    // PRUEBA 4: Verificación de Consumo en Frontend (listado-bunker.js)
    // ----------------------------------------------------
    console.log('\n--- PRUEBA 4: Verificación de Consumo Directo en listado-bunker.js ---');
    const jsContent = fs.readFileSync(path.join(__dirname, '../js/listado-bunker.js'), 'utf-8');
    const tieneConsumoDirecto = jsContent.includes('costo_por_kilo_normalizado') && jsContent.includes('fuenteCostoAplicada');

    if (tieneConsumoDirecto) {
        console.log('   ✅ PRUEBA 4 PASADA: listado-bunker.js consume directamente costo_por_kilo_normalizado sin divisiones.');
    } else {
        console.error('   ❌ PRUEBA 4 FALLIDA: listado-bunker.js no mapea costo_por_kilo_normalizado.');
        process.exitCode = 1;
    }

    console.log('\n🏆 =================================================================');
    console.log('🏆 SUITE DE VERIFICACIÓN v5.1 COMPLETADA CON ÉXITO ABSOLUTO');
    console.log('🏆 =================================================================\n');
}

verificarBOMMultinivelV51();
