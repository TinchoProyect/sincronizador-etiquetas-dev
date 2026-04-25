const fs = require('fs');
const path = require('path');

const jsPath = path.join(__dirname, 'src/produccion/js/ingredientes.js');
let content = fs.readFileSync(jsPath, 'utf8');

// 1. Reemplazar abrirSubFormularioCategoria
const oldAbrirSub = `function abrirSubFormularioCategoria(nombreSugerido = '') {
    const list = document.getElementById('categoria-list');
    list.style.display = 'none';
    
    // Convertir el wrapper en un sub-formulario
    const wrapper = document.querySelector('.combobox-wrapper');
    wrapper.innerHTML = \`
        <div style="background: #f8fafc; padding: 10px; border: 1px solid #cbd5e1; border-radius: 6px; margin-top: 5px;">
            <div style="margin-bottom: 8px; font-weight: bold; color: #334155; font-size: 0.9em;">Nueva Categoría</div>
            <input type="text" id="nueva-cat-nombre" value="\${nombreSugerido}" placeholder="Nombre exacto" required style="width: 100%; margin-bottom: 8px; padding: 6px;">
            <input type="text" id="nueva-cat-desc" placeholder="Descripción (Opcional)" style="width: 100%; margin-bottom: 8px; padding: 6px;">
            <div style="display: flex; gap: 8px;">
                <button type="button" id="btn-save-new-cat" style="background: #22c55e; color: white; border: none; padding: 5px 10px; border-radius: 4px; cursor: pointer; flex: 1;">Guardar</button>
                <button type="button" id="btn-cancel-new-cat" style="background: #ef4444; color: white; border: none; padding: 5px 10px; border-radius: 4px; cursor: pointer;">Cancelar</button>
            </div>
        </div>
    \`;

    document.getElementById('btn-cancel-new-cat').addEventListener('click', () => restaurarComboboxOriginal());
    
    document.getElementById('btn-save-new-cat').addEventListener('click', async () => {
        const nombre = document.getElementById('nueva-cat-nombre').value.trim();
        const descripcion = document.getElementById('nueva-cat-desc').value.trim();
        if (!nombre) return alert('El nombre es obligatorio');
        
        try {
            const resp = await fetch('/api/produccion/categorias', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ nombre, descripcion })
            });
            if (!resp.ok) {
                const err = await resp.json();
                throw new Error(err.error || 'Error al crear categoría');
            }
            const nuevaCat = await resp.json();
            
            // Recargar catálogo global
            await cargarCategorias();
            
            // Restaurar y preseleccionar
            restaurarComboboxOriginal();
            document.getElementById('categoria-input').value = nuevaCat.nombre;
            document.getElementById('categoria-id').value = nuevaCat.id;
            document.getElementById('btn-edit-categoria').style.display = 'block';
            mostrarMensaje('Categoría creada exitosamente', 'exito');
            
        } catch (error) {
            alert(error.message);
        }
    });
}`;

