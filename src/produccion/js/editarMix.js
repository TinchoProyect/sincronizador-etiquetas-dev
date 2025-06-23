import { mostrarError } from './utils.js';

let mixActual = null;

/**
 * Muestra el modal para editar la composición de un mix
 * @param {number} mixId - ID del mix a editar
 */
export async function mostrarModalEditarMix(mixId) {
    try {
        mixActual = mixId;
        
        // Obtener la composición actual del mix
        const response = await fetch(`http://localhost:3002/api/produccion/ingredientes/${mixId}/composicion`);
        if (!response.ok) throw new Error('No se pudo obtener la composición del mix');
        const data = await response.json();
        
        // Crear el modal si no existe
        let modal = document.getElementById('modal-editar-mix');
        if (!modal) {
            modal = document.createElement('div');
            modal.id = 'modal-editar-mix';
            modal.className = 'modal';
            document.body.appendChild(modal);
        }

        // Contenido del modal
        modal.innerHTML = `
            <div class="modal-content">
                <div class="modal-header">
                    <h2>Editar composición de ${data.mix.nombre}</h2>
                    <span class="close">&times;</span>
                </div>
                <div class="modal-body">
                    <div class="composicion-actual">
                        <h3>Composición actual</h3>
                        <table>
                            <thead>
                                <tr>
                                    <th>Ingrediente</th>
                                    <th>Cantidad</th>
                                    <th>Unidad</th>
                                    <th>Acciones</th>
                                </tr>
                            </thead>
                            <tbody>
                                ${data.composicion.map(ing => `
                                    <tr>
                                        <td>${ing.nombre_ingrediente}</td>
                                        <td>
                                            <input type="number" 
                                                   value="${ing.cantidad}" 
                                                   min="0.01" 
                                                   step="0.01"
                                                   onchange="editarCantidadIngrediente(${mixId}, ${ing.ingrediente_id}, this.value)">
                                        </td>
                                        <td>${ing.unidad_medida}</td>
                                        <td>
                                            <button onclick="eliminarIngredienteDeMix(${mixId}, ${ing.ingrediente_id})">
                                                🗑️
                                            </button>
                                        </td>
                                    </tr>
                                `).join('')}
                            </tbody>
                        </table>
                    </div>
                    <div class="agregar-ingrediente">
                        <h3>Agregar ingrediente</h3>
                        <select id="select-ingrediente">
                            <option value="">Seleccionar ingrediente...</option>
                        </select>
                        <input type="number" 
                               id="cantidad-ingrediente" 
                               placeholder="Cantidad"
                               min="0.01"
                               step="0.01">
                        <button onclick="agregarIngredienteAMix(${mixId})">Agregar</button>
                    </div>
                </div>
            </div>
        `;

        // Mostrar el modal
        modal.style.display = 'block';

        // Manejar cierre del modal
        const span = modal.querySelector('.close');
        span.onclick = () => {
            modal.style.display = 'none';
            mixActual = null;
        };

        // Cerrar al hacer clic fuera del modal
        window.onclick = (event) => {
            if (event.target === modal) {
                modal.style.display = 'none';
                mixActual = null;
            }
        };

        // Cargar lista de ingredientes disponibles
        await cargarIngredientesDisponibles();

    } catch (error) {
        console.error('Error al mostrar modal:', error);
        mostrarError('No se pudo abrir el editor del mix');
    }
}

/**
 * Carga la lista de ingredientes disponibles para agregar al mix
 */
async function cargarIngredientesDisponibles() {
    try {
        const response = await fetch('http://localhost:3002/api/produccion/ingredientes');
        if (!response.ok) throw new Error('No se pudieron cargar los ingredientes');
        
        const ingredientes = await response.json();
        const select = document.getElementById('select-ingrediente');
        
        // Filtrar ingredientes que no son mix para evitar ciclos
        const ingredientesFiltrados = ingredientes.filter(ing => ing.categoria !== 'Mix');
        
        select.innerHTML = '<option value="">Seleccionar ingrediente...</option>' +
            ingredientesFiltrados.map(ing => 
                `<option value="${ing.id}">${ing.nombre} (${ing.unidad_medida})</option>`
            ).join('');
            
    } catch (error) {
        console.error('Error al cargar ingredientes:', error);
        mostrarError('No se pudieron cargar los ingredientes disponibles');
    }
}

