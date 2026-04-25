export const modalIngredienteHTML = `
<!-- Modal para agregar/editar ingrediente -->
<div id="modal-ingrediente" class="modal">
    <div class="modal-content">
        <div class="modal-header">
            <span class="close-modal">&times;</span>
            <h2 id="modal-titulo">Nuevo Ingrediente</h2>
        </div>
        <form id="form-ingrediente">
            <input type="hidden" id="ingrediente-id">
            <div class="form-group">
                <label for="codigo">Código:</label>
                <input type="text" id="codigo" readonly>
                <small class="form-text text-muted">Código único generado automáticamente</small>
            </div>
            <div class="form-group">
                <label for="nombre">Nombre:</label>
                <input type="text" id="nombre" required>
            </div>
            <div class="form-group">
                <label for="unidad-medida">Unidad de Medida:</label>
                <input type="text" id="unidad-medida" placeholder="Ej: kilo, unidad, ml..." required>
            </div>
            <div class="form-group">
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
            </div>
            <div class="form-group">
                <label for="stock">Stock Actual:</label>
                <input type="number" id="stock" step="0.01" min="0" required>
            </div>
            <div class="form-group">
                <label for="sector">Sector:</label>
                <select id="sector">
                    <option value="">Sin sector asignado</option>
                    <!-- Los sectores se cargarán dinámicamente aquí -->
                </select>
                <small class="form-text text-muted">Seleccione un sector para organizar el ingrediente</small>
            </div>
            <div class="form-group">
                <label for="descripcion">Descripción:</label>
                <textarea id="descripcion" rows="3"></textarea>
            </div>
            <div class="form-actions">
                <button type="submit" class="btn-agregar">Guardar</button>
                <button type="button" id="btn-imprimir" class="btn-imprimir" style="display:none;">
                    Imprimir Etiqueta
                </button>
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

    if (!input || !list || !hiddenId) return;

    if (btnEdit) {
        const newBtnEdit = btnEdit.cloneNode(true);
        btnEdit.parentNode.replaceChild(newBtnEdit, btnEdit);
        newBtnEdit.addEventListener('click', () => {
            abrirSubFormularioCategoria(input.value);
        });
    }

    input.addEventListener('focus', () => {
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

    document.addEventListener('click', (e) => {
        if (!e.target.closest('.combobox-wrapper') && !e.target.closest('#categoria-form-container')) {
            if(list) list.style.display = 'none';
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
