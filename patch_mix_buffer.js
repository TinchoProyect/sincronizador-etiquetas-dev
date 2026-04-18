const fs = require('fs');
let js = fs.readFileSync('src/produccion/js/mix.js', 'utf8');

const regexViejo = /\/\/ Funciones expuestas globalmente para onclick[\s\S]*/;

const newBufferingLogic = `
// ==========================================
// STATE MANAGEMENT Y BUFFERING (UX FIX)
// ==========================================
let composicionVisual = [];
let pendientesApi = [];

function renderizarTablaMix(mixId) {
    const modal = document.getElementById('modal-mix');
    const tbody = modal.querySelector('#tabla-mix-ingredientes-body');
    if (!tbody) return;

    tbody.innerHTML = composicionVisual.map(item => \`
        <tr>
            <td style="padding: 12px; font-weight: 500;">\${item.nombre_ingrediente}</td>
            <td style="padding: 12px;">\${item.cantidad} \${item.unidad_medida || ''}</td>
            <td style="text-align: right; padding: 12px;">
                <button 
                    onclick="window.eliminarIngredienteDeMix(\${mixId}, \${item.ingrediente_id})" 
                    class="btn-eliminar-ingrediente"
                    title="Eliminar ingrediente"
                    style="background: transparent; border: none; font-size: 1.2rem; cursor: pointer; transition: transform 0.2s;"
                    onmouseover="this.style.transform='scale(1.2)'"
                    onmouseout="this.style.transform='scale(1)'"
                >❌</button>
            </td>
        </tr>
    \`).join('');

    calcularYMostrarTotal();
    
    const btnEliminarFormula = modal.querySelector('#btn-eliminar-formula');
    if (btnEliminarFormula) {
        btnEliminarFormula.style.display = (composicionVisual && composicionVisual.length > 0) ? 'inline-block' : 'none';
    }
}

// Sobrescribimos el abrirEdicionMix original para usar el Buffer
const oldAbrir = window.abrirEdicionMix;
export async function abrirEdicionMix(mixId) {
    const modal = document.getElementById('modal-mix');
    if (!modal) return;

    // Factory default reset
    const modalContent = modal.querySelector('.modal-content');
    if (modalContent) {
        modalContent.style.position = 'absolute';
        modalContent.style.top = '50%';
        modalContent.style.left = '50%';
        modalContent.style.transform = 'translate(-50%, -50%)';
        modalContent.style.margin = '0';
    }

    mixActual = mixId;
    ingredienteSeleccionadoId = null;
    pendientesApi = []; // RESET BUFFER
    composicionVisual = [];

    try {
        if (ingredientesLista.length === 0) {
            const response = await fetch('http://localhost:3002/api/produccion/ingredientes');
            if (response.ok) ingredientesLista = await response.json();
        }

        const compResponse = await fetch(\`http://localhost:3002/api/produccion/ingredientes/\${mixId}/composicion\`);
        if (compResponse.ok) {
            const data = await compResponse.json();
            composicionVisual = Array.isArray(data.composicion) ? data.composicion : [];
            
            const titulo = modal.querySelector('#modal-mix-titulo') || modal.querySelector('h5');
            if (titulo) titulo.textContent = \`Composición de: \${data.mix.nombre}\`;
        }

        renderizarTablaMix(mixId);

        const inputBusqueda = document.getElementById('buscar-ingrediente-mix');
        inputBusqueda.value = '';
        inputBusqueda.removeEventListener('input', manejarBusquedaMix);
        inputBusqueda.addEventListener('input', manejarBusquedaMix);

        const btnAgregar = modal.querySelector('#btn-agregar-a-mix');
        btnAgregar.onclick = () => agregarIngredienteAMixTemp(mixId);

        const btnGuardarMix = modal.querySelector('#btn-guardar-mix');
        btnGuardarMix.onclick = () => procesarGuardadoFinal(mixId);

        const btnEliminarFormula = modal.querySelector('#btn-eliminar-formula');
        if (btnEliminarFormula) {
            btnEliminarFormula.onclick = async () => {
                const confirmed = confirm('¿Eliminar Fórmula? Se borrará por completo la receta de este ingrediente y pasará a ser un insumo simple.');
                if (confirmed) {
                    try {
                        if (window.eliminarComposicionMix) {
                            modal.style.display = 'none';
                            await window.eliminarComposicionMix(mixId);
                        } else {
                            const response = await fetch(\`http://localhost:3002/api/produccion/ingredientes/\${mixId}/composicion\`, { method: 'DELETE' });
                            if (!response.ok) throw new Error('Error eliminando formula');
                            await fetch(\`http://localhost:3002/api/produccion/ingredientes/\${mixId}\`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ padre_id: null }) });
                            modal.style.display = 'none';
                            alert('Fórmula eliminada');
                            if (typeof window.cargarIngredientes === 'function') await window.cargarIngredientes(); else location.reload();
                        }
                    } catch (error) { alert(error.message); }
                }
            };
        }

        modal.style.display = 'flex';
        modal.style.justifyContent = 'center';
        modal.style.alignItems = 'flex-start';

        // Cierre solo con Cancelar o X (Destruye temporal)
        const closeBtns = modal.querySelectorAll('.close-modal, .close-modal-btn');
        closeBtns.forEach((b) => {
            b.onclick = () => {
                const confirmacion = pendientesApi.length > 0 ? confirm('¿Descartar cambios no guardados?') : true;
                if (confirmacion) {
                    modal.style.display = 'none';
                    pendientesApi = []; // Wipe Buffer
                }
            };
        });

    } catch (error) {
        console.error('Error al abrir edición:', error);
    }
}

// Agregar temporalmente (No toca la base de datos)
function agregarIngredienteAMixTemp(mixId) {
    const cantidadInput = document.getElementById('cantidad-ingrediente-mix');
    const cantidad = parseFloat(cantidadInput.value.replace(',', '.'));

    if (!ingredienteSeleccionadoId) {
        alert('Seleccione un ingrediente de la lista de búsqueda.');
        return;
    }
    if (!cantidad || cantidad <= 0) {
        alert('Ingrese una cantidad válida.');
        return;
    }
    
    if (composicionVisual.some(c => c.ingrediente_id === ingredienteSeleccionadoId)) {
        alert('El ingrediente ya se encuentra en la receta.');
        return;
    }

    const ingDB = ingredientesLista.find(i => i.id === ingredienteSeleccionadoId);
    if (!ingDB) return;

    // Agregar a visual
    composicionVisual.push({
        ingrediente_id: ingredienteSeleccionadoId,
        nombre_ingrediente: ingDB.nombre,
        cantidad: cantidad,
        unidad_medida: ingDB.unidad_medida || 'Kilo'
    });

    // Agregar a buffer API
    pendientesApi.push({ type: 'POST', ingredienteId: ingredienteSeleccionadoId, cantidad: cantidad });

    renderizarTablaMix(mixId);

    // Clean inputs
    cantidadInput.value = '';
    document.getElementById('buscar-ingrediente-mix').value = '';
    ingredienteSeleccionadoId = null;
}

// Eliminar temporalmente (No toca la base de datos aun)
window.eliminarIngredienteDeMix = (mixId, ingredienteId) => {
    // Remover de visual
    composicionVisual = composicionVisual.filter(c => c.ingrediente_id !== ingredienteId);

    // Modificar buffer API
    const postIndex = pendientesApi.findIndex(p => p.type === 'POST' && p.ingredienteId === ingredienteId);
    if (postIndex !== -1) {
        // Era un agregado nuevo temporal, simplemente lo deshacemos
        pendientesApi.splice(postIndex, 1);
    } else {
        // Era un ingrediente ya existente en la BD, lo encolamos para eliminación oficial
        pendientesApi.push({ type: 'DELETE', ingredienteId: ingredienteId });
    }

    renderizarTablaMix(mixId);
};

// ==========================================
// PROCESAMIENTO FINAL LOTEADO (AL GUARDAR)
// ==========================================
async function procesarGuardadoFinal(mixId) {
    const modal = document.getElementById('modal-mix');
    const btnGuardarMix = modal.querySelector('#btn-guardar-mix');
    
    if (pendientesApi.length === 0) {
        // Nada que guardar, cerramos
        modal.style.display = 'none';
        return;
    }

    btnGuardarMix.disabled = true;
    btnGuardarMix.textContent = 'Procesando...';

    try {
        for (let task of pendientesApi) {
            if (task.type === 'POST') {
                const response = await fetch(\`http://localhost:3002/api/produccion/ingredientes/\${mixId}/composicion\`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ ingrediente_id: task.ingredienteId, cantidad: task.cantidad })
                });
                if (response.ok) {
                    await fetch(\`http://localhost:3002/api/produccion/ingredientes/\${task.ingredienteId}\`, {
                        method: 'PUT',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ padre_id: mixId })
                    });
                }
            } else if (task.type === 'DELETE') {
                const response = await fetch(\`http://localhost:3002/api/produccion/ingredientes/\${mixId}/composicion/\${task.ingredienteId}\`, { 
                    method: 'DELETE' 
                });
                if (response.ok) {
                    await fetch(\`http://localhost:3002/api/produccion/ingredientes/\${task.ingredienteId}\`, {
                        method: 'PUT',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ padre_id: null })
                    });
                }
            }
        }
        
        // Finalizamos
        pendientesApi = [];
        modal.style.display = 'none';
        
        if (window.actualizarResumenIngredientes) {
            await window.actualizarResumenIngredientes();
        } else if (window.cargarIngredientes) {
            await window.cargarIngredientes();
        }

    } catch (error) {
        console.error("Error validando guardado:", error);
        alert("Ocurrió un error al guardar la composición: " + error.message);
    } finally {
        btnGuardarMix.disabled = false;
        btnGuardarMix.textContent = 'Guardar Receta';
    }
}

window.abrirEdicionMix = abrirEdicionMix;
window.actualizarEstadoMix = actualizarEstadoMix;
window.actualizarListaIngredientes = actualizarListaIngredientes;
`;

// Note: I will replace all the old logic related to window.eliminarIngredienteDeMix, agregarIngredienteAMix, guardarRecetaMix with this buffer logic.
// We chop everything starting from "// Funciones expuestas globalmente para onclick" to the EOF.
if (js.match(regexViejo)) {
    js = js.replace(regexViejo, newBufferingLogic);
    fs.writeFileSync('src/produccion/js/mix.js', js, 'utf8');
    console.log('Buffer mechanics injected successfully into mix.js');
} else {
    // If it fails to match, let's find roughly where it is
    console.log('Fallback: failed regex match');
}
