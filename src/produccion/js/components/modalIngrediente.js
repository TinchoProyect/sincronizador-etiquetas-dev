export const modalIngredienteHTML = `
<!-- Modal para agregar/editar ingrediente -->
<div id="modal-ingrediente" class="modal">
    <div class="modal-content card" style="width: 800px; max-width: 90vw; padding: 30px; border-radius: 12px; box-shadow: 0 10px 25px rgba(0,0,0,0.1); background-color: #ffffff;">
        <div class="modal-header" style="border-bottom: 2px solid #f1f5f9; padding-bottom: 15px; margin-bottom: 20px; display: flex; justify-content: space-between; align-items: center;">
            <h2 id="modal-titulo" style="margin: 0; color: #1e293b; font-size: 1.5rem; font-weight: 600;">Nuevo Ingrediente</h2>
            <span class="close-modal" style="font-size: 1.5rem; cursor: pointer; color: #64748b; transition: color 0.2s;">&times;</span>
        </div>
        <form id="form-ingrediente" style="display: flex; flex-direction: column; gap: 20px;">
            <input type="hidden" id="ingrediente-id">
            
            <div style="display: grid; grid-template-columns: repeat(3, 1fr); gap: 25px;">
                <!-- Columna 1: Identificación -->
                <div style="display: flex; flex-direction: column; gap: 15px;">
                    <div class="form-group" style="margin: 0;">
                        <label for="codigo" style="font-weight: 500; color: #475569; margin-bottom: 5px; display: block;">Código</label>
                        <input type="text" id="codigo" readonly style="width: 100%; padding: 10px; border: 1px solid #e2e8f0; border-radius: 6px; background-color: #f8fafc; color: #64748b;">
                    </div>
                    
                    <div class="form-group" style="margin: 0;">
                        <label for="nombre" style="font-weight: 500; color: #475569; margin-bottom: 5px; display: block;">Nombre <span style="color: #ef4444;">*</span></label>
                        <input type="text" id="nombre" required style="width: 100%; padding: 10px; border: 1px solid #cbd5e1; border-radius: 6px; transition: border-color 0.2s;">
                    </div>
                </div>

                <!-- Columna 2: Cuantitativo -->
                <div style="display: flex; flex-direction: column; gap: 15px;">
                    <div class="form-group" style="margin: 0;">
                        <label for="stock" style="font-weight: 500; color: #475569; margin-bottom: 5px; display: block;">Stock <span style="color: #ef4444;">*</span></label>
                        <input type="number" id="stock" step="0.01" min="0" required style="width: 100%; padding: 10px; border: 1px solid #cbd5e1; border-radius: 6px;">
                    </div>

                    <div class="form-group" style="margin: 0;">
                        <label for="unidad-medida" style="font-weight: 500; color: #475569; margin-bottom: 5px; display: block;">Unidad <span style="color: #ef4444;">*</span></label>
                        <input type="text" id="unidad-medida" placeholder="Ej: kilo" required style="width: 100%; padding: 10px; border: 1px solid #cbd5e1; border-radius: 6px;">
                    </div>
                </div>

                <!-- Columna 3: Clasificación -->
                <div style="display: flex; flex-direction: column; gap: 15px;">
                    <div class="form-group" style="margin: 0;">
                        <label for="sector" style="font-weight: 500; color: #475569; margin-bottom: 5px; display: block;">Sector</label>
                        <select id="sector" style="width: 100%; padding: 10px; border: 1px solid #cbd5e1; border-radius: 6px; background-color: white;">
                            <option value="">Sin sector asignado</option>
                        </select>
                    </div>

                    <div class="form-group" style="margin: 0; position: relative;">
                        <label for="categoria-input" style="font-weight: 500; color: #475569; margin-bottom: 5px; display: block;">Categoría <span style="color: #ef4444;">*</span></label>
                        <div class="combobox-wrapper" style="position: relative; display: flex; gap: 10px; align-items: stretch; height: 42px;">
                            <select id="categoria-input" name="categoria" class="categoria-input" required style="flex: 1; padding: 10px; border: 1px solid #cbd5e1; border-radius: 6px; background-color: white; color: #1e293b; font-size: 1rem; appearance: auto;">
                                <option value="">Seleccione una categoría...</option>
                            </select>
                            <input type="hidden" id="categoria-id" name="categoria_id">
                            <button type="button" class="btn-agregar-categoria" onclick="window.abrirSubFormularioCategoria('', false)" style="padding: 0 15px; background: #e0f2fe; color: #0284c7; border: 1px solid #bae6fd; border-radius: 6px; cursor: pointer; white-space: nowrap; font-weight: 500; height: 100%; transition: background-color 0.2s;" title="Nueva Categoría">+ Nueva</button>
                            <button type="button" id="btn-edit-categoria" style="display: none; padding: 0 10px; background: none; border: none; cursor: pointer; color: #64748b; font-size: 1.1em; transition: color 0.2s;" title="Editar categoría">✏️</button>
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
                            <div style="display: flex; gap: 10px; justify-content: flex-end; position: relative; z-index: 10002;">
                                <button type="button" id="btn-cancelar-categoria" style="padding: 6px 12px; background: white; border: 1px solid #cbd5e1; border-radius: 4px; cursor: pointer; font-size: 0.85rem; pointer-events: auto;">Cancelar</button>
                                <button type="button" id="btn-guardar-categoria" style="padding: 6px 12px; background: #3b82f6; color: white; border: none; border-radius: 4px; cursor: pointer; font-size: 0.85rem; font-weight: 500; pointer-events: auto;">Guardar</button>
                            </div>
                        </div>
                    </div>
                </div>
            </div>

            <!-- Fila 4: Descripción (Ancho completo) -->
            <div class="form-group" style="margin: 0; width: 100%;">
                <label for="descripcion" style="font-weight: 500; color: #475569; margin-bottom: 5px; display: block;">Descripción General</label>
                <textarea id="descripcion" rows="3" style="width: 100%; padding: 10px; border: 1px solid #cbd5e1; border-radius: 6px; resize: vertical;"></textarea>
            </div>

            <!-- Botones de Acción (Formulario Principal) -->
            <div class="form-actions" style="display: flex; justify-content: flex-end; gap: 15px; margin-top: 20px; padding-top: 20px; border-top: 1px solid #e2e8f0; position: relative; z-index: 100;">
                <button type="submit" class="btn btn-success" style="padding: 10px 20px; background: #10b981; color: white; border: none; border-radius: 6px; cursor: pointer; font-weight: 500; box-shadow: 0 4px 6px -1px rgba(16, 185, 129, 0.2); transition: all 0.2s; pointer-events: auto;">Guardar Ingrediente</button>
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
    const select = document.getElementById('categoria-input');
    const hiddenId = document.getElementById('categoria-id');
    const btnEdit = document.getElementById('btn-edit-categoria');

    if (!select || !hiddenId) {
        console.error('❌ [modalIngrediente] No se encontraron elementos del select de categorías en el DOM.');
        return;
    }

    if (select.dataset.inicializado === 'true') {
        console.log('✅ [modalIngrediente] Select de categorías ya estaba inicializado.');
        return;
    }
    select.dataset.inicializado = 'true';

    console.log('🔧 [modalIngrediente] Inicializando select de categorías (Opción A Nativa)...');
    
    // Poblar select con categoríasCatalogo
    select.innerHTML = '<option value="">Seleccione una categoría...</option>';
    categoriasCatalogo.forEach(cat => {
        const option = document.createElement('option');
        option.value = cat.nombre; // El value es el nombre por compatibilidad legacy
        option.dataset.id = cat.id; // Guardamos el ID en un dataset
        option.textContent = cat.nombre;
        select.appendChild(option);
    });

    // Evento change para reflejar el ID y mostrar el botón editar
    select.addEventListener('change', () => {
        const selectedOption = select.options[select.selectedIndex];
        if (selectedOption && selectedOption.value !== "") {
            hiddenId.value = selectedOption.dataset.id;
            if (btnEdit) btnEdit.style.display = 'block';
        } else {
            hiddenId.value = '';
            if (btnEdit) btnEdit.style.display = 'none';
        }
    });

    if (btnEdit) {
        const newBtnEdit = btnEdit.cloneNode(true);
        btnEdit.parentNode.replaceChild(newBtnEdit, btnEdit);
        newBtnEdit.addEventListener('click', () => {
            abrirSubFormularioCategoria(select.value);
        });
    }
}

export function abrirSubFormularioCategoria(nombreSugerido = '', isModal = false) {
    window.isEditingCategoryModal = isModal;
    const wrapper = document.querySelector('.combobox-wrapper');
    let container = document.getElementById('categoria-form-container');
    const list = document.getElementById('lista-categorias-resultados');
    
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

    // El contenedor dropdown custom ya no existe (Option A Nativa)
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
        if (!isModal && wrapper) wrapper.style.display = 'flex';
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
                wrapper.style.display = 'flex';
                const select = document.getElementById('categoria-input');
                // Agregar la nueva categoría al select si no existe
                if (!Array.from(select.options).some(opt => opt.value === savedCat.nombre)) {
                    const newOpt = document.createElement('option');
                    newOpt.value = savedCat.nombre;
                    newOpt.dataset.id = savedCat.id;
                    newOpt.textContent = savedCat.nombre;
                    select.appendChild(newOpt);
                }
                select.value = savedCat.nombre;
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
    const closeBtns = modal.querySelectorAll('.close-modal');
    
    const closeHandler = () => {
        modal.style.display = 'none';
        modal.style.opacity = '0';
        modal.style.visibility = 'hidden';
        modal.style.pointerEvents = 'none';
        modal.style.zIndex = '-1';
        
        document.getElementById('form-ingrediente').reset();
        document.getElementById('categoria-id').value = '';
        const btnEdit = document.getElementById('btn-edit-categoria');
        if (btnEdit) btnEdit.style.display = 'none';
        // Dispatch event para notificar a la vista anfitriona si lo necesita
        window.dispatchEvent(new Event('modal-ingrediente-cerrado'));
    };

    closeBtns.forEach(btn => {
        // Remover listeners anteriores reemplazando el nodo
        const newBtn = btn.cloneNode(true);
        btn.parentNode.replaceChild(newBtn, btn);
        newBtn.addEventListener('click', closeHandler);
    });
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
        const response = await fetch('/api/produccion/ingredientes/nuevo-codigo');
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

// Exportar funciones globales para el auditor
window.abrirModalNuevoIngrediente = abrirModalNuevoIngrediente;
window.inicializarModalIngrediente = inicializarModalIngrediente;

/*
=============================================================================
SCRIPT VIGÍA DEPURADOR - TICKET #028
=============================================================================
Ejecutar este script en la consola del navegador para auditar empíricamente
el estado de inyección, binding y conectividad del Combobox de Categorías.

(async function auditarComboboxCategorias() {
    console.log('%c[VIGÍA] Iniciando Auditoría de Categorías...', 'color: #3b82f6; font-weight: bold;');
    
    // 1. Validar DOM
    const input = document.getElementById('categoria-input');
    if (!input) {
        console.error('❌ DOM FAIL: El input de categoría no existe. ¿El modal fue inyectado?');
        return;
    }
    console.log('✅ DOM OK: Input de categoría encontrado.');

    // 2. Verificar Event Listener (Binding)
    const inicializado = input.dataset.inicializado === 'true';
    if (!inicializado) {
        console.warn('⚠️ BINDING WARN: El dataset.inicializado no es true. Los eventos de búsqueda podrían no estar atachados.');
    } else {
        console.log('✅ BINDING OK: El input reporta estar inicializado.');
    }

    // 3. Simular Petición a la API (Conectividad)
    console.log('%c[VIGÍA] Solicitando categorías a /api/produccion/categorias...', 'color: #8b5cf6;');
    try {
        const t0 = performance.now();
        const resp = await fetch('/api/produccion/categorias');
        const t1 = performance.now();
        
        if (!resp.ok) {
            console.error(\`❌ API FAIL: HTTP \${resp.status} \${resp.statusText}\`);
            return;
        }
        
        const data = await resp.json();
        console.log(\`✅ API OK: \${data.length} categorías recibidas en \${Math.round(t1 - t0)}ms.\`);
        console.table(data.slice(0, 5)); // Mostrar muestra
        if(data.length > 5) console.log('... (solo mostrando las primeras 5)');
    } catch (error) {
        console.error('❌ API FATAL: Excepción de red o CORS.', error);
    }
})();
=============================================================================
*/
