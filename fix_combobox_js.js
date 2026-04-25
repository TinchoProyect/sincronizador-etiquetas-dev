const fs = require('fs');
const path = require('path');

const filePath = path.join(__dirname, 'src/produccion/js/ingredientes.js');
let content = fs.readFileSync(filePath, 'utf8');

const missingLogic = `
// ==========================================
// LÓGICA DEL COMBOBOX DE CATEGORÍAS (INYECTADO)
// ==========================================

async function cargarCategorias() {
    try {
        const response = await fetch('/api/produccion/categorias');
        if (!response.ok) throw new Error('Error al cargar categorías');
        categoriasCatalogo = await response.json();
    } catch (error) {
        console.error('Error cargando categorías:', error);
        mostrarMensaje('Error al cargar el catálogo de categorías', 'error');
    }
}

function inicializarComboboxCategorias() {
    const input = document.getElementById('categoria-input');
    const hiddenId = document.getElementById('categoria-id');
    const list = document.getElementById('categoria-list');
    const btnEdit = document.getElementById('btn-edit-categoria');

    if (!input || !list || !hiddenId) return;

    // Precargar valor si estamos editando
    if (ingredienteEditando) {
        hiddenId.value = ingredienteEditando.categoria_id || '';
        input.value = ingredienteEditando.categoria_nombre || ingredienteEditando.categoria || '';
        if (hiddenId.value) btnEdit.style.display = 'block';
    }

    input.addEventListener('focus', () => {
        renderizarComboboxCategorias(categoriasCatalogo);
        list.style.display = 'block';
    });

    input.addEventListener('input', (e) => {
        const val = e.target.value.toLowerCase();
        // Si el usuario borra o cambia el texto, limpiar el ID oculto
        hiddenId.value = '';
        btnEdit.style.display = 'none';
        
        const filtradas = categoriasCatalogo.filter(c => c.nombre.toLowerCase().includes(val));
        renderizarComboboxCategorias(filtradas, val);
        list.style.display = 'block';
    });

    // Cerrar lista al hacer click fuera
    document.addEventListener('click', (e) => {
        if (!e.target.closest('.combobox-wrapper')) {
            list.style.display = 'none';
        }
    });
}

function renderizarComboboxCategorias(categorias, filtroBusqueda = '') {
    const list = document.getElementById('categoria-list');
    list.innerHTML = '';

    if (categorias.length === 0 && filtroBusqueda.trim() !== '') {
        const li = document.createElement('li');
        li.style.padding = '8px 12px';
        li.style.color = '#0275d8';
        li.style.cursor = 'pointer';
        li.style.fontWeight = 'bold';
        li.innerHTML = \`+ Crear nueva categoría: "\${filtroBusqueda}"\`;
        li.addEventListener('click', () => abrirSubFormularioCategoria(filtroBusqueda));
        list.appendChild(li);
        return;
    }

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
            document.getElementById('btn-edit-categoria').style.display = 'block';
            list.style.display = 'none';
        });
        list.appendChild(li);
    });
}

function abrirSubFormularioCategoria(nombreSugerido = '') {
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
}

function restaurarComboboxOriginal() {
    const wrapper = document.querySelector('.combobox-wrapper');
    wrapper.innerHTML = \`
        <input type="text" id="categoria-input" placeholder="Buscar o crear categoría..." autocomplete="off" required>
        <input type="hidden" id="categoria-id">
        <button type="button" id="btn-edit-categoria" style="display: none; position: absolute; right: 10px; top: 50%; transform: translateY(-50%); border: none; background: none; cursor: pointer; color: #64748b;" title="Editar categoría">✏️</button>
        <ul id="categoria-list" class="combobox-list" style="display: none; position: absolute; top: 100%; left: 0; width: 100%; background: white; border: 1px solid #cbd5e1; border-top: none; z-index: 1000; list-style: none; padding: 0; margin: 0; max-height: 200px; overflow-y: auto; box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.1);"></ul>
    \`;
    inicializarComboboxCategorias();
}
`;

// Evitar inyectarlo dos veces
if (!content.includes('function renderizarComboboxCategorias')) {
    // Insertarlo antes de DOMContentLoaded
    const targetStr = "document.addEventListener('DOMContentLoaded'";
    const idx = content.indexOf(targetStr);
    
    if (idx !== -1) {
        content = content.substring(0, idx) + missingLogic + '\\n\\n' + content.substring(idx);
        fs.writeFileSync(filePath, content, 'utf8');
        console.log('✅ Lógica de combobox inyectada exitosamente');
    } else {
        // Fallback
        content += '\\n' + missingLogic;
        fs.writeFileSync(filePath, content, 'utf8');
        console.log('✅ Lógica de combobox añadida al final del archivo');
    }
} else {
    console.log('⚠️ La lógica ya estaba presente');
}
