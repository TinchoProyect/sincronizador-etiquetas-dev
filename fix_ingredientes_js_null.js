const fs = require('fs');
const path = require('path');

const jsPath = path.join(__dirname, 'src/produccion/js/ingredientes.js');
let content = fs.readFileSync(jsPath, 'utf8');

// 1. Reemplazar la asignación vieja en editarIngrediente
const oldSetCat = "document.getElementById('categoria').value = ingrediente.categoria;";
const newSetCat = `// Soporte para Combobox de categorías
        const catInput = document.getElementById('categoria-input');
        const catId = document.getElementById('categoria-id');
        if (catInput && catId) {
            catInput.value = ingrediente.categoria_nombre || ingrediente.categoria || '';
            catId.value = ingrediente.categoria_id || '';
            const btnEdit = document.getElementById('btn-edit-categoria');
            if (btnEdit && catId.value) btnEdit.style.display = 'block';
        }`;

if (content.includes(oldSetCat)) {
    content = content.replace(oldSetCat, newSetCat);
}

// 2. Verificar que al limpiar el formulario se limpie el combobox
const oldLimpiar = "document.getElementById('form-ingrediente').reset();";
const newLimpiar = `document.getElementById('form-ingrediente').reset();
    const hiddenId = document.getElementById('categoria-id');
    const btnEdit = document.getElementById('btn-edit-categoria');
    if (hiddenId) hiddenId.value = '';
    if (btnEdit) btnEdit.style.display = 'none';`;

if (content.includes(oldLimpiar)) {
    // replace all occurrences
    content = content.split(oldLimpiar).join(newLimpiar);
}

// 3. Modificar el CSS si es necesario. En este caso el z-index ya está en inline style en html.
// Para asegurarnos que no hay overflow: hidden en el modal-content.
const cssPath = path.join(__dirname, 'src/produccion/css/style.css');
if (fs.existsSync(cssPath)) {
    let css = fs.readFileSync(cssPath, 'utf8');
    // If .modal-content has overflow-y: auto, the dropdown could be clipped if it goes out of bounds.
    // The dropdown might be hidden inside the scrollable modal.
    // We should make sure .modal-content has visible overflow if possible, or give the combobox-list position: fixed ?
    // Actually, position absolute with z-index 9999 inside a relative parent should be above everything, AS LONG AS the modal doesn't clip it.
    // We can add a patch to the inline style in HTML.
}

fs.writeFileSync(jsPath, content, 'utf8');
console.log('✅ JS corregido (editarIngrediente y reset)');