// Funciones globales para los botones del modal
window.editarCantidadIngrediente = async (mixId, ingredienteId, nuevaCantidad) => {
    try {
        const response = await fetch(`http://localhost:3002/api/produccion/ingredientes/${mixId}/composicion/${ingredienteId}`, {
            method: 'PUT',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ cantidad: parseFloat(nuevaCantidad.replace(',', '.')) })
        });

        if (!response.ok) throw new Error('No se pudo actualizar la cantidad');
        
        // Actualizar la vista del carro si el mix está siendo usado
        if (window.actualizarResumenIngredientes) {
            await window.actualizarResumenIngredientes();
        }

    } catch (error) {
        console.error('Error al editar cantidad:', error);
        mostrarError('No se pudo actualizar la cantidad');
    }
};

window.eliminarIngredienteDeMix = async (mixId, ingredienteId) => {
    if (!confirm('¿Estás seguro de que querés eliminar este ingrediente del mix?')) {
        return;
    }

    try {
        const response = await fetch(`http://localhost:3002/api/produccion/ingredientes/${mixId}/composicion/${ingredienteId}`, {
            method: 'DELETE'
        });

        if (!response.ok) throw new Error('No se pudo eliminar el ingrediente');
        
        // Recargar el modal para mostrar la composición actualizada
        await mostrarModalEditarMix(mixId);
        
        // Actualizar la vista del carro si el mix está siendo usado
        if (window.actualizarResumenIngredientes) {
            await window.actualizarResumenIngredientes();
        }

    } catch (error) {
        console.error('Error al eliminar ingrediente:', error);
        mostrarError('No se pudo eliminar el ingrediente');
    }
};

window.agregarIngredienteAMix = async (mixId) => {
    const select = document.getElementById('select-ingrediente');
    const input = document.getElementById('cantidad-ingrediente');
    
    const ingredienteId = select.value;
    const cantidad = parseFloat(input.value.replace(',', '.'));

    if (!ingredienteId) {
        mostrarError('Seleccioná un ingrediente');
        return;
    }

    if (!cantidad || cantidad <= 0) {
        mostrarError('Ingresá una cantidad válida');
        return;
    }

    try {
        const response = await fetch(`http://localhost:3002/api/produccion/ingredientes/${mixId}/composicion`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                ingrediente_id: parseInt(ingredienteId),
                cantidad: cantidad
            })
        });

        if (!response.ok) throw new Error('No se pudo agregar el ingrediente');
        
        // Recargar el modal para mostrar la composición actualizada
        await mostrarModalEditarMix(mixId);
        
        // Actualizar la vista del carro si el mix está siendo usado
        if (window.actualizarResumenIngredientes) {
            await window.actualizarResumenIngredientes();
        }

    } catch (error) {
        console.error('Error al agregar ingrediente:', error);
        mostrarError('No se pudo agregar el ingrediente');
    }
};

// Estilos CSS para el modal
const style = document.createElement('style');
style.textContent = `
    .modal {
        display: none;
        position: fixed;
        z-index: 1000;
        left: 0;
        top: 0;
        width: 100%;
        height: 100%;
        background-color: rgba(0,0,0,0.4);
    }

    .modal-content {
        background-color: #fefefe;
        margin: 5% auto;
        padding: 20px;
        border: 1px solid #888;
        width: 80%;
        max-width: 800px;
        border-radius: 5px;
    }

    .close {
        color: #aaa;
        float: right;
        font-size: 28px;
        font-weight: bold;
        cursor: pointer;
    }

    .close:hover,
    .close:focus {
        color: black;
        text-decoration: none;
        cursor: pointer;
    }

    .modal table {
        width: 100%;
        border-collapse: collapse;
        margin: 10px 0;
    }

    .modal th,
    .modal td {
        padding: 8px;
        text-align: left;
        border-bottom: 1px solid #ddd;
    }

    .modal th {
        background-color: #f8f9fa;
    }

    .modal input[type="number"] {
        width: 80px;
        padding: 4px;
    }

    .modal select {
        padding: 4px;
        margin-right: 10px;
    }

    .modal button {
        padding: 4px 8px;
        margin: 0 4px;
    }

    .agregar-ingrediente {
        margin-top: 20px;
        padding-top: 20px;
        border-top: 1px solid #ddd;
    }
`;
document.head.appendChild(style);
