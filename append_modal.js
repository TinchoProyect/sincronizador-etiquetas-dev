const fs = require('fs');
const path = require('path');

const jsPath = path.join(__dirname, 'src/produccion/js/ingredientes.js');
let content = fs.readFileSync(jsPath, 'utf8');

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
    if (catIdInput) catIdInput.value = id;
    
    abrirSubFormularioCategoria(cat.nombre, true);
}

async function borrarCategoria(id) {
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

if (!content.includes('abrirModalCategorias')) {
    fs.appendFileSync(jsPath, '\\n' + modalLogic + '\\n', 'utf8');
    console.log('✅ modalLogic appended successfully');
} else {
    console.log('⚠️ modalLogic already exists');
}
