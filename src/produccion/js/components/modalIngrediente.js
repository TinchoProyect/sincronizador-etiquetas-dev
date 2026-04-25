export const modalIngredienteHTML = `
<!-- Modal para agregar/editar ingrediente -->
<div id="modal-ingrediente" class="modal">
    <div class="modal-content card" style="max-width: 650px; padding: 25px; border-radius: 12px; box-shadow: 0 10px 25px rgba(0,0,0,0.1);">
        <div class="modal-header" style="border-bottom: 2px solid #f1f5f9; padding-bottom: 15px; margin-bottom: 20px; display: flex; justify-content: space-between; align-items: center;">
            <h2 id="modal-titulo" style="margin: 0; color: #1e293b; font-size: 1.5rem; font-weight: 600;">Nuevo Ingrediente</h2>
            <span class="close-modal" style="font-size: 1.5rem; cursor: pointer; color: #64748b; transition: color 0.2s;">&times;</span>
        </div>
        <form id="form-ingrediente" style="display: flex; flex-direction: column; gap: 15px;">
            <input type="hidden" id="ingrediente-id">
            
            <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 20px;">
                <!-- Columna Izquierda -->
                <div style="display: flex; flex-direction: column; gap: 15px;">
                    <div class="form-group" style="margin: 0;">
                        <label for="codigo" style="font-weight: 500; color: #475569; margin-bottom: 5px; display: block;">Código</label>
                        <input type="text" id="codigo" readonly style="width: 100%; padding: 10px; border: 1px solid #e2e8f0; border-radius: 6px; background-color: #f8fafc; color: #64748b;">
                        <small style="color: #94a3b8; font-size: 0.75rem; margin-top: 4px; display: block;">Autogenerado</small>
                    </div>
                    
                    <div class="form-group" style="margin: 0;">
                        <label for="nombre" style="font-weight: 500; color: #475569; margin-bottom: 5px; display: block;">Nombre <span style="color: #ef4444;">*</span></label>
                        <input type="text" id="nombre" required style="width: 100%; padding: 10px; border: 1px solid #cbd5e1; border-radius: 6px; transition: border-color 0.2s;">
                    </div>

                    <div class="form-group" style="margin: 0; position: relative;">
                        <label for="categoria-input" style="font-weight: 500; color: #475569; margin-bottom: 5px; display: block;">Categoría <span style="color: #ef4444;">*</span></label>
                        <div class="combobox-wrapper" style="position: relative;">
                            <input type="text" id="categoria-input" placeholder="Buscar o crear..." autocomplete="off" required style="width: 100%; padding: 10px; border: 1px solid #cbd5e1; border-radius: 6px;">
                            <input type="hidden" id="categoria-id">
                            <button type="button" id="btn-edit-categoria" style="display: none; position: absolute; right: 10px; top: 50%; transform: translateY(-50%); border: none; background: none; cursor: pointer; color: #64748b;" title="Editar categoría">✏️</button>
                            <ul id="categoria-list" class="combobox-list" style="display: none; position: absolute; top: calc(100% + 4px); left: 0; width: 100%; background: white; border: 1px solid #e2e8f0; border-radius: 6px; z-index: 10000; list-style: none; padding: 0; margin: 0; max-height: 200px; overflow-y: auto; box-shadow: 0 10px 15px -3px rgba(0, 0, 0, 0.1);"></ul>
                        </div>
                        <div id="categoria-form-container" style="display: none; background: #f8fafc; padding: 15px; border-radius: 8px; margin-top: 10px; border: 1px solid #e2e8f0; position: absolute; z-index: 10001; width: calc(100% - 30px); box-shadow: 0 10px 15px -3px rgba(0,0,0,0.1);">
                            <div style="margin-bottom: 10px;">
                                <label style="font-size: 0.85rem; color: #475569; margin-bottom: 4px; display: block;">Nombre de categoría</label>
                                <input type="text" id="cat-form-nombre" style="width: 100%; padding: 8px; border: 1px solid #cbd5e1; border-radius: 4px;" required>
                            </div>
                            <div style="margin-bottom: 10px;">
                                <label style="font-size: 0.85rem; color: #475569; margin-bottom: 4px; display: block;">Descripción (opcional)</label>
                                <input type="text" id="cat-form-desc" style="width: 100%; padding: 8px; border: 1px solid #cbd5e1; border-radius: 4px;">
                            </div>
                            <div style="display: flex; gap: 10px; justify-content: flex-end;">
                                <button type="button" id="btn-cancelar-categoria" style="padding: 6px 12px; background: white; border: 1px solid #cbd5e1; border-radius: 4px; cursor: pointer; font-size: 0.85rem;">Cancelar</button>
                                <button type="button" id="btn-guardar-categoria" style="padding: 6px 12px; background: #3b82f6; color: white; border: none; border-radius: 4px; cursor: pointer; font-size: 0.85rem; font-weight: 500;">Guardar</button>
                            </div>
                        </div>
                    </div>
                </div>

                <!-- Columna Derecha -->
                <div style="display: flex; flex-direction: column; gap: 15px;">
                    <div class="form-group" style="margin: 0;">
                        <label for="sector" style="font-weight: 500; color: #475569; margin-bottom: 5px; display: block;">Sector</label>
                        <select id="sector" style="width: 100%; padding: 10px; border: 1px solid #cbd5e1; border-radius: 6px; background-color: white;">
                            <option value="">Sin sector asignado</option>
                        </select>
                    </div>
                    
                    <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 15px;">
                        <div class="form-group" style="margin: 0;">
                            <label for="stock" style="font-weight: 500; color: #475569; margin-bottom: 5px; display: block;">Stock <span style="color: #ef4444;">*</span></label>
                            <input type="number" id="stock" step="0.01" min="0" required style="width: 100%; padding: 10px; border: 1px solid #cbd5e1; border-radius: 6px;">
                        </div>
                        <div class="form-group" style="margin: 0;">
                            <label for="unidad-medida" style="font-weight: 500; color: #475569; margin-bottom: 5px; display: block;">Unidad <span style="color: #ef4444;">*</span></label>
                            <input type="text" id="unidad-medida" placeholder="Ej: kilo" required style="width: 100%; padding: 10px; border: 1px solid #cbd5e1; border-radius: 6px;">
                        </div>
                    </div>

                    <div class="form-group" style="margin: 0; flex-grow: 1; display: flex; flex-direction: column;">
                        <label for="descripcion" style="font-weight: 500; color: #475569; margin-bottom: 5px; display: block;">Descripción General</label>
                        <textarea id="descripcion" rows="3" style="width: 100%; padding: 10px; border: 1px solid #cbd5e1; border-radius: 6px; resize: none; flex-grow: 1;"></textarea>
                    </div>
                </div>
            </div>

            <div class="form-actions" style="margin-top: 15px; padding-top: 15px; border-top: 1px solid #e2e8f0; display: flex; justify-content: flex-end; gap: 12px;">
                <button type="button" class="close-modal close-modal-btn" style="padding: 10px 20px; background: white; border: 1px solid #cbd5e1; border-radius: 6px; color: #475569; cursor: pointer; font-weight: 500; transition: all 0.2s;">Cancelar</button>
                <button type="button" id="btn-imprimir" class="btn-imprimir" style="display:none; padding: 10px 20px; background: #f8fafc; border: 1px solid #cbd5e1; border-radius: 6px; color: #475569; cursor: pointer; font-weight: 500;">🖨️ Imprimir</button>
                <button type="submit" class="btn btn-success" style="padding: 10px 24px; background: #22c55e; color: white; border: none; border-radius: 6px; font-weight: 600; cursor: pointer; box-shadow: 0 4px 6px -1px rgba(34, 197, 94, 0.2); transition: all 0.2s;">💾 Guardar Ingrediente</button>
            </div>
        </form>
    </div>
</div>
`;

