const fs = require('fs');
const file = 'c:\\Users\\Martin\\Documents\\sincronizador-etiquetas - copia\\src\\produccion\\js\\ingredientes.js';
let content = fs.readFileSync(file, 'utf8');

// 1. Add categoriasCatalogo
if (!content.includes('let categoriasCatalogo = [];')) {
    content = content.replace(
        'let sectoresDisponibles = []; // Para almacenar la lista de sectores',
        'let sectoresDisponibles = []; // Para almacenar la lista de sectores\nlet categoriasCatalogo = []; // Para almacenar las categorias del combobox'
    );
}

// 2. Insert cargarCategorias
const funcCategorias = `
// Cargar categorías desde el backend
async function cargarCategorias() {
    try {
        const response = await fetch('http://localhost:3002/api/produccion/categorias');
        if (response.ok) {
            categoriasCatalogo = await response.json();
        } else {
            console.error('Error al cargar categorías');
        }
    } catch (error) {
        console.error('Error de red al cargar categorías:', error);
    }
}

// Inicializar lógica de combobox de categorías
function inicializarComboboxCategorias() {
    const input = document.getElementById('categoria-input');
    const hiddenId = document.getElementById('categoria-id');
    const list = document.getElementById('categoria-list');
    const btnEdit = document.getElementById('btn-edit-categoria');
    const formContainer = document.getElementById('categoria-form-container');
    const formNombre = document.getElementById('cat-form-nombre');
    const formDesc = document.getElementById('cat-form-desc');
    const btnGuardar = document.getElementById('btn-guardar-categoria');
    const btnCancelar = document.getElementById('btn-cancelar-categoria');
    
    let modoEdicionCategoria = false;
    let categoriaEditandoId = null;

    function renderList(filtro = '') {
        list.innerHTML = '';
        const texto = filtro.toLowerCase().trim();
        
        let coincidencias = categoriasCatalogo.filter(c => c.nombre.toLowerCase().includes(texto));
        
        // Exact match
        const exactMatch = categoriasCatalogo.find(c => c.nombre.toLowerCase() === texto);
        
        coincidencias.forEach(cat => {
            const li = document.createElement('li');
            li.textContent = cat.nombre;
            li.style.padding = '10px';
            li.style.cursor = 'pointer';
            li.style.borderBottom = '1px solid #f1f5f9';
            li.onmouseover = () => li.style.background = '#f8fafc';
            li.onmouseout = () => li.style.background = 'white';
            li.onclick = () => {
                seleccionarCategoria(cat.id, cat.nombre);
            };
            list.appendChild(li);
        });

        if (texto.length > 0 && !exactMatch) {
            const liCreate = document.createElement('li');
            liCreate.innerHTML = \`<strong>+ Crear nueva:</strong> "\${filtro}"\`;
            liCreate.style.padding = '10px';
            liCreate.style.cursor = 'pointer';
            liCreate.style.color = '#3b82f6';
            liCreate.onmouseover = () => liCreate.style.background = '#eff6ff';
            liCreate.onmouseout = () => liCreate.style.background = 'white';
            liCreate.onclick = () => {
                list.style.display = 'none';
                abrirFormularioCategoria(filtro);
            };
            list.appendChild(liCreate);
        }

        list.style.display = (coincidencias.length > 0 || (texto.length > 0 && !exactMatch)) ? 'block' : 'none';
    }

    function seleccionarCategoria(id, nombre) {
        input.value = nombre;
        hiddenId.value = id;
        list.style.display = 'none';
        btnEdit.style.display = 'block';
        formContainer.style.display = 'none';
    }

    input.addEventListener('input', (e) => {
        hiddenId.value = ''; // limpiar ID porque se editó el texto
        btnEdit.style.display = 'none';
        renderList(e.target.value);
    });

    input.addEventListener('focus', () => {
        renderList(input.value);
    });

    document.addEventListener('click', (e) => {
        if (e.target !== input && e.target !== list && !list.contains(e.target)) {
            list.style.display = 'none';
        }
    });

    btnEdit.addEventListener('click', () => {
        const id = hiddenId.value;
        const cat = categoriasCatalogo.find(c => c.id == id);
        if (cat) {
            abrirFormularioCategoria(cat.nombre, cat.descripcion, cat.id);
        }
    });

    function abrirFormularioCategoria(nombre = '', desc = '', id = null) {
        modoEdicionCategoria = !!id;
        categoriaEditandoId = id;
        formNombre.value = nombre;
        formDesc.value = desc || '';
        formContainer.style.display = 'block';
    }

    btnCancelar.addEventListener('click', () => {
        formContainer.style.display = 'none';
    });

    btnGuardar.addEventListener('click', async () => {
        const nombre = formNombre.value.trim();
        const descripcion = formDesc.value.trim();
        if (!nombre) {
            alert('El nombre es requerido');
            return;
        }

        try {
            const url = modoEdicionCategoria 
                ? \`http://localhost:3002/api/produccion/categorias/\${categoriaEditandoId}\`
                : 'http://localhost:3002/api/produccion/categorias';
            
            const method = modoEdicionCategoria ? 'PUT' : 'POST';

            const resp = await fetch(url, {
                method,
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ nombre, descripcion })
            });

            if (!resp.ok) {
                const data = await resp.json();
                throw new Error(data.error);
            }

            const catGuardada = await resp.json();
            
            // Refrescar catálogo local
            await cargarCategorias();
            
            // Seleccionar automáticamente
            seleccionarCategoria(catGuardada.id, catGuardada.nombre);

            // Refrescar filtros
            renderizarFiltrosCategorias(window.ingredientesFiltradosGlobal || ingredientesOriginales);

        } catch (error) {
            alert(error.message);
        }
    });
}
`;

