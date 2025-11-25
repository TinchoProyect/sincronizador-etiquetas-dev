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
            li.textContent = `${ing.nombre} - Stock: ${stock}`;
            
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
        listaResultados.innerHTML = '<li>No se encontraron ingredientes</li>';
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

export async function abrirEdicionMix(mixId) {
    const modal = document.getElementById('modal-mix');
    if (!modal) {
        console.error('❌ Modal #modal-mix no encontrado en el DOM');
        return;
    }

    mixActual = mixId;
    ingredienteSeleccionadoId = null;

    try {
        if (ingredientesLista.length === 0) {
            const response = await fetch('http://localhost:3002/api/produccion/ingredientes');
            if (!response.ok) throw new Error('No se pudieron cargar los ingredientes');
            ingredientesLista = await response.json();
        }

        const compResponse = await fetch(`http://localhost:3002/api/produccion/ingredientes/${mixId}/composicion`);
        if (!compResponse.ok) throw new Error('Error al cargar la composición del mix');
        const data = await compResponse.json();

        // Actualizar título
        const titulo = modal.querySelector('#modal-mix-titulo') || modal.querySelector('h5') || modal.querySelector('h2');
        if (titulo) {
            titulo.textContent = `Editar Composición: ${data.mix.nombre}`;
        }

        // Actualizar tabla de composición con botones de eliminar como íconos
        const tbody = modal.querySelector('#tabla-mix-ingredientes-body');
        tbody.innerHTML = data.composicion.map(item => `
            <tr>
                <td>${item.nombre_ingrediente}</td>
                <td>${item.cantidad} ${item.unidad_medida || ''}</td>
                <td>
                    <button 
                        onclick="window.eliminarIngredienteDeMix(${mixId}, ${item.ingrediente_id})" 
                        class="btn-eliminar-ingrediente"
                        title="Eliminar ingrediente"
                    >❌</button>
                </td>
            </tr>
        `).join('');

        // Calcular y mostrar el total
        calcularYMostrarTotal();

        // Configurar búsqueda
        const inputBusqueda = document.getElementById('buscar-ingrediente-mix');
        inputBusqueda.value = '';
        inputBusqueda.removeEventListener('input', manejarBusquedaMix); // Limpiar listener anterior
        inputBusqueda.addEventListener('input', manejarBusquedaMix);

        // Configurar botón de agregar
        const btnAgregar = modal.querySelector('#btn-agregar-a-mix');
        btnAgregar.onclick = () => agregarIngredienteAMix(mixId);

        // Configurar botón de guardar receta
        const btnGuardarMix = modal.querySelector('#btn-guardar-mix');
        btnGuardarMix.onclick = () => guardarRecetaMix(mixId);

        modal.style.display = 'block';
    } catch (error) {
        console.error('Error al abrir edición de mix:', error);
        alert(error.message);
    }
}

// Funciones expuestas globalmente para onclick
window.eliminarIngredienteDeMix = async (mixId, ingredienteId) => {
    if (!confirm('¿Está seguro de eliminar este ingrediente del mix?')) return;

    try {
        const response = await fetch(`http://localhost:3002/api/produccion/ingredientes/${mixId}/composicion/${ingredienteId}`, { method: 'DELETE' });
        if (!response.ok) throw new Error('No se pudo eliminar el ingrediente');
        
        const updateResponse = await fetch(`http://localhost:3002/api/produccion/ingredientes/${ingredienteId}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ padre_id: null })
        });
        if (!updateResponse.ok) throw new Error('Error al actualizar padre_id');

        abrirEdicionMix(mixId); // Recargar modal
    } catch (error) {
        alert(error.message);
    }
};

async function agregarIngredienteAMix(mixId) {
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

    try {
        const response = await fetch(`http://localhost:3002/api/produccion/ingredientes/${mixId}/composicion`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ ingrediente_id: ingredienteSeleccionadoId, cantidad })
        });
        if (!response.ok) throw new Error('No se pudo agregar el ingrediente');

        const updateResponse = await fetch(`http://localhost:3002/api/produccion/ingredientes/${ingredienteSeleccionadoId}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ padre_id: mixId })
        });
        if (!updateResponse.ok) throw new Error('Error al actualizar padre_id');

        cantidadInput.value = '';
        document.getElementById('buscar-ingrediente-mix').value = '';
        ingredienteSeleccionadoId = null;

        abrirEdicionMix(mixId);
    } catch (error) {
        alert(error.message);
    }
}

async function guardarRecetaMix(mixId) {
    const modal = document.getElementById('modal-mix');
    modal.style.display = 'none';
    
    if (window.actualizarResumenIngredientes) {
        await window.actualizarResumenIngredientes();
    }
}


// Cerrar modal al hacer clic en la X o fuera del modal
document.addEventListener('DOMContentLoaded', () => {
    const modal = document.getElementById('modal-mix');
    if (!modal) return;

    const closeButtons = modal.querySelectorAll('.close-modal');
    closeButtons.forEach(btn => {
        btn.onclick = () => modal.style.display = 'none';
    });

    window.onclick = (event) => {
        if (event.target === modal) modal.style.display = 'none';
    };
});

// Exponer funciones necesarias globalmente
window.abrirEdicionMix = abrirEdicionMix;
window.actualizarEstadoMix = actualizarEstadoMix;
window.actualizarListaIngredientes = actualizarListaIngredientes;
