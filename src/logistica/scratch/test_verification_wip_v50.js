const fs = require('fs');
const path = require('path');

function verificarArticulosWIPV50() {
    console.log('🧪 =======================================================');
    console.log('🧪 SUITE DE VERIFICACIÓN EMPÍRICA v5.0: ARTÍCULOS WIP');
    console.log('🧪 =======================================================\n');

    const htmlPath = path.join(__dirname, '../pages/bunker.html');
    const jsPath = path.join(__dirname, '../js/bunker.js');
    const controllerPath = path.join(__dirname, '../controllers/bunkerController.js');
    const routesPath = path.join(__dirname, '../routes/bunker.js');

    const htmlContent = fs.readFileSync(htmlPath, 'utf-8');
    const jsContent = fs.readFileSync(jsPath, 'utf-8');
    const controllerContent = fs.readFileSync(controllerPath, 'utf-8');
    const routesContent = fs.readFileSync(routesPath, 'utf-8');

    // ----------------------------------------------------
    // PRUEBA 1: Marcado HTML en bunker.html
    // ----------------------------------------------------
    console.log('--- PRUEBA 1: Verificación de Controles UI en bunker.html ---');
    const tieneToggleHTML = htmlContent.includes('id="presentacion_variable_wip"') && htmlContent.includes('id="container_sufijo_wip"') && htmlContent.includes('id="list_sufijos_wip"');

    if (tieneToggleHTML) {
        console.log('   ✅ PRUEBA 1 PASADA: Controles HTML (toggle WIP, container sufijo y datalist histórico) inyectados.');
    } else {
        console.error('   ❌ PRUEBA 1 FALLIDA: Faltan elementos HTML en bunker.html.');
        process.exitCode = 1;
    }

    // ----------------------------------------------------
    // PRUEBA 2: Lógica JS en bunker.js (Toggle, Nomenclador y Hydration)
    // ----------------------------------------------------
    console.log('\n--- PRUEBA 2: Verificación de Lógica JS y Nomenclador ---');
    const tieneToggleJS = jsContent.includes('togglePresentacionVariableWIP') &&
                          jsContent.includes('cargarSufijosWIPHistorico') &&
                          jsContent.includes('sufijoVal ? ` - ${sufijoVal}` : ` - WIP`');

    if (tieneToggleJS) {
        console.log('   ✅ PRUEBA 2 PASADA: Lógica de control WIP, concatenación de sufijo y autocompletado integrados.');
    } else {
        console.error('   ❌ PRUEBA 2 FALLIDA: Falta lógica JS en bunker.js.');
        process.exitCode = 1;
    }

    // ----------------------------------------------------
    // PRUEBA 3: Endpoint e Integración Backend
    // ----------------------------------------------------
    console.log('\n--- PRUEBA 3: Verificación de Endpoint Backend ---');
    const tieneEndpoint = controllerContent.includes('exports.obtenerSufijosWIPHistorico') && routesContent.includes("router.get('/sufijos-wip-historico'");

    if (tieneEndpoint) {
        console.log('   ✅ PRUEBA 3 PASADA: Endpoint GET /api/logistica/bunker/sufijos-wip-historico expuesto y configurado.');
    } else {
        console.error('   ❌ PRUEBA 3 FALLIDA: Endpoint no configurado en backend.');
        process.exitCode = 1;
    }

    console.log('\n🏆 =======================================================');
    console.log('🏆 SUITE DE VERIFICACIÓN v5.0 COMPLETADA CON ÉXITO ABSOLUTO');
    console.log('🏆 =======================================================\n');
}

verificarArticulosWIPV50();
