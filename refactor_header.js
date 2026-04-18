const fs = require('fs');

let content = fs.readFileSync('src/produccion/pages/ingredientes.html', 'utf8');

const targetHeader = `<header>
            <h1>Gestión de Ingredientes</h1>
            <a href="/pages/produccion.html" class="back-button">← Volver al espacio de trabajo</a>
        </header>`;

const replaceHeader = `<header style="display: flex; justify-content: space-between; align-items: center;">
            <div>
                <h1>Gestión de Ingredientes</h1>
                <a href="/pages/produccion.html" class="back-button">← Volver al espacio de trabajo</a>
            </div>
            <div>
                <button id="btn-inventario-ingredientes" class="btn-inventario"
                    onclick="abrirVentana('inventario-ingredientes.html', 'inventarioIngredientes')"
                    style="margin: 0; padding: 12px 24px; font-size: 1.1rem;">
                    📋 Inventario
                </button>
            </div>
        </header>`;

content = content.replace(targetHeader, replaceHeader);

const targetButton = `                                <button id="btn-inventario-ingredientes" class="btn-inventario"
                                    onclick="abrirVentana('inventario-ingredientes.html', 'inventarioIngredientes')">
                                    📋 Inventario
                                </button>`;
                                
content = content.replace(targetButton, '');

fs.writeFileSync('src/produccion/pages/ingredientes.html', content);
console.log('Done!');
