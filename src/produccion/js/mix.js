/**
 * Funciones para gestionar la composición de ingredientes (mixes)
 */

let ingredientesLista = [];
let ingredienteSeleccionadoId = null; // Variable para guardar el ID del ingrediente seleccionado en el modal
let mixActual = null;

// Helper para normalizar texto (ignora acentos y mayúsculas)
function normalizar(texto) {
    if (!texto) return '';
    return texto
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .toLowerCase();
}

export function actualizarListaIngredientes(lista) {
    ingredientesLista = lista;
}

export async function esMix(ingredienteId) {
    try {
        const response = await fetch(`http://localhost:3002/api/produccion/ingredientes/${ingredienteId}/composicion`);
        if (response.status === 404) return false;
        if (!response.ok) throw new Error('Error al verificar composición');
        const data = await response.json();
        const ingredienteResponse = await fetch(`http://localhost:3002/api/produccion/ingredientes/${ingredienteId}`);
        if (!ingredienteResponse.ok) throw new Error('Error al obtener ingrediente');
        const ingrediente = await ingredienteResponse.json();
        return (data.composicion && data.composicion.length > 0) && !ingrediente.padre_id;
    } catch (error) {
        console.error('❌ Error al verificar si es mix:', error);
        return false;
    }
}

export async function actualizarEstadoMix(ingredienteId) {
    const tr = document.querySelector(`tr[data-id="${ingredienteId}"]`);
    if (!tr) return;

    const esMixStatus = tr.querySelector('.es-mix-status');
    const btnGestionar = tr.querySelector('.btn-gestionar-composicion');

    try {
        const tieneMix = await esMix(ingredienteId);
        const ingrediente = ingredientesLista.find(i => i.id === parseInt(ingredienteId));

        if (esMixStatus) esMixStatus.textContent = tieneMix ? 'Sí' : 'No (aún)';
        if (btnGestionar && ingrediente) {
            btnGestionar.style.display = (!ingrediente.padre_id) ? 'inline-block' : 'none';
        }
    } catch (error) {
        console.error('Error al actualizar estado mix:', error);
        if (esMixStatus) esMixStatus.textContent = 'Error';
    }
}

/**
 * Maneja el filtrado y la visualización de resultados de búsqueda de ingredientes en el modal de edición de mix.
 */
function manejarBusquedaMix() {
    const input = document.getElementById('buscar-ingrediente-mix');
    const listaResultados = document.getElementById('lista-resultados-mix');
    const query = input.value.trim();

    if (query.length < 2) {
        listaResultados.innerHTML = '';
        listaResultados.style.display = 'none';
        return;
    }

    const tokens = normalizar(query).split(' ').filter(t => t.length > 0);

    const resultados = ingredientesLista.filter(ing => {
        if (ing.categoria === 'Mix' || ing.id === mixActual) return false; // Excluir mixes y el propio mix
        const nombreNormalizado = normalizar(ing.nombre);
        return tokens.every(token => nombreNormalizado.includes(token));
    });

    listaResultados.innerHTML = '';
    if (resultados.length > 0) {
        resultados.forEach(ing => {
            const li = document.createElement('li');
            const stock = parseFloat(ing.stock_actual || 0).toFixed(2);
            const sectorDisplay = ing.sector_letra ? ` [Sector ${ing.sector_letra}]` : '';
            li.textContent = `${ing.nombre} - Stock: ${stock}${sectorDisplay}`;
            li.style.padding = '10px 15px';
            li.style.borderBottom = '1px solid #f1f5f9';
            li.style.cursor = 'pointer';
            li.style.borderRadius = '6px';
            li.style.transition = 'background 0.2s';
            li.onmouseover = () => { li.style.background = '#f8fafc'; li.style.color = '#2563eb'; li.style.fontWeight = '600'; };
            li.onmouseout = () => { li.style.background = 'transparent'; li.style.color = '#1e293b'; li.style.fontWeight = '400'; };

            li.addEventListener('click', () => {
                ingredienteSeleccionadoId = ing.id;
                input.value = ing.nombre;
                listaResultados.innerHTML = '';
                listaResultados.style.display = 'none';
            });

            listaResultados.appendChild(li);
        });
        listaResultados.style.display = 'block';
    } else {
        listaResultados.innerHTML = '<li style="padding: 10px 15px; color: #94a3b8; font-style: italic; text-align: center;">No se encontraron ingredientes</li>';
        listaResultados.style.display = 'block';
    }
}

