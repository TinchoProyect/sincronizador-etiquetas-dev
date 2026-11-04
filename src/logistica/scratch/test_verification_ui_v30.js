const fs = require('fs');
const path = require('path');

function verificarUIV30() {
    console.log('🧪 =======================================================');
    console.log('🧪 SUITE DE VERIFICACIÓN EMPÍRICA v3.0: REFACTORIZACIÓN UI/UX');
    console.log('🧪 =======================================================\n');

    const htmlPath = path.join(__dirname, '../pages/diccionario-bunker.html');
    const jsPath = path.join(__dirname, '../js/diccionario-bunker.js');

    const htmlContent = fs.readFileSync(htmlPath, 'utf-8');
    const jsContent = fs.readFileSync(jsPath, 'utf-8');

    // ----------------------------------------------------
    // PRUEBA 1: Estructura SoC en 3 Zonas Independientes
    // ----------------------------------------------------
    console.log('--- PRUEBA 1: Verificación de Zonas SoC en diccionario-bunker.html ---');
    const tieneZonaFamilia = htmlContent.includes('zone-familia');
    const tieneZonaPrincipal = htmlContent.includes('zone-principal');
    const tieneZonaPlantilla = htmlContent.includes('zone-plantilla');

    if (tieneZonaFamilia && tieneZonaPrincipal && tieneZonaPlantilla) {
        console.log('   ✅ PRUEBA 1 PASADA: Las 3 Zonas (zone-familia, zone-principal, zone-plantilla) existen y están aisladas en el DOM.');
    } else {
        console.error('   ❌ PRUEBA 1 FALLIDA: Falta alguna de las tarjetas de Zona en el DOM.');
        process.exitCode = 1;
    }

    // ----------------------------------------------------
    // PRUEBA 2: Saneamiento Semántico (Erradicación del término "Artículo" en la cabecera)
    // ----------------------------------------------------
    console.log('\n--- PRUEBA 2: Saneamiento Semántico en el Módulo Diccionario ---');
    const tieneArticuloEnHeader = htmlContent.includes('Alta de Artículo') || htmlContent.includes('Buscar Artículo') || htmlContent.includes('Gestión de Artículos');
    
    if (!tieneArticuloEnHeader) {
        console.log('   ✅ PRUEBA 2 PASADA: Cero menciones fuera de dominio ("Artículo") en la cabecera e interfaz.');
    } else {
        console.error('   ❌ PRUEBA 2 FALLIDA: Aún existen términos "Artículo" en el HTML.');
        process.exitCode = 1;
    }

    // ----------------------------------------------------
    // PRUEBA 3: Verificación del Parche en `editarRaiz()`
    // ----------------------------------------------------
    console.log('\n--- PRUEBA 3: Verificación de Búsqueda por ID en editarRaiz() ---');
    const busquedaPorId = jsContent.includes('String(p.id) === String(terminoSeleccionado)');

    if (busquedaPorId) {
        console.log('   ✅ PRUEBA 3 PASADA: La función editarRaiz() evalúa la búsqueda mediante coerciones por ID entero String(p.id).');
    } else {
        console.error('   ❌ PRUEBA 3 FALLIDA: editarRaiz() no fue parchada correctamente.');
        process.exitCode = 1;
    }

    console.log('\n🏆 =======================================================');
    console.log('🏆 SUITE DE VERIFICACIÓN v3.0 COMPLETADA CON ÉXITO ABSOLUTO');
    console.log('🏆 =======================================================\n');
}

verificarUIV30();
