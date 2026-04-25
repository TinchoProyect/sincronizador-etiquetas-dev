const fs = require('fs');
const path = require('path');

const jsPath = path.join(__dirname, 'src/produccion/js/ingredientes.js');
let content = fs.readFileSync(jsPath, 'utf8');

// 1. Remove the logic from abrirModal
const oldAbrirModalCondition = `    if (sectoresDisponibles.length === 0) {
        await cargarCategorias();
        await cargarSectores();
        inicializarComboboxCategorias();
    }`;

const newAbrirModalCondition = `    if (sectoresDisponibles.length === 0) {
        await cargarSectores();
    }`;

if (content.includes(oldAbrirModalCondition)) {
    content = content.replace(oldAbrirModalCondition, newAbrirModalCondition);
}

// 2. Add the logic to DOMContentLoaded
const domLoadStart = "document.addEventListener('DOMContentLoaded', async () => {";
const domLoadInjected = `document.addEventListener('DOMContentLoaded', async () => {
    // Inicializar combobox de categorías globalmente
    await cargarCategorias();
    inicializarComboboxCategorias();
`;

if (content.includes(domLoadStart) && !content.includes('// Inicializar combobox de categorías globalmente')) {
    content = content.replace(domLoadStart, domLoadInjected);
}

fs.writeFileSync(jsPath, content, 'utf8');
console.log('✅ JS logic moved to DOMContentLoaded');
