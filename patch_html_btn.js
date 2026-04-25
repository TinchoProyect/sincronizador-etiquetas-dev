const fs = require('fs');
const path = require('path');

const htmlPath = path.join(__dirname, 'src/produccion/pages/ingredientes.html');
let content = fs.readFileSync(htmlPath, 'utf8');

const btnCategorias = `
                                <button id="btn-gestionar-categorias" class="btn-inventario"
                                    onclick="abrirModalCategorias()"
                                    style="background-color: #0284c7; margin-left: 10px;">
                                    📂 Gestionar Categorías
                                </button>`;

if (!content.includes('id="btn-gestionar-categorias"')) {
    const idx = content.indexOf('🏢 Gestionar Sectores');
    if (idx !== -1) {
        const endIdx = content.indexOf('</button>', idx) + 9;
        content = content.substring(0, endIdx) + btnCategorias + content.substring(endIdx);
        fs.writeFileSync(htmlPath, content, 'utf8');
        console.log('✅ Button added via indexOf');
    }
} else {
    console.log('⚠️ Button already exists');
}
