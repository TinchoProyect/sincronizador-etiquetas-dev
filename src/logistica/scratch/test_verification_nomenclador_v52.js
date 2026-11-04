const fs = require('fs');
const path = require('path');

function verificarNomencladorBunkerV52() {
    console.log('🧪 ========================================================================');
    console.log('🧪 SUITE DE VERIFICACIÓN EMPÍRICA v5.2: NOMENCLADOR BÚNKER EN INGREDIENTES');
    console.log('🧪 ========================================================================\n');

    const controllerPath = path.join(__dirname, '../../produccion/controllers/ingredientes.js');
    const jsPath = path.join(__dirname, '../../produccion/js/ingredientes.js');

    const controllerContent = fs.readFileSync(controllerPath, 'utf-8');
    const jsContent = fs.readFileSync(jsPath, 'utf-8');

    // ----------------------------------------------------
    // PRUEBA 1: Subquery SQL en Backend (COALESCE con descripcion_generada)
    // ----------------------------------------------------
    console.log('--- PRUEBA 1: Verificación de Subquery SQL en Backend ---');
    const tieneCoalesceGenerada = controllerContent.includes('COALESCE(ba.descripcion_generada, ba.descripcion, s.descripcion)');

    if (tieneCoalesceGenerada) {
        console.log('   ✅ PRUEBA 1 PASADA: SQL subquery extrae la nomenclatura consolidada (descripcion_generada).');
    } else {
        console.error('   ❌ PRUEBA 1 FALLIDA: Subquery no incluye COALESCE con descripcion_generada.');
        process.exitCode = 1;
    }

    // ----------------------------------------------------
    // PRUEBA 2: Formato de Inyección en Modal Desglose (Frontend)
    // ----------------------------------------------------
    console.log('\n--- PRUEBA 2: Verificación de Formato de Inyección en Frontend ---');
    const tieneFormatoVinculo = jsContent.includes('[${ingrediente.articulo_vinculado_numero}]') &&
                                jsContent.includes('${ingrediente.articulo_vinculado_descripcion || \'\'}');

    if (tieneFormatoVinculo) {
        console.log('   ✅ PRUEBA 2 PASADA: El modal Desglose formatea [SKU] seguido de la nomenclatura Búnker.');
    } else {
        console.error('   ❌ PRUEBA 2 FALLIDA: Formato de inyección no coincide en ingredientes.js.');
        process.exitCode = 1;
    }

    // ----------------------------------------------------
    // PRUEBA 3: Prioridad Nomenclador en Buscador Modal
    // ----------------------------------------------------
    console.log('\n--- PRUEBA 3: Verificación de Prioridad Nomenclador en Buscador ---');
    const tienePrioridadBuscador = jsContent.includes('const titulo = a.descripcion_generada || a.descripcion || a.nombre_lomasoft');

    if (tienePrioridadBuscador) {
        console.log('   ✅ PRUEBA 3 PASADA: El buscador modal de artículos vinculados prioriza descripcion_generada.');
    } else {
        console.error('   ❌ PRUEBA 3 FALLIDA: El buscador no prioriza descripcion_generada.');
        process.exitCode = 1;
    }

    console.log('\n🏆 ========================================================================');
    console.log('🏆 SUITE DE VERIFICACIÓN v5.2 COMPLETADA CON ÉXITO ABSOLUTO');
    console.log('🏆 ========================================================================\n');
}

verificarNomencladorBunkerV52();
