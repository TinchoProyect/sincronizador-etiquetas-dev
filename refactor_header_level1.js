const fs = require('fs');

let content = fs.readFileSync('src/produccion/pages/ingredientes.html', 'utf8');

const targetHeader = `<header>
            <h1>Gestión de Ingredientes</h1>
            <a href="/pages/produccion.html" class="back-button">← Volver al espacio de trabajo</a>
        </header>`;

const replaceHeader = `<header style="display: flex; justify-content: space-between; align-items: center; padding: 15px 30px;">
            <div style="display: flex; align-items: center; gap: 20px;">
                <h1 style="margin: 0;">Gestión de Ingredientes</h1>
                <button id="btn-inventario-ingredientes" class="btn-inventario"
                    onclick="abrirVentana('inventario-ingredientes.html', 'inventarioIngredientes')"
                    style="margin: 0; padding: 8px 16px; font-size: 1rem; box-shadow: 0 4px 6px rgba(0,0,0,0.1);">
                    📋 Inventario
                </button>
            </div>
            <a href="/pages/produccion.html" class="back-button" style="margin: 0;">← Volver al espacio de trabajo</a>
        </header>`;

content = content.replace(targetHeader, replaceHeader);

// Eliminamos el botón viejo, vamos a buscarlo usando un regex porque los espacios pueden cambiar
const btnRegex = /<button id="btn-inventario-ingredientes".*?<\/button>\s*/is;
content = content.replace(btnRegex, '');

fs.writeFileSync('src/produccion/pages/ingredientes.html', content);
console.log('Reubicación completada.');