if (!content.includes('async function cargarCategorias()')) {
    content = content.replace('// Función para cargar los sectores disponibles', funcCategorias + '\n// Función para cargar los sectores disponibles');
}

// 3. Inject into DOMContentLoaded
if (!content.includes('await cargarCategorias();')) {
    content = content.replace('await cargarSectores();', 'await cargarCategorias();\n        await cargarSectores();\n        inicializarComboboxCategorias();');
}

// 4. Update renderizarFiltrosCategorias
// Replace the logic to use categoriasCatalogo instead of unique extraction
const targetRenderCategorias = /function renderizarFiltrosCategorias\s*\([^)]*\)\s*{[\s\S]*?(?=function \w)/;
const replacementRenderCategorias = `function renderizarFiltrosCategorias(ingredientesAFiltrar = ingredientesOriginales) {
    const contenedor = document.getElementById('filtros-categorias-container');
    if (!contenedor) return;

    window.ingredientesFiltradosGlobal = ingredientesAFiltrar;

    // Obtener las categorías únicas de los ingredientes actuales
    const categoriasEnUso = [...new Set(
        ingredientesAFiltrar
            .map(ing => ing.categoria) // Note: backend now sends c.nombre as categoria
            .filter(cat => cat && cat.trim() !== '')
    )].sort((a, b) => a.localeCompare(b));

    contenedor.innerHTML = '';
    
    // Solo mostrar las categorías que están en uso
    categoriasEnUso.forEach(cat => {
        const btn = document.createElement('button');
        btn.className = \`btn-filtro \${filtrosActivos.has(cat) ? 'activo' : ''}\`;
        btn.textContent = cat;
        btn.onclick = () => {
            if (filtrosActivos.has(cat)) {
                filtrosActivos.delete(cat);
                btn.classList.remove('activo');
            } else {
                filtrosActivos.add(cat);
                btn.classList.add('activo');
            }
            aplicarFiltros();
        };
        contenedor.appendChild(btn);
    });
}

`;
if (content.match(targetRenderCategorias)) {
    content = content.replace(targetRenderCategorias, replacementRenderCategorias);
}

// 5. Update form submission `const datos = { ... categoria: document.getElementById('categoria').value ... }`
// The field ID is now `categoria-id`. If it's not set, they didn't pick from the list.
content = content.replace("categoria: document.getElementById('categoria').value,", "categoria_id: document.getElementById('categoria-id').value ? parseInt(document.getElementById('categoria-id').value) : null,");

// Update modal reset in `document.getElementById('btn-nuevo').addEventListener('click', ...)`
content = content.replace("document.getElementById('categoria').value = '';", "document.getElementById('categoria-input').value = '';\n        document.getElementById('categoria-id').value = '';\n        document.getElementById('btn-edit-categoria').style.display = 'none';\n        document.getElementById('categoria-form-container').style.display = 'none';");

// Update `editarIngrediente` modal open
const targetEditar = "document.getElementById('categoria').value = ingrediente.categoria || '';";
const replacementEditar = "document.getElementById('categoria-input').value = ingrediente.categoria || '';\n    document.getElementById('categoria-id').value = ingrediente.categoria_id || '';\n    document.getElementById('btn-edit-categoria').style.display = ingrediente.categoria_id ? 'block' : 'none';\n    document.getElementById('categoria-form-container').style.display = 'none';";
content = content.replace(targetEditar, replacementEditar);

fs.writeFileSync(file, content, 'utf8');
console.log('JS actualizado exitosamente');