let categoriasCatalogo = [];
let sectoresDisponibles = [];
let onSuccessCallbackGlobal = null;

export async function inicializarModalIngrediente(onSuccessCallback = null) {
    onSuccessCallbackGlobal = onSuccessCallback;

    // Cargar dependencias
    await cargarCategorias();
    await cargarSectores();

    // Inicializar lógica de UI
    inicializarComboboxCategorias();
    configurarCierreModal();
    configurarSubmitFormulario();
}

export async function cargarCategorias() {
    try {
        const response = await fetch('/api/produccion/categorias');
        if (!response.ok) throw new Error('Error al cargar categorías');
        categoriasCatalogo = await response.json();
    } catch (error) {
        console.error('Error cargando categorías:', error);
    }
}

export function getCategoriasCatalogo() {
    return categoriasCatalogo;
}

export async function cargarSectores() {
    try {
        const response = await fetch('/api/produccion/sectores');
        if (!response.ok) throw new Error('Error al cargar sectores');
        sectoresDisponibles = await response.json();
        
        const selectorSector = document.getElementById('sector');
        if (selectorSector) {
            selectorSector.innerHTML = '<option value="">Sin sector asignado</option>';
            sectoresDisponibles.forEach(sector => {
                const option = document.createElement('option');
                option.value = sector.id;
                option.textContent = sector.nombre;
                selectorSector.appendChild(option);
            });
        }
    } catch (error) {
        console.error('Error cargando sectores:', error);
    }
}

