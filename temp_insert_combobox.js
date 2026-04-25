const fs = require('fs');

const file = 'c:\\Users\\Martin\\Documents\\sincronizador-etiquetas - copia\\src\\produccion\\pages\\ingredientes.html';
let content = fs.readFileSync(file, 'utf8');

const targetStr = `<div class="form-group">
                        <label for="categoria">Categoría:</label>
                        <input type="text" id="categoria" placeholder="Ej: semillas, harinas, frutos secos..." required>
                    </div>`;

const insertStr = `<div class="form-group">
                        <label for="categoria-input">Categoría:</label>
                        <div class="combobox-wrapper" style="position: relative;">
                            <input type="text" id="categoria-input" placeholder="Buscar o crear categoría..." autocomplete="off" required>
                            <input type="hidden" id="categoria-id">
                            <button type="button" id="btn-edit-categoria" style="display: none; position: absolute; right: 10px; top: 50%; transform: translateY(-50%); border: none; background: none; cursor: pointer; color: #64748b;" title="Editar categoría">✏️</button>
                            <ul id="categoria-list" class="combobox-list" style="display: none; position: absolute; top: 100%; left: 0; width: 100%; background: white; border: 1px solid #cbd5e1; border-top: none; z-index: 1000; list-style: none; padding: 0; margin: 0; max-height: 200px; overflow-y: auto; box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.1);"></ul>
                        </div>
                        <div id="categoria-form-container" style="display: none; background: #f8fafc; padding: 15px; border-radius: 8px; margin-top: 10px; border: 1px solid #e2e8f0;">
                            <div style="margin-bottom: 10px;">
                                <label style="font-size: 0.85rem; color: #475569; margin-bottom: 4px; display: block;">Nombre de categoría</label>
                                <input type="text" id="cat-form-nombre" style="width: 100%; padding: 8px; border: 1px solid #cbd5e1; border-radius: 4px;" required>
                            </div>
                            <div style="margin-bottom: 10px;">
                                <label style="font-size: 0.85rem; color: #475569; margin-bottom: 4px; display: block;">Descripción (opcional)</label>
                                <input type="text" id="cat-form-desc" style="width: 100%; padding: 8px; border: 1px solid #cbd5e1; border-radius: 4px;">
                            </div>
                            <div style="display: flex; gap: 10px; justify-content: flex-end;">
                                <button type="button" id="btn-cancelar-categoria" style="padding: 6px 12px; background: white; border: 1px solid #cbd5e1; border-radius: 4px; cursor: pointer;">Cancelar</button>
                                <button type="button" id="btn-guardar-categoria" style="padding: 6px 12px; background: #3b82f6; color: white; border: none; border-radius: 4px; cursor: pointer;">Guardar</button>
                            </div>
                        </div>
                    </div>`;

// Regex que ignora espacios/saltos de línea exactos
const regex = /<div class="form-group">\s*<label for="categoria">Categoría:<\/label>\s*<input type="text" id="categoria" placeholder="Ej: semillas, harinas, frutos secos..." required>\s*<\/div>/g;

if (regex.test(content)) {
    content = content.replace(regex, insertStr);
    fs.writeFileSync(file, content, 'utf8');
    console.log('Insertado exitosamente');
} else {
    console.log('No encontrado');
}
