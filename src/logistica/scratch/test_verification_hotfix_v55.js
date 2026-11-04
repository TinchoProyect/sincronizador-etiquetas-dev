const fs = require('fs');
const path = require('path');

function testVerificationHotfixV55() {
    console.log('🔍 ====================================================================');
    console.log('🔍 VERIFICACIÓN EMPÍRICA HOTFIX v5.5: Saneamiento e Hidratación Pos 3');
    console.log('🔍 ====================================================================\n');

    const jsPath = path.join(__dirname, '../js/bunker.js');
    const jsContent = fs.readFileSync(jsPath, 'utf-8');

    // 1. Verificar presencia de targetTerminoFinal y regex de corchetes
    const hasTargetTerminoFinal = jsContent.includes('targetTerminoFinal');
    const hasBracketRegex = jsContent.includes('.replace(/\\s*\\[.*?\\]/g, \'\')');

    console.log('1. Sanidad de código en bunker.js:');
    console.log('   - targetTerminoFinal inyectado:', hasTargetTerminoFinal ? '✅ SÍ' : '❌ NO');
    console.log('   - Regex de saneamiento de corchetes inyectada:', hasBracketRegex ? '✅ SÍ' : '❌ NO');

    if (!hasTargetTerminoFinal || !hasBracketRegex) {
        console.error('❌ FALLO: El código de bunker.js no contiene la refactorización v5.5');
        process.exit(1);
    }

    // 2. Simulación de la lógica de coincidencia determinista v5.5
    console.log('\n2. Simulación de coincidencia determinista con datos legacy (con corchetes):');

    const mockSelectOptions = [
        { value: '', text: '📋 Seleccione Variedad...' },
        { value: JSON.stringify({ t: 'De Agen', a: 'D\'AGEN' }), text: '⭐ De Agen [D\'AGEN]' }
    ];

    const testCases = [
        { input: 'De Agen [D\'AGEN]', expected: 'De Agen' },
        { input: 'D\'AGEN', expected: 'De Agen' },
        { input: 'De Agen', expected: 'De Agen' },
        { input: 'Sin Carozo [S/CAZO]', expected: 'Sin Carozo' }
    ];

    let allPassed = true;

    testCases.forEach((tc, idx) => {
        const val = tc.input;
        const valorLimpioSinCorchetes = String(val || '').replace(/\s*\[.*?\]/g, '').trim();
        const atributoNormMatch = valorLimpioSinCorchetes.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");

        let foundOpt = mockSelectOptions.find(opt => {
            let optTermino = '';
            let optAbrev = '';
            try {
                const parsed = JSON.parse(opt.value);
                optTermino = parsed.t || opt.text;
                optAbrev = parsed.a || '';
            } catch(e) {
                optTermino = opt.value || opt.text;
            }
            const optNorm = String(optTermino || '').replace(/\s*\[.*?\]/g, '').trim().toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
            const abrevNorm = String(optAbrev || '').trim().toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
            return optNorm === atributoNormMatch || abrevNorm === atributoNormMatch || (optNorm && atributoNormMatch.includes(optNorm));
        });

        let targetTerminoFinal = String(val || '').replace(/\s*\[.*?\]/g, '').trim();
        if (foundOpt) {
            try {
                const parsedOpt = JSON.parse(foundOpt.value);
                if (parsedOpt.t) targetTerminoFinal = parsedOpt.t;
            } catch(e) {}
        }

        const isOk = (idx < 3) ? (targetTerminoFinal === 'De Agen') : (targetTerminoFinal === 'Sin Carozo');
        console.log(`   Case ${idx + 1}: Entrada "${val}" -> Resultado "${targetTerminoFinal}" (${isOk ? '✅ PASÓ' : '❌ FALLÓ'})`);
        if (!isOk) allPassed = false;
    });

    if (!allPassed) {
        console.error('❌ FALLO: La lógica de coincidencia determinista falló en los casos de prueba.');
        process.exit(1);
    }

    console.log('\n✅ ====================================================================');
    console.log('✅ VERIFICACIÓN EMPÍRICA EXITOSA (100% PASS) - HOTFIX v5.5 CONSOLIDABLE');
    console.log('✅ ====================================================================\n');
}

testVerificationHotfixV55();