/**
 * Calcula y actualiza el total de kilos en el modal
 */
function calcularYMostrarTotal() {
    const tbody = document.querySelector('#tabla-mix-ingredientes-body');
    if (!tbody) return;

    let total = 0;
    const filas = tbody.querySelectorAll('tr');

    filas.forEach(fila => {
        const celdaCantidad = fila.querySelector('td:nth-child(2)');
        if (celdaCantidad) {
            const textoCompleto = celdaCantidad.textContent.trim();
            // Extraer solo el número (ej: "2.5 Kilo" -> 2.5)
            const cantidad = parseFloat(textoCompleto.split(' ')[0]);
            if (!isNaN(cantidad)) {
                total += cantidad;
            }
        }
    });

    const elementoTotal = document.getElementById('total-kilos-mix');
    if (elementoTotal) {
        elementoTotal.textContent = `${total.toFixed(2)} Kilo`;
    }
}

// ==========================================
// STATE MANAGEMENT Y BUFFERING (UX FIX)
// ==========================================
let composicionVisual = [];
let pendientesApi = [];

function renderizarTablaMix(mixId) {
    const modal = document.getElementById('modal-mix');
    const thead = modal.querySelector('.tabla-mix-ingredientes thead');
    const tbody = modal.querySelector('#tabla-mix-ingredientes-body');
    const tfoot = modal.querySelector('.tabla-mix-ingredientes tfoot');
    if (!tbody || !thead || !tfoot) return;

    // Determinar si los precios y valores están habilitados en el sistema (Capa Visual Condicional)
    const mostrarValores = window.mostrarValoresMonetarios || localStorage.getItem('mostrarValoresMonetarios') === 'true';

    // 1. Renderizar cabecera de la tabla dinámicamente
    if (mostrarValores) {
        thead.innerHTML = `
            <tr>
                <th style="padding: 12px; text-align: left; color: #64748b; font-weight: 600;">Ingrediente</th>
                <th style="padding: 12px; text-align: left; color: #64748b; font-weight: 600;">Cantidad</th>
                <th style="padding: 12px; text-align: right; color: #64748b; font-weight: 600;">Costo Unitario</th>
                <th style="padding: 12px; text-align: right; color: #64748b; font-weight: 600;">Subtotal</th>
                <th></th>
            </tr>
        `;
    } else {
        thead.innerHTML = `
            <tr>
                <th style="padding: 12px; text-align: left; color: #64748b; font-weight: 600;">Ingrediente</th>
                <th style="padding: 12px; text-align: left; color: #64748b; font-weight: 600;">Cantidad</th>
                <th></th>
            </tr>
        `;
    }

    // 2. Renderizar cuerpo de la tabla y calcular subtotales dinámicos
    const currencyFormatter = new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS' });
    let totalKilos = 0;
    let totalCosto = 0;

    tbody.innerHTML = composicionVisual.map(item => {
        const cantidad = parseFloat(item.cantidad) || 0;
        totalKilos += cantidad;

        if (mostrarValores) {
            const costoUnitario = parseFloat(item.costo_patron) || 0;
            const subtotal = cantidad * costoUnitario;
            totalCosto += subtotal;

            const unitLabel = item.unidad_medida ? `/${item.unidad_medida}` : '';
            return `
                <tr>
                    <td style="padding: 12px; font-weight: 500;">${item.nombre_ingrediente}</td>
                    <td style="padding: 12px;">${item.cantidad} ${item.unidad_medida || ''}</td>
                    <td style="padding: 12px; text-align: right; font-family: monospace;">${currencyFormatter.format(costoUnitario)}${unitLabel}</td>
                    <td style="padding: 12px; text-align: right; font-family: monospace; font-weight: bold; color: #166534;">${currencyFormatter.format(subtotal)}</td>
                    <td style="text-align: right; padding: 12px;">
                        <button 
                            onclick="window.eliminarIngredienteDeMix(${mixId}, ${item.ingrediente_id})" 
                            class="btn-eliminar-ingrediente"
                            title="Eliminar ingrediente"
                            style="background: transparent; border: none; font-size: 1.2rem; cursor: pointer; transition: transform 0.2s;"
                            onmouseover="this.style.transform='scale(1.2)'"
                            onmouseout="this.style.transform='scale(1)'"
                        >❌</button>
                    </td>
                </tr>
            `;
        } else {
            return `
                <tr>
                    <td style="padding: 12px; font-weight: 500;">${item.nombre_ingrediente}</td>
                    <td style="padding: 12px;">${item.cantidad} ${item.unidad_medida || ''}</td>
                    <td style="text-align: right; padding: 12px;">
                        <button 
                            onclick="window.eliminarIngredienteDeMix(${mixId}, ${item.ingrediente_id})" 
                            class="btn-eliminar-ingrediente"
                            title="Eliminar ingrediente"
                            style="background: transparent; border: none; font-size: 1.2rem; cursor: pointer; transition: transform 0.2s;"
                            onmouseover="this.style.transform='scale(1.2)'"
                            onmouseout="this.style.transform='scale(1)'"
                        >❌</button>
                    </td>
                </tr>
            `;
        }
    }).join('');

    // 3. Renderizar pie de la tabla con consolidaciones acumuladas
    if (mostrarValores) {
        tfoot.innerHTML = `
            <tr class="fila-total" style="background: #f1f5f9; border-top: 2px solid #e2e8f0;">
                <td style="padding: 12px;"><strong>TOTALES</strong></td>
                <td style="padding: 12px;"><strong id="total-kilos-mix" style="color: #3b82f6;">${totalKilos.toFixed(2)} Kilo</strong></td>
                <td style="padding: 12px; text-align: right;"><span style="font-size: 0.72rem; color: #64748b; font-weight: 600; text-transform: uppercase;">Costo Total Mix:</span></td>
                <td style="padding: 12px; text-align: right;"><strong id="total-costo-mix" style="color: #15803d; font-family: monospace; font-size: 1.05rem;">${currencyFormatter.format(totalCosto)}</strong></td>
                <td></td>
            </tr>
        `;
    } else {
        tfoot.innerHTML = `
            <tr class="fila-total" style="background: #f1f5f9; border-top: 2px solid #e2e8f0;">
                <td style="padding: 12px;"><strong>TOTAL</strong></td>
                <td style="padding: 12px;"><strong id="total-kilos-mix" style="color: #3b82f6;">${totalKilos.toFixed(2)} Kilo</strong></td>
                <td></td>
            </tr>
        `;
    }

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

        const compResponse = await fetch(`http://localhost:3002/api/produccion/ingredientes/${mixId}/composicion`);
        if (compResponse.ok) {
            const data = await compResponse.json();
            composicionVisual = Array.isArray(data.composicion) ? data.composicion : [];
            
            const titulo = modal.querySelector('#modal-mix-titulo') || modal.querySelector('h5');
            if (titulo) titulo.textContent = `Composición de: ${data.mix.nombre}`;
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
                            const response = await fetch(`http://localhost:3002/api/produccion/ingredientes/${mixId}/composicion`, { method: 'DELETE' });
                            if (!response.ok) throw new Error('Error eliminando formula');
                            await fetch(`http://localhost:3002/api/produccion/ingredientes/${mixId}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ padre_id: null }) });
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

    // Agregar a visual (preservando el costo_patron para cálculos dinámicos)
    composicionVisual.push({
        ingrediente_id: ingredienteSeleccionadoId,
        nombre_ingrediente: ingDB.nombre,
        cantidad: cantidad,
        unidad_medida: ingDB.unidad_medida || 'Kilo',
        costo_patron: parseFloat(ingDB.costo_patron || 0.00)
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
                const response = await fetch(`http://localhost:3002/api/produccion/ingredientes/${mixId}/composicion`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ ingrediente_id: task.ingredienteId, cantidad: task.cantidad })
                });
                if (response.ok) {
                    await fetch(`http://localhost:3002/api/produccion/ingredientes/${task.ingredienteId}`, {
                        method: 'PUT',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ padre_id: mixId })
                    });
                }
            } else if (task.type === 'DELETE') {
                const response = await fetch(`http://localhost:3002/api/produccion/ingredientes/${mixId}/composicion/${task.ingredienteId}`, { 
                    method: 'DELETE' 
                });
                if (response.ok) {
                    await fetch(`http://localhost:3002/api/produccion/ingredientes/${task.ingredienteId}`, {
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
