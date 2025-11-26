import { mostrarError } from './utils.js';

let mixActual = null;
let ingredienteSeleccionadoId = null;
let todosLosIngredientes = []; // Cache para la lista de ingredientes

// Helper para normalizar texto (ignora acentos y mayúsculas)
function normalizar(texto) {
    if (!texto) return '';
    return texto
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .toLowerCase();
}

/**
 * Muestra el modal para editar la composición de un mix
 * @param {number} mixId - ID del mix a editar
 */
export async function mostrarModalEditarMix(mixId) {
    try {
        mixActual = mixId;
        ingredienteSeleccionadoId = null; // Resetear selección
        
        const response = await fetch(`http://localhost:3002/api/produccion/ingredientes/${mixId}/composicion`);
        if (!response.ok) throw new Error('No se pudo obtener la composición del mix');
        const data = await response.json();
        
        let modal = document.getElementById('modal-editar-mix');
        if (!modal) {
            modal = document.createElement('div');
            modal.id = 'modal-editar-mix';
            modal.className = 'modal';
            document.body.appendChild(modal);
        }

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
                        <input type="text" id="buscar-ingrediente-mix" placeholder="Buscar ingrediente..." autocomplete="off">
                        <ul id="lista-resultados-mix" class="lista-resultados-busqueda"></ul>
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

        modal.style.display = 'block';

        const span = modal.querySelector('.close');
        span.onclick = () => {
            modal.style.display = 'none';
            mixActual = null;
        };

        window.onclick = (event) => {
            if (event.target === modal) {
                modal.style.display = 'none';
                mixActual = null;
            }
        };

        // Cargar ingredientes a la caché y configurar búsqueda
        await cargarYConfigurarBusqueda();

    } catch (error) {
        console.error('Error al mostrar modal:', error);
        mostrarError('No se pudo abrir el editor del mix');
    }
}

/**
 * Carga los ingredientes en caché y añade el listener al input de búsqueda.
 */
async function cargarYConfigurarBusqueda() {
    try {
        const response = await fetch('http://localhost:3002/api/produccion/ingredientes');
        if (!response.ok) throw new Error('No se pudieron cargar los ingredientes');
        
        const ingredientes = await response.json();
        // Filtrar ingredientes que no son mix para evitar ciclos y guardar en caché
        todosLosIngredientes = ingredientes.filter(ing => ing.categoria !== 'Mix');
        
        const inputBusqueda = document.getElementById('buscar-ingrediente-mix');
        if(inputBusqueda) {
            inputBusqueda.addEventListener('input', manejarBusquedaMix);
        }
            
    } catch (error) {
        console.error('Error al cargar ingredientes:', error);
        mostrarError('No se pudieron cargar los ingredientes disponibles');
    }
}

/**
 * Maneja el filtrado y la visualización de resultados de búsqueda de ingredientes.
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

    const resultados = todosLosIngredientes.filter(ing => {
        const nombreNormalizado = normalizar(ing.nombre);
        return tokens.every(token => nombreNormalizado.includes(token));
    });

    listaResultados.innerHTML = '';
    if (resultados.length > 0) {
        resultados.forEach(ing => {
            const li = document.createElement('li');
            const stock = parseFloat(ing.stock_actual || 0).toFixed(2);
            li.textContent = `${ing.nombre} - Stock: ${stock}`;
            li.dataset.id = ing.id;
            
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
        
        await mostrarModalEditarMix(mixId);
        
        if (window.actualizarResumenIngredientes) {
            await window.actualizarResumenIngredientes();
        }

    } catch (error) {
        console.error('Error al eliminar ingrediente:', error);
        mostrarError('No se pudo eliminar el ingrediente');
    }
};

window.agregarIngredienteAMix = async (mixId) => {
    const inputCantidad = document.getElementById('cantidad-ingrediente');
    
    const cantidad = parseFloat(inputCantidad.value.replace(',', '.'));

    if (!ingredienteSeleccionadoId) {
        mostrarError('Seleccioná un ingrediente de la lista');
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
                ingrediente_id: ingredienteSeleccionadoId,
                cantidad: cantidad
            })
        });

        if (!response.ok) throw new Error('No se pudo agregar el ingrediente');
        
        await mostrarModalEditarMix(mixId);
        
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

    .modal input[type="number"], .modal input[type="text"] {
        width: 120px;
        padding: 4px;
    }
    
    .agregar-ingrediente {
        position: relative; /* Para el posicionamiento de la lista de resultados */
        margin-top: 20px;
        padding-top: 20px;
        border-top: 1px solid #ddd;
    }

    .lista-resultados-busqueda {
        list-style-type: none;
        padding: 0;
        margin: 0;
        border: 1px solid #ddd;
        display: none; /* Oculta por defecto */
        position: absolute;
        background-color: white;
        width: 300px; /* Ancho similar al del input */
        max-height: 200px;
        overflow-y: auto;
        z-index: 1001; /* Encima de otros elementos del modal */
    }

    .lista-resultados-busqueda li {
        padding: 8px 12px;
        cursor: pointer;
    }

    .lista-resultados-busqueda li:hover {
        background-color: #f1f1f1;
    }

    .modal button {
        padding: 4px 8px;
        margin: 0 4px;
    }
`;
document.head.appendChild(style);