function inicializarComboboxCategorias() {
    const input = document.getElementById('categoria-input');
    const hiddenId = document.getElementById('categoria-id');
    const list = document.getElementById('categoria-list');
    const btnEdit = document.getElementById('btn-edit-categoria');

    if (!input || !list || !hiddenId) {
        console.error('❌ [modalIngrediente] No se encontraron elementos del combobox de categorías en el DOM.');
        return;
    }

    if (input.dataset.inicializado === 'true') {
        console.log('✅ [modalIngrediente] Combobox de categorías ya estaba inicializado.');
        return;
    }
    input.dataset.inicializado = 'true';

    console.log('🔧 [modalIngrediente] Inicializando listeners para combobox de categorías...');

    if (btnEdit) {
        const newBtnEdit = btnEdit.cloneNode(true);
        btnEdit.parentNode.replaceChild(newBtnEdit, btnEdit);
        newBtnEdit.addEventListener('click', () => {
            abrirSubFormularioCategoria(input.value);
        });
    }

    input.addEventListener('focus', () => {
        console.log('🔍 [modalIngrediente] Focus en categoría. Mostrando lista...');
        renderizarComboboxCategorias(categoriasCatalogo);
        list.style.display = 'block';
    });

    input.addEventListener('input', (e) => {
        const val = e.target.value.toLowerCase();
        hiddenId.value = '';
        const currentBtnEdit = document.getElementById('btn-edit-categoria');
        if(currentBtnEdit) currentBtnEdit.style.display = 'none';
        
        const filtradas = categoriasCatalogo.filter(c => c.nombre.toLowerCase().includes(val));
        renderizarComboboxCategorias(filtradas, val);
        list.style.display = 'block';
    });

    // Delegación de eventos para el click fuera del combobox
    document.addEventListener('click', (e) => {
        const isClickInsideCombobox = e.target.closest('.combobox-wrapper');
        const isClickInsideForm = e.target.closest('#categoria-form-container');
        
        if (!isClickInsideCombobox && !isClickInsideForm) {
            const currentList = document.getElementById('categoria-list');
            if(currentList) currentList.style.display = 'none';
        }
    });
}

function renderizarComboboxCategorias(categorias, filtroBusqueda = '') {
    const list = document.getElementById('categoria-list');
    list.innerHTML = '';

    categorias.forEach(cat => {
        const li = document.createElement('li');
        li.textContent = cat.nombre;
        li.style.padding = '8px 12px';
        li.style.cursor = 'pointer';
        li.style.borderBottom = '1px solid #f1f5f9';
        
        li.addEventListener('mouseover', () => li.style.backgroundColor = '#f8fafc');
        li.addEventListener('mouseout', () => li.style.backgroundColor = 'white');
        
        li.addEventListener('click', () => {
            document.getElementById('categoria-input').value = cat.nombre;
            document.getElementById('categoria-id').value = cat.id;
            const btnEdit = document.getElementById('btn-edit-categoria');
            if(btnEdit) btnEdit.style.display = 'block';
            list.style.display = 'none';
        });
        list.appendChild(li);
    });

    const li = document.createElement('li');
    li.style.padding = '8px 12px';
    li.style.color = '#0275d8';
    li.style.cursor = 'pointer';
    li.style.fontWeight = 'bold';
    li.style.backgroundColor = '#f0f9ff';
    li.style.borderTop = '1px solid #bae6fd';
    
    if (filtroBusqueda.trim() !== '') {
        li.innerHTML = `➕ Crear nueva categoría: "${filtroBusqueda}"`;
    } else {
        li.innerHTML = `➕ Crear nueva categoría...`;
    }
    
    li.addEventListener('click', () => abrirSubFormularioCategoria(filtroBusqueda.trim()));
    list.appendChild(li);
}

