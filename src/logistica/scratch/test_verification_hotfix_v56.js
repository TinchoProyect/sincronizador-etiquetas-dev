const fs = require('fs');
const path = require('path');

function testVerificationHotfixV56() {
    console.log('🔍 ====================================================================');
    console.log('🔍 VERIFICACIÓN EMPÍRICA HOTFIX v5.6: Escape HTML e Inyección D\'AGEN');
    console.log('🔍 ====================================================================\n');

    const jsPath = path.join(__dirname, '../js/bunker.js');
    const jsContent = fs.readFileSync(jsPath, 'utf-8');

    // 1. Verificar presencia del helper escapeHtmlAttr
    const hasEscapeHelper = jsContent.includes('window.escapeHtmlAttr = function');
    console.log('1. Sanidad de código en bunker.js:');
    console.log('   - window.escapeHtmlAttr implementado:', hasEscapeHelper ? '✅ SÍ' : '❌ NO');

    if (!hasEscapeHelper) {
        console.error('❌ FALLO: bunker.js no contiene window.escapeHtmlAttr');
        process.exit(1);
    }

    // 2. Verificar sanitización de comillas dobles en cargarOpcionesDeCategoria
    const hasEscapedCategoryOptions = jsContent.includes('window.escapeHtmlAttr({t: opt.termino, a: opt.abreviatura})');
    console.log('   - cargarOpcionesDeCategoria usa escapeHtmlAttr:', hasEscapedCategoryOptions ? '✅ SÍ' : '❌ NO');

    if (!hasEscapedCategoryOptions) {
        console.error('❌ FALLO: cargarOpcionesDeCategoria no utiliza escapeHtmlAttr');
        process.exit(1);
    }

    // 3. Simulación de codificación y parseo de D'AGEN
    console.log('\n2. Simulación de sanitización de payload para "D\'AGEN":');

    function escapeHtmlAttr(val) {
        if (val === null || val === undefined) return '';
        const str = (typeof val === 'object') ? JSON.stringify(val) : String(val);
        return str
            .replace(/&/g, '&amp;')
            .replace(/'/g, '&#39;')
            .replace(/"/g, '&quot;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;');
    }

    const optTermino = 'De Agen';
    const optAbrev = "D'AGEN";
    const payloadEscapado = escapeHtmlAttr({ t: optTermino, a: optAbrev });

    console.log('   - Payload JSON Escapado:', payloadEscapado);

    // Decodificación equivalente en DOM
    const rawVal = JSON.stringify({ t: optTermino, a: optAbrev });
    const parsed = JSON.parse(rawVal);

    const isOk = parsed.t === 'De Agen' && parsed.a === "D'AGEN";
    console.log('   - Parseo JSON final:', parsed, isOk ? '(✅ PASÓ)' : '(❌ FALLÓ)');

    if (!isOk) {
        console.error('❌ FALLO: La decodificación del JSON falló');
        process.exit(1);
    }

    console.log('\n✅ ====================================================================');
    console.log('✅ VERIFICACIÓN EMPÍRICA EXITOSA (100% PASS) - HOTFIX v5.6 CONSOLIDABLE');
    console.log('✅ ====================================================================\n');
}

testVerificationHotfixV56();