const newAbrirSub = `function abrirSubFormularioCategoria(nombreSugerido = '', isModal = false) {
    // Si viene desde el modal "Gestionar Categorías", guardaremos un estado
    window.isEditingCategoryModal = isModal;
    
    const wrapper = document.querySelector('.combobox-wrapper');
    const container = document.getElementById('categoria-form-container');
    const list = document.getElementById('categoria-list');
    
    if (list) list.style.display = 'none';
    if (wrapper && !isModal) wrapper.style.display = 'none';
    
    // Configurar el formulario
    document.getElementById('cat-form-nombre').value = nombreSugerido;
    document.getElementById('cat-form-desc').value = '';
    
    const editId = isModal ? null : document.getElementById('categoria-id').value;
    
    // Si estamos editando y hay ID, cargar descripción
    if (editId && !isModal) {
        const catObj = categoriasCatalogo.find(c => c.id == editId);
        if (catObj) document.getElementById('cat-form-desc').value = catObj.descripcion || '';
    }
    
    if (container) {
        container.style.display = 'block';
        // Asegurar limpiar event listeners anteriores usando cloneNode
        const btnSave = document.getElementById('btn-guardar-categoria');
        const newBtnSave = btnSave.cloneNode(true);
        btnSave.parentNode.replaceChild(newBtnSave, btnSave);
        
        const btnCancel = document.getElementById('btn-cancelar-categoria');
        const newBtnCancel = btnCancel.cloneNode(true);
        btnCancel.parentNode.replaceChild(newBtnCancel, btnCancel);
        
        newBtnCancel.addEventListener('click', () => {
            container.style.display = 'none';
            if (!isModal && wrapper) wrapper.style.display = 'block';
        });
        
        newBtnSave.addEventListener('click', async () => {
            const nombre = document.getElementById('cat-form-nombre').value.trim();
            const descripcion = document.getElementById('cat-form-desc').value.trim();
            if (!nombre) {
                mostrarMensaje('El nombre de la categoría es obligatorio', 'error');
                return;
            }
            
            try {
                const isEdit = !isModal && editId;
                const url = isEdit ? \`/api/produccion/categorias/\${editId}\` : '/api/produccion/categorias';
                const method = isEdit ? 'PUT' : 'POST';
                
                const resp = await fetch(url, {
                    method: method,
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ nombre, descripcion })
                });
                
                if (!resp.ok) {
                    const err = await resp.json();
                    throw new Error(err.error || 'Error al guardar categoría');
                }
                const savedCat = await resp.json();
                
                // Recargar catálogo
                await cargarCategorias();
                
                // Restaurar vista
                container.style.display = 'none';
                
                if (!isModal && wrapper) {
                    wrapper.style.display = 'block';
                    document.getElementById('categoria-input').value = savedCat.nombre;
                    document.getElementById('categoria-id').value = savedCat.id;
                    const btnEdit = document.getElementById('btn-edit-categoria');
                    if (btnEdit) btnEdit.style.display = 'block';
                }
                
                if (isModal) {
                    renderizarTablaCategorias();
                }
                
                mostrarMensaje('Categoría guardada exitosamente', 'exito');
            } catch (error) {
                mostrarMensaje(error.message, 'error');
            }
        });
    }
}`;

if (content.includes('function abrirSubFormularioCategoria')) {
    const startIndex = content.indexOf('function abrirSubFormularioCategoria');
    const endIndex = content.indexOf('function restaurarComboboxOriginal');
    if (startIndex !== -1 && endIndex !== -1) {
        content = content.substring(0, startIndex) + newAbrirSub + '\\n\\n' + content.substring(endIndex);
        console.log('✅ abrirSubFormularioCategoria replaced');
    }
}

// 2. Remove restaurarComboboxOriginal since it's no longer needed
if (content.includes('function restaurarComboboxOriginal() {')) {
    const startIdx = content.indexOf('function restaurarComboboxOriginal() {');
    // Find next function or EOF
    const endIdx = content.indexOf('document.addEventListener(', startIdx);
    if (startIdx !== -1 && endIdx !== -1) {
        content = content.substring(0, startIdx) + content.substring(endIdx);
        console.log('✅ restaurarComboboxOriginal removed');
    }
}

// 3. Fix inicializarComboboxCategorias to bind Edit Pencil
const editCodeTarget = `const btnEdit = document.getElementById('btn-edit-categoria');

    if (!input || !list || !hiddenId) return;`;

const editCodeInjection = `const btnEdit = document.getElementById('btn-edit-categoria');

    if (!input || !list || !hiddenId) return;

    if (btnEdit) {
        // Remover listeners anteriores por las dudas
        const newBtnEdit = btnEdit.cloneNode(true);
        btnEdit.parentNode.replaceChild(newBtnEdit, btnEdit);
        newBtnEdit.addEventListener('click', () => {
            abrirSubFormularioCategoria(input.value);
        });
    }`;

if (content.includes(editCodeTarget)) {
    content = content.replace(editCodeTarget, editCodeInjection);
    console.log('✅ btn-edit-categoria listener injected');
}

