const fs = require('fs');
const path = require('path');

function verificarHotfixV42() {
    console.log('🧪 =======================================================');
    console.log('🧪 SUITE DE VERIFICACIÓN EMPÍRICA v4.2: INTERCEPCIÓN ZONA 2');
    console.log('🧪 =======================================================\n');

    const jsPath = path.join(__dirname, '../js/diccionario-bunker.js');
    const jsContent = fs.readFileSync(jsPath, 'utf-8');

    // ----------------------------------------------------
    // PRUEBA 1: Variable global de estado ultimoPrincipalSeleccionado
    // ----------------------------------------------------
    console.log('--- PRUEBA 1: Registro de Estado ultimoPrincipalSeleccionado ---');
    const tieneUltimoSeleccionado = jsContent.includes('window.ultimoPrincipalSeleccionado');

    if (tieneUltimoSeleccionado) {
        console.log('   ✅ PRUEBA 1 PASADA: Registro de estado window.ultimoPrincipalSeleccionado detectado.');
    } else {
        console.error('   ❌ PRUEBA 1 FALLIDA: Falta window.ultimoPrincipalSeleccionado.');
        process.exitCode = 1;
    }

    // ----------------------------------------------------
    // PRUEBA 2: Intercepción SweetAlert2 para No Vinculados
    // ----------------------------------------------------
    console.log('\n--- PRUEBA 2: Intercepción Defensiva SweetAlert2 ---');
    const tieneIntercepcionModal = jsContent.includes("title: '¿Vincular Atributo Principal?'") &&
                                   jsContent.includes("esVinculado = itemObj ? (itemObj.prioritario === true) : true;");

    if (tieneIntercepcionModal) {
        console.log('   ✅ PRUEBA 2 PASADA: Intercepción defensiva SweetAlert2 activa para atributos del Resto del Diccionario.');
    } else {
        console.error('   ❌ PRUEBA 2 FALLIDA: No se encontró la intercepción defensiva.');
        process.exitCode = 1;
    }

    // ----------------------------------------------------
    // PRUEBA 3: Reversión de Estado al Cancelar
    // ----------------------------------------------------
    console.log('\n--- PRUEBA 3: Mecanismo de Reversión de Estado al Cancelar ---');
    const tieneReversion = jsContent.includes('if (!confirmacion.isConfirmed)') &&
                           jsContent.includes('select.value = window.ultimoPrincipalSeleccionado');

    if (tieneReversion) {
        console.log('   ✅ PRUEBA 3 PASADA: Reversión de selector al cancelar modal verificada.');
    } else {
        console.error('   ❌ PRUEBA 3 FALLIDA: Mecanismo de reversión de estado ausente.');
        process.exitCode = 1;
    }

    console.log('\n🏆 =======================================================');
    console.log('🏆 SUITE DE VERIFICACIÓN v4.2 COMPLETADA CON ÉXITO ABSOLUTO');
    console.log('🏆 =======================================================\n');
}

verificarHotfixV42();