export function abrirSubFormularioCategoria(nombreSugerido = '', isModal = false) {
    window.isEditingCategoryModal = isModal;
    const wrapper = document.querySelector('.combobox-wrapper');
    let container = document.getElementById('categoria-form-container');
    const list = document.getElementById('categoria-list');
    
    // Crear contenedor si no existe (ya no debería ser necesario porque viene en el HTML, pero por si acaso para el modal de gestión)
    if (!container) {
        container = document.createElement('div');
        container.id = 'categoria-form-container';
        container.style.background = '#f8fafc';
        container.style.padding = '15px';
        container.style.border = '1px solid #cbd5e1';
        container.style.borderRadius = '6px';
        container.style.marginTop = '10px';
        container.style.display = 'none';
        container.style.width = '100%';
        container.innerHTML = `
            <div style="margin-bottom: 8px; font-weight: bold; color: #334155; font-size: 0.9em;">Nueva/Editar Categoría</div>
            <input type="text" id="cat-form-nombre" placeholder="Nombre exacto" required style="width: 100%; margin-bottom: 8px; padding: 6px; border: 1px solid #ccc; border-radius:4px;">
            <input type="text" id="cat-form-desc" placeholder="Descripción (Opcional)" style="width: 100%; margin-bottom: 12px; padding: 6px; border: 1px solid #ccc; border-radius:4px;">
            <div style="display: flex; gap: 8px;">
                <button type="button" id="btn-guardar-categoria" style="background: #22c55e; color: white; border: none; padding: 8px 12px; border-radius: 4px; cursor: pointer; flex: 1;">Guardar</button>
                <button type="button" id="btn-cancelar-categoria" style="background: #ef4444; color: white; border: none; padding: 8px 12px; border-radius: 4px; cursor: pointer;">Cancelar</button>
            </div>
        `;
        document.body.appendChild(container); // Anclarlo temporalmente
    }

    if (isModal) {
        const modalBody = document.querySelector('#modal-gestionar-categorias .modal-body');
        if (modalBody) modalBody.insertBefore(container, modalBody.firstChild);
    } else {
        if (wrapper) wrapper.parentNode.insertBefore(container, wrapper.nextSibling);
    }

    if (list) list.style.display = 'none';
    if (wrapper && !isModal) wrapper.style.display = 'none';
    
    document.getElementById('cat-form-nombre').value = nombreSugerido;
    document.getElementById('cat-form-desc').value = '';
    
    const editId = isModal ? window.currentEditCategoryId : document.getElementById('categoria-id').value;
    
    if (editId) {
        const catObj = categoriasCatalogo.find(c => c.id == editId);
        if (catObj) document.getElementById('cat-form-desc').value = catObj.descripcion || '';
    }
    
    if(container) container.style.display = 'block';
    
    const btnSave = document.getElementById('btn-guardar-categoria');
    const newBtnSave = btnSave.cloneNode(true);
    btnSave.parentNode.replaceChild(newBtnSave, btnSave);
    
    const btnCancel = document.getElementById('btn-cancelar-categoria');
    const newBtnCancel = btnCancel.cloneNode(true);
    btnCancel.parentNode.replaceChild(newBtnCancel, btnCancel);
    
    newBtnCancel.addEventListener('click', () => {
        if(container) container.style.display = 'none';
        if (!isModal && wrapper) wrapper.style.display = 'block';
        if (isModal) window.currentEditCategoryId = null;
    });
        
    newBtnSave.addEventListener('click', async () => {
        const nombre = document.getElementById('cat-form-nombre').value.trim();
        const descripcion = document.getElementById('cat-form-desc').value.trim();
        if (!nombre) {
            alert('El nombre de la categoría es obligatorio');
            return;
        }
        
        try {
            const isEdit = isModal ? window.currentEditCategoryId : editId;
            const url = isEdit ? `/api/produccion/categorias/${isEdit}` : '/api/produccion/categorias';
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
            
            await cargarCategorias();
            
            if(container) container.style.display = 'none';
            
            if (!isModal && wrapper) {
                wrapper.style.display = 'block';
                document.getElementById('categoria-input').value = savedCat.nombre;
                document.getElementById('categoria-id').value = savedCat.id;
                const btnEdit = document.getElementById('btn-edit-categoria');
                if (btnEdit) btnEdit.style.display = 'block';
            }
            
            if (isModal && typeof window.renderizarTablaCategorias === 'function') {
                window.renderizarTablaCategorias();
            }
        } catch (error) {
            alert(error.message);
        }
    });
}

