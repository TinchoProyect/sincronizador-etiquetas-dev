const fs = require('fs');
const path = require('path');

const htmlPath = path.join(__dirname, 'src/produccion/pages/ingredientes.html');
let content = fs.readFileSync(htmlPath, 'utf8');

// 1. Add the "Gestionar Categorías" button
const btnSectores = `<button id="btn-gestionar-sectores" class="btn-inventario"
                                    onclick="abrirVentana('sectores.html', 'gestionSectores')"
                                    style="background-color: #28a745;">
                                    🏢 Gestionar Sectores
                                </button>`;
const btnCategorias = `
                                <button id="btn-gestionar-categorias" class="btn-inventario"
                                    onclick="abrirModalCategorias()"
                                    style="background-color: #0284c7; margin-left: 10px;">
                                    📂 Gestionar Categorías
                                </button>`;

if (content.includes(btnSectores) && !content.includes('id="btn-gestionar-categorias"')) {
    content = content.replace(btnSectores, btnSectores + btnCategorias);
    console.log('✅ Button added');
}

// 2. Add the Modal for "Gestionar Categorías"
const modalHTML = `
        <!-- Modal para gestionar categorías -->
        <div id="modal-gestionar-categorias" class="modal">
            <div class="modal-content" style="max-width: 600px;">
                <div class="modal-header">
                    <span class="close-modal" onclick="document.getElementById('modal-gestionar-categorias').style.display='none'">&times;</span>
                    <h2>Gestión de Categorías</h2>
                </div>
                <div class="modal-body" style="padding: 20px;">
                    <div style="display: flex; justify-content: space-between; margin-bottom: 15px;">
                        <input type="text" id="buscador-categorias-modal" placeholder="Buscar categoría..." style="padding: 8px; width: 60%; border: 1px solid #cbd5e1; border-radius: 4px;">
                        <button class="btn-agregar" onclick="abrirSubFormularioCategoria('', true)" style="width: 35%;">+ Nueva Categoría</button>
                    </div>
                    
                    <div class="tabla-container" style="max-height: 400px; overflow-y: auto; border: 1px solid #e2e8f0; border-radius: 8px;">
                        <table class="articulos-tabla" style="width: 100%; border-collapse: collapse;">
                            <thead style="position: sticky; top: 0; background: #f8fafc;">
                                <tr>
                                    <th style="padding: 10px; text-align: left; border-bottom: 2px solid #e2e8f0;">ID</th>
                                    <th style="padding: 10px; text-align: left; border-bottom: 2px solid #e2e8f0;">Nombre</th>
                                    <th style="padding: 10px; text-align: left; border-bottom: 2px solid #e2e8f0;">Descripción</th>
                                    <th style="padding: 10px; text-align: center; border-bottom: 2px solid #e2e8f0;">Acciones</th>
                                </tr>
                            </thead>
                            <tbody id="tabla-categorias-body">
                                <!-- Contenido dinámico -->
                            </tbody>
                        </table>
                    </div>
                </div>
            </div>
        </div>
`;

if (!content.includes('id="modal-gestionar-categorias"')) {
    // Insert before the closing </main> or after the modal-ingrediente
    const insertPoint = '<!-- Modal para agregar/editar ingrediente -->';
    if (content.includes(insertPoint)) {
        content = content.replace(insertPoint, modalHTML + '\\n        ' + insertPoint);
        console.log('✅ Modal added');
    }
}

fs.writeFileSync(htmlPath, content, 'utf8');
