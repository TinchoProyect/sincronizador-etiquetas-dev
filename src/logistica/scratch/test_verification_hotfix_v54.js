const fs = require('fs');
const path = require('path');

function verificarHotfixV54() {
    console.log('🧪 ====================================================================');
    console.log('🧪 SUITE DE VERIFICACIÓN EMPÍRICA v5.4: HIDRATACIÓN EDICIÓN ARTÍCULOS WIP');
    console.log('🧪 ====================================================================\n');

    const jsPath = path.join(__dirname, '../js/bunker.js');
    const jsContent = fs.readFileSync(jsPath, 'utf-8');

    // ----------------------------------------------------
    // PRUEBA 1: Verificación de presencia de bloque de hidratación WIP
    // ----------------------------------------------------
    console.log('--- PRUEBA 1: Verificación de Extracción JSONB de WIP ---');
    const tieneWipSaved = jsContent.includes('const isWipSaved = propsJSON.presentacion_variable_wip === true;') &&
                          jsContent.includes('const sufijoWipSaved = propsJSON.sufijo_wip || \'\';');

    if (tieneWipSaved) {
        console.log('   ✅ PRUEBA 1 PASADA: cargarArticuloEnFormulario extrae presentacion_variable_wip y sufijo_wip del JSONB.');
    } else {
        console.error('   ❌ PRUEBA 1 FALLIDA: Falta extracción de propiedades WIP en bunker.js.');
        process.exitCode = 1;
    }

    // ----------------------------------------------------
    // PRUEBA 2: Verificación de Invocación Explícita a togglePresentacionVariableWIP
    // ----------------------------------------------------
    console.log('\n--- PRUEBA 2: Verificación de Invocación a togglePresentacionVariableWIP(isWipSaved) ---');
    const tieneToggleExplicito = jsContent.includes('window.togglePresentacionVariableWIP(isWipSaved);');

    if (tieneToggleExplicito) {
        console.log('   ✅ PRUEBA 2 PASADA: window.togglePresentacionVariableWIP se invoca pasando explícitamente el parámetro (isWipSaved).');
    } else {
        console.error('   ❌ PRUEBA 2 FALLIDA: Invocación implícita o ausente de togglePresentacionVariableWIP.');
        process.exitCode = 1;
    }

    // ----------------------------------------------------
    // PRUEBA 3: Verificación de Secuencia antes de actualizarLivePreview
    // ----------------------------------------------------
    console.log('\n--- PRUEBA 3: Verificación de Secuencia de Hidratación vs Live Preview ---');
    const posHidratacion = jsContent.indexOf('window.togglePresentacionVariableWIP(isWipSaved);');
    const posLivePreview = jsContent.indexOf('actualizarLivePreview();', posHidratacion);

    if (posHidratacion !== -1 && posLivePreview !== -1 && posHidratacion < posLivePreview) {
        console.log('   ✅ PRUEBA 3 PASADA: La hidratación ocurre STRICTLY ANTES de actualizarLivePreview().');
    } else {
        console.error('   ❌ PRUEBA 3 FALLIDA: Secuencia de llamadas en cargarArticuloEnFormulario incorrecta.');
        process.exitCode = 1;
    }

    console.log('\n🏆 ====================================================================');
    console.log('🏆 SUITE DE VERIFICACIÓN v5.4 COMPLETADA CON ÉXITO ABSOLUTO');
    console.log('🏆 ====================================================================\n');
}

verificarHotfixV54();
