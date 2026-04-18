const fs = require('fs');

let file = fs.readFileSync('src/produccion/pages/ingredientes.html', 'utf8');

const regexModalMix = /<div id="modal-mix" class="modal">[\s\S]*?<\/div>\s*<\/div>\s*<!-- Modal de Ajuste de Kilos -->/;

// Nuevo diseño del modal con clases de UI modernas
const nuevoModalMix = `<div id="modal-mix" class="modal modal-new-ui">
            <div class="modal-content" style="max-width: 600px; border-radius: 12px; border: 1px solid #e2e8f0; box-shadow: 0 10px 25px -5px rgba(0,0,0,0.1), 0 8px 10px -6px rgba(0,0,0,0.1);">
                <div class="modal-header" style="border-bottom: 2px solid #f1f5f9; padding-bottom: 15px; margin-bottom: 20px;">
                    <h5 id="modal-mix-titulo" style="font-weight: 800; color: #1e293b; font-size: 1.5rem; margin: 0;">Composición de Fórmula</h5>
                    <span class="close-modal" style="font-size: 1.5rem; color: #94a3b8; cursor: pointer;">&times;</span>
                </div>

                <div class="agregar-ingrediente-row" style="display: flex; gap: 10px; margin-bottom: 20px;">
                    <div class="input-ingrediente-wrapper" style="flex: 1; position: relative;">
                        <input type="text" id="buscar-ingrediente-mix" placeholder="Buscar ingrediente..." autocomplete="off" style="width: 100%; border: 1px solid #cbd5e1; border-radius: 8px; padding: 10px;">
                        <ul id="lista-resultados-mix" class="lista-resultados-mix"></ul>
                    </div>
                    <input type="number" id="cantidad-ingrediente-mix" placeholder="Kg" step="0.001" min="0.001" style="width: 100px; border: 1px solid #cbd5e1; border-radius: 8px; padding: 10px;">
                    <button id="btn-agregar-a-mix" class="btn-agregar-inline" title="Agregar ingrediente" style="background: #3b82f6; color: white; border: none; border-radius: 8px; width: 40px; font-weight: bold; cursor: pointer;">+</button>
                </div>

                <div class="tabla-mix-container" style="border: 1px solid #e2e8f0; border-radius: 8px; overflow: hidden; margin-bottom: 20px;">
                    <table class="tabla-mix-ingredientes" style="width: 100%; border-collapse: collapse;">
                        <thead style="background: #f8fafc;">
                            <tr>
                                <th style="padding: 12px; text-align: left; color: #64748b; font-weight: 600;">Ingrediente</th>
                                <th style="padding: 12px; text-align: left; color: #64748b; font-weight: 600;">Cantidad</th>
                                <th></th>
                            </tr>
                        </thead>
                        <tbody id="tabla-mix-ingredientes-body">
                            <!-- Los ingredientes del mix se cargarán dinámicamente aquí -->
                        </tbody>
                        <tfoot style="background: #f1f5f9; border-top: 2px solid #e2e8f0;">
                            <tr class="fila-total">
                                <td style="padding: 12px;"><strong>TOTAL</strong></td>
                                <td style="padding: 12px;"><strong id="total-kilos-mix" style="color: #3b82f6;">0.00 Kilo</strong></td>
                                <td></td>
                            </tr>
                        </tfoot>
                    </table>
                </div>

                <!-- Botones de Acción (Modernos) -->
                <div class="modal-footer" style="display: flex; justify-content: flex-end; gap: 12px; border-top: 1px solid #cbd5e1; padding-top: 20px;">
                    <button type="button" class="close-modal-btn" style="padding: 10px 16px; background: white; border: 1px solid #cbd5e1; color: #64748b; border-radius: 8px; font-weight: 600; cursor: pointer;">Cancelar</button>
                    <!-- El boton eliminar va oculto primero por defecto, lo muestra mix.js si hay receta existente -->
                    <button type="button" id="btn-eliminar-formula" style="display: none; padding: 10px 16px; background: #fee2e2; border: 1px solid #fecaca; color: #ef4444; border-radius: 8px; font-weight: 600; cursor: pointer;">Eliminar Fórmula</button>
                    <button id="btn-guardar-mix" class="btn-guardar-mix" style="padding: 10px 24px; background: #2563eb; color: white; border: none; border-radius: 8px; font-weight: bold; cursor: pointer;">
                        Guardar Receta
                    </button>
                </div>
            </div>
        </div>

        <!-- Modal de Ajuste de Kilos -->`;

if (file.match(regexModalMix)) {
    file = file.replace(regexModalMix, nuevoModalMix);
    fs.writeFileSync('src/produccion/pages/ingredientes.html', file, 'utf8');
} else {
    console.error("No se encontró el bloque modal-mix");
}
