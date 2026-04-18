const fs = require('fs');

let lines = fs.readFileSync('src/produccion/pages/ingredientes.html', 'utf8').split('\n');

const headerIndex = lines.findIndex(l => l.trim() === '<header>');

if (headerIndex !== -1) {
    // Delete the old header lines (which are lines headerIndex to headerIndex+3)
    lines.splice(headerIndex, 4, 
        `        <header style="display: flex; justify-content: space-between; align-items: center; padding: 15px 30px;">`,
        `            <div style="display: flex; align-items: center; gap: 20px;">`,
        `                <h1 style="margin: 0;">Gestión de Ingredientes</h1>`,
        `                <button id="btn-inventario-ingredientes" class="btn-inventario"`,
        `                    onclick="abrirVentana('inventario-ingredientes.html', 'inventarioIngredientes')"`,
        `                    style="margin: 0; padding: 8px 16px; font-size: 1rem; box-shadow: 0 2px 4px rgba(0,0,0,0.1); display: flex; align-items: center; gap: 5px;">`,
        `                    📋 Inventario`,
        `                </button>`,
        `            </div>`,
        `            <a href="/pages/produccion.html" class="back-button" style="margin: 0;">← Volver al espacio de trabajo</a>`,
        `        </header>`
    );
}

// Clean the second button up!
const btnIndex = lines.findIndex(l => l.includes('id="btn-inventario-ingredientes"'));
if (btnIndex !== -1 && btnIndex > headerIndex + 10) {
    // remove lines from btnIndex to btnIndex + 3
    lines.splice(btnIndex, 4);
}

fs.writeFileSync('src/produccion/pages/ingredientes.html', lines.join('\n'));
console.log('Restored header and injected button successfully.');