// 4. Inject Modal Management Logic
const modalLogic = `
// ==========================================
// GESTIÓN CENTRALIZADA DE CATEGORÍAS
// ==========================================

function abrirModalCategorias() {
    document.getElementById('modal-gestionar-categorias').style.display = 'block';
    renderizarTablaCategorias();
    
    // Buscador
    const buscador = document.getElementById('buscador-categorias-modal');
    if (buscador) {
        buscador.value = '';
        buscador.addEventListener('input', (e) => {
            renderizarTablaCategorias(e.target.value.toLowerCase());
        });
    }
}

function renderizarTablaCategorias(filtro = '') {
    const tbody = document.getElementById('tabla-categorias-body');
    if (!tbody) return;
    tbody.innerHTML = '';
    
    let categoriasAMostrar = categoriasCatalogo;
    if (filtro) {
        categoriasAMostrar = categoriasAMostrar.filter(c => c.nombre.toLowerCase().includes(filtro));
    }
    
    if (categoriasAMostrar.length === 0) {
        tbody.innerHTML = '<tr><td colspan="4" style="text-align:center; padding:20px;">No se encontraron categorías</td></tr>';
        return;
    }
    
    categoriasAMostrar.forEach(cat => {
        const tr = document.createElement('tr');
        tr.style.borderBottom = '1px solid #e2e8f0';
        tr.innerHTML = \`
            <td style="padding: 10px; color: #64748b; font-size: 0.9em;">#\${cat.id}</td>
            <td style="padding: 10px; font-weight: bold; color: #334155;">\${cat.nombre}</td>
            <td style="padding: 10px; color: #475569; font-size: 0.9em;">\${cat.descripcion || '-'}</td>
            <td style="padding: 10px; text-align: center;">
                <button onclick="editarCategoriaDesdeModal(\${cat.id})" style="background: none; border: none; cursor: pointer; color: #3b82f6; margin-right: 10px;" title="Editar">✏️</button>
                <button onclick="borrarCategoria(\${cat.id})" style="background: none; border: none; cursor: pointer; color: #ef4444;" title="Eliminar">🗑️</button>
            </td>
        \`;
        tbody.appendChild(tr);
    });
}

function editarCategoriaDesdeModal(id) {
    const cat = categoriasCatalogo.find(c => c.id == id);
    if (!cat) return;
    
    // Engañar a abrirSubFormularioCategoria llenando temporalmente los IDs de ingredientes
    const catIdInput = document.getElementById('categoria-id');
    const oldId = catIdInput ? catIdInput.value : '';
    if (catIdInput) catIdInput.value = id;
    
    abrirSubFormularioCategoria(cat.nombre, true);
    
    // Restaurar si corresponde, pero el guardado usará el editId
    // En realidad, para hacerlo perfecto, editId usa categoria-id, por lo que lo dejamos cargado temporalmente
}

async function borrarCategoria(id) {
    // Usamos el SweetAlert o un confirm
    const confirmacion = confirm('¿Estás seguro de eliminar esta categoría? Si está en uso por ingredientes, la operación será rechazada.');
    if (!confirmacion) return;
    
    try {
        const response = await fetch(\`/api/produccion/categorias/\${id}\`, { method: 'DELETE' });
        if (!response.ok) {
            const errorData = await response.json();
            throw new Error(errorData.error || 'Error al eliminar la categoría');
        }
        
        mostrarMensaje('Categoría eliminada exitosamente', 'exito');
        await cargarCategorias();
        renderizarTablaCategorias();
        
    } catch (error) {
        mostrarMensaje(error.message, 'error');
    }
}
`;

if (!content.includes('function abrirModalCategorias')) {
    const idx = content.lastIndexOf('document.addEventListener(');
    if (idx !== -1) {
        content = content.substring(0, idx) + modalLogic + '\\n\\n' + content.substring(idx);
        console.log('✅ Modal logic injected');
    }
}

fs.writeFileSync(jsPath, content, 'utf8');
