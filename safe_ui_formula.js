const fs = require('fs');

let file = fs.readFileSync('src/produccion/js/ingredientes.js', 'utf8');

// Replace branch 1 (Vista Usuario)
file = file.replace(
    /const mixButtons = ingrediente\.tipo_origen === 'Mix' && window\.mostrarModalFormula[\s\S]*?\: '';/,
    "const mixButtons = ingrediente.esMix || ingrediente.tipo_origen === 'Mix'\n                ? `<button class=\"btn-tarjeta primary\" onclick=\"if(window.gestionarComposicionMix) gestionarComposicionMix(${ingredienteIdReal})\">📋 Fórmula</button>`\n                : '';"
);

// Replace branch 2 (Vista Deposito)
file = file.replace(
    /<button class="btn-tarjeta primary" onclick="if\(window\.mostrarModalFormula\) mostrarModalFormula\(\${ingredienteIdReal}\)">📋 Fórmula<\/button>/,
    "                    ${(ingrediente.esMix || ingrediente.tipo_origen === 'Mix') ? `<button class=\"btn-tarjeta primary\" onclick=\"if(window.gestionarComposicionMix) gestionarComposicionMix(${ingredienteIdReal})\">📋 Fórmula</button>` : ''}"
);

// Second occurrence of branch 2 replacement (because I had a duplicate replacement target? no the second replace should catch it)

fs.writeFileSync('src/produccion/js/ingredientes.js', file, 'utf8');
console.log('Script safely executed.');
