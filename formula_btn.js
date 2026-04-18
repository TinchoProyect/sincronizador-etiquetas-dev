const fs = require('fs');

let file = fs.readFileSync('src/produccion/js/ingredientes.js', 'utf8');

// Branch 1 (Vista Usuario)
file = file.replace(
    "const mixButtons = ingrediente.esMix || ingrediente.tipo_origen === 'Mix'\n                ? `<button class=\"btn-tarjeta primary\" onclick=\"if(window.gestionarComposicionMix) gestionarComposicionMix(${ingredienteIdReal})\">📋 Fórmula</button>`\n                : '';",
    "const esMix = ingrediente.esMix || ingrediente.tipo_origen === 'Mix';\n            const mixButtons = esMix\n                ? `<button class=\"btn-tarjeta primary\" onclick=\"if(window.gestionarComposicionMix) gestionarComposicionMix(${ingredienteIdReal})\">📋 Fórmula</button>`\n                : `<button class=\"btn-tarjeta primary\" style=\"padding: 8px 12px;\" onclick=\"if(window.gestionarComposicionMix) gestionarComposicionMix(${ingredienteIdReal})\" title=\"Crear Fórmula\">➕🧪</button>`;"
);

// Branch 2 (Vista Deposito)
// In Vista Deposito, the footer is formed inside groupContent.appendChild(card) using template literal.
// Let's replace the inline condition for Branch 2
const oldFooterHTML = "                    ${(ingrediente.esMix || ingrediente.tipo_origen === 'Mix') ? `<button class=\"btn-tarjeta primary\" onclick=\"if(window.gestionarComposicionMix) gestionarComposicionMix(${ingredienteIdReal})\">📋 Fórmula</button>` : ''}\n                    <button class=\"btn-tarjeta-sector\"";

const newFooterHTML = "                    ${(ingrediente.esMix || ingrediente.tipo_origen === 'Mix') ? `<button class=\"btn-tarjeta primary\" onclick=\"if(window.gestionarComposicionMix) gestionarComposicionMix(${ingredienteIdReal})\">📋 Fórmula</button>` : `<button class=\"btn-tarjeta primary\" style=\"padding: 8px 12px;\" onclick=\"if(window.gestionarComposicionMix) gestionarComposicionMix(${ingredienteIdReal})\" title=\"Crear Fórmula\">➕🧪</button>`}\n                    <button class=\"btn-tarjeta-sector\"";

file = file.replace(oldFooterHTML, newFooterHTML);

fs.writeFileSync('src/produccion/js/ingredientes.js', file, 'utf8');
console.log('Done!');