function configurarCierreModal() {
    const modal = document.getElementById('modal-ingrediente');
    const closeBtn = modal.querySelector('.close-modal');
    
    const closeHandler = () => {
        modal.style.display = 'none';
        document.getElementById('form-ingrediente').reset();
        document.getElementById('categoria-id').value = '';
        const btnEdit = document.getElementById('btn-edit-categoria');
        if (btnEdit) btnEdit.style.display = 'none';
        // Dispatch event para notificar a la vista anfitriona si lo necesita
        window.dispatchEvent(new Event('modal-ingrediente-cerrado'));
    };

    if (closeBtn) {
        closeBtn.replaceWith(closeBtn.cloneNode(true));
        modal.querySelector('.close-modal').addEventListener('click', closeHandler);
    }
}

function configurarSubmitFormulario() {
    const form = document.getElementById('form-ingrediente');
    if (!form) return;
    
    // Remover listeners anteriores
    const newForm = form.cloneNode(true);
    form.parentNode.replaceChild(newForm, form);

    newForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        
        const id = document.getElementById('ingrediente-id').value;
        const ingrediente = {
            nombre: document.getElementById('nombre').value,
            unidad_medida: document.getElementById('unidad-medida').value,
            categoria_id: document.getElementById('categoria-id').value || null, // Opcional
            stock_actual: parseFloat(document.getElementById('stock').value),
            sector_id: document.getElementById('sector').value || null,
            descripcion: document.getElementById('descripcion').value
        };

        try {
            const url = id ? `/api/produccion/ingredientes/${id}` : '/api/produccion/ingredientes';
            const method = id ? 'PUT' : 'POST';

            const response = await fetch(url, {
                method: method,
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(ingrediente)
            });

            if (!response.ok) {
                const error = await response.json();
                throw new Error(error.error || 'Error al guardar');
            }

            const data = await response.json();
            
            document.getElementById('modal-ingrediente').style.display = 'none';
            newForm.reset();
            
            // Callback para la vista anfitriona
            if (onSuccessCallbackGlobal) {
                onSuccessCallbackGlobal(data);
            }

        } catch (error) {
            console.error('Error al guardar ingrediente:', error);
            alert('Error: ' + error.message);
        }
    });
}

export async function abrirModalNuevoIngrediente() {
    const modal = document.getElementById('modal-ingrediente');
    const modalTitulo = document.getElementById('modal-titulo');
    if (modalTitulo) modalTitulo.textContent = 'Nuevo Ingrediente';
    
    document.getElementById('form-ingrediente').reset();
    document.getElementById('ingrediente-id').value = '';
    document.getElementById('categoria-id').value = '';
    const btnEdit = document.getElementById('btn-edit-categoria');
    if (btnEdit) btnEdit.style.display = 'none';

    try {
        const response = await fetch('http://localhost:3002/api/produccion/ingredientes/nuevo-codigo');
        if (response.ok) {
            const data = await response.json();
            document.getElementById('codigo').value = data.codigo;
        }
    } catch (error) {
        console.error('Error al obtener nuevo código:', error);
    }
    
    if (modal) {
        modal.style.display = 'flex'; // Usar flex para consistencia
        modal.style.alignItems = 'center';
        modal.style.justifyContent = 'center';
        modal.style.zIndex = '10050';
        modal.style.opacity = '1';
        modal.style.visibility = 'visible';
        modal.style.pointerEvents = 'auto';
        modal.style.backgroundColor = 'rgba(0,0,0,0.6)';
    }
}
