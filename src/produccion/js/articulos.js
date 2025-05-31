function toggleCantidadField() {
    const selector = document.getElementById('selector-ingrediente');
    const cantidadContainer = document.getElementById('cantidad-container');
    if (!selector || !cantidadContainer) return;

    if (selector.value) {
        cantidadContainer.style.display = 'block';
    } else {
        cantidadContainer.style.display = 'none';
        const inputCantidad = document.getElementById('input-cantidad-ingrediente');
        if (inputCantidad) inputCantidad.value = '';
    }
}

import { mostrarError } from './utils.js';
import { mostrarArticulosDelCarro } from './carro.js';

// Estado del módulo (privado)
const state = {
    todosLosArticulos: [],
    articulosFiltrados: [],
    ingredientesCargados: [], // Array temporal para almacenar ingredientes
    ultimoArticuloEditado: null // Almacena el último artículo que se editó
};

// Variable para almacenar los ingredientes cargados del backend
let ingredientesDisponibles = [];

// Función para actualizar el título de la página
export function actualizarTituloPagina() {
    try {
        const colaboradorData = localStorage.getItem('colaboradorActivo');
        if (colaboradorData) {
            const colaborador = JSON.parse(colaboradorData);
            document.title = `${colaborador.nombre} - Espacio de trabajo`;
        }
    } catch (error) {
        console.error('Error al actualizar el título:', error);
    }
}

// Función para abrir el modal de artículos
export async function abrirModalArticulos() {
    try {
        const modal = document.getElementById('modal-articulos');
        modal.style.display = 'block';
        // Agregar clase show después de un pequeño delay para activar la animación
        setTimeout(() => {
            modal.classList.add('show');
        }, 10);

        // Cargar artículos si aún no se han cargado
        if (state.todosLosArticulos.length === 0) {
            console.log('Solicitando artículos al servidor...');
            const response = await fetch('http://localhost:3002/api/produccion/articulos');
            
            if (!response.ok) {
                const errorData = await response.json();
                throw new Error(errorData.error || 'Error al obtener artículos');
            }

            const articulos = await response.json();
            console.log(`Recibidos ${articulos.length} artículos del servidor`);
            
            if (articulos.length === 0) {
                console.warn('La lista de artículos está vacía');
                mostrarError('No se encontraron artículos disponibles');
                return;
            }

            state.todosLosArticulos = articulos;
            state.articulosFiltrados = [...articulos];
            actualizarTablaArticulos(state.articulosFiltrados);
        }
    } catch (error) {
        console.error('Error al abrir modal de artículos:', error);
        mostrarError(error.message);
        // Cerrar el modal si hay error
        const modal = document.getElementById('modal-articulos');
        modal.style.display = 'none';
    }
}

// Función para cerrar el modal
export function cerrarModalArticulos() {
    const modal = document.getElementById('modal-articulos');
    modal.classList.remove('show');
    // Esperar a que termine la animación antes de ocultar
    setTimeout(() => {
        modal.style.display = 'none';
    }, 300);
    // Limpiar filtros
    document.getElementById('filtro1').value = '';
    document.getElementById('filtro2').value = '';
    document.getElementById('filtro3').value = '';
    document.getElementById('codigo-barras').value = '';
}

// Función para actualizar la tabla de artículos
export async function actualizarTablaArticulos(articulos) {
    const tbody = document.getElementById('tabla-articulos-body');
    tbody.innerHTML = '';

    if (!articulos || articulos.length === 0) {
        tbody.innerHTML = '<tr><td colspan="4" class="text-center">No hay artículos disponibles</td></tr>';
        return;
    }

    try {
        console.log('Consultando estado de recetas para artículos:', articulos.map(art => art.numero));
        
        // Obtener el estado de las recetas para todos los artículos
        const response = await fetch('http://localhost:3002/api/produccion/articulos/estado-recetas', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                articulos: articulos.map(art => art.numero)
            })
        });

        if (!response.ok) {
            const errorData = await response.json();
            throw new Error(errorData.error || 'Error al obtener estado de recetas');
        }

        const estadoRecetas = await response.json();
        console.log('Estado de recetas recibido:', estadoRecetas);

        articulos.forEach(articulo => {
            const tr = document.createElement('tr');
            const tieneReceta = estadoRecetas[articulo.numero];
            
            tr.setAttribute('data-numero', articulo.numero);
            const esArticuloEditado = articulo.numero === state.ultimoArticuloEditado;
            if (esArticuloEditado) {
                tr.classList.add('resaltado-articulo');
            }
            tr.innerHTML = `
                <td>${articulo.numero}</td>
                <td>${articulo.nombre.replace(/'/g, "\\'")}</td>
                <td>${articulo.codigo_barras || '-'}</td>
                <td>
                    ${tieneReceta ? `
                        <input type="number" class="cantidad-input" min="1" value="1">
                        <button class="btn-agregar" 
                                style="background-color: #28a745; color: white; border: none; padding: 6px 12px; border-radius: 4px;"
                                data-numero="${articulo.numero}" 
                                data-nombre="${articulo.nombre.replace(/'/g, "\\'")}">
                            Agregar al carro
                        </button>
                        <button class="btn-editar-receta"
                                style="background-color: #0275d8; color: white; border: none; padding: 6px 12px; border-radius: 4px; margin-left: 5px;"
                                data-numero="${articulo.numero}">
                            Editar receta
                        </button>
                    ` : `
                        <button class="btn-editar-receta"
                                style="background-color: #6c757d; color: white; border: none; padding: 6px 12px; border-radius: 4px;"
                                data-numero="${articulo.numero}">
                            Vincular receta
                        </button>
                    `}
                </td>
            `;
            tbody.appendChild(tr);
        });

    } catch (error) {
        console.error('Error al actualizar tabla:', error);
        // Si hay error, mostrar los botones en rojo por defecto
        articulos.forEach(articulo => {
            const tr = document.createElement('tr');
            tr.setAttribute('data-numero', articulo.numero);
            const esArticuloEditado = articulo.numero === state.ultimoArticuloEditado;
            if (esArticuloEditado) {
                tr.classList.add('resaltado-articulo');
            }
            tr.innerHTML = `
                <td>${articulo.numero}</td>
                <td>${articulo.nombre.replace(/'/g, "\\'")}</td>
                <td>${articulo.codigo_barras || '-'}</td>
                <td>
                    <input type="number" class="cantidad-input" min="1" value="1">
                    <button class="btn-agregar btn-danger" 
                            data-numero="${articulo.numero}" 
                            data-nombre="${articulo.nombre.replace(/'/g, "\\'")}">
                        Vincular receta
                    </button>
                </td>
            `;
            tbody.appendChild(tr);
        });
    }
}

// Función para aplicar filtros en cascada
export function aplicarFiltros(filtroIndex) {
    const filtro1 = document.getElementById('filtro1').value.toLowerCase();
    const filtro2 = document.getElementById('filtro2').value.toLowerCase();
    const filtro3 = document.getElementById('filtro3').value.toLowerCase();

    // Resetear filtros posteriores
    if (filtroIndex === 1) {
        document.getElementById('filtro2').value = '';
        document.getElementById('filtro3').value = '';
    } else if (filtroIndex === 2) {
        document.getElementById('filtro3').value = '';
    }

    // Aplicar filtros en cascada
    let resultados = state.todosLosArticulos;

    if (filtro1) {
        resultados = resultados.filter(art => 
            art.nombre.toLowerCase().includes(filtro1)
        );
    }

    if (filtro2) {
        resultados = resultados.filter(art => 
            art.nombre.toLowerCase().includes(filtro2)
        );
    }

    if (filtro3) {
        resultados = resultados.filter(art => 
            art.nombre.toLowerCase().includes(filtro3)
        );
    }

    state.articulosFiltrados = resultados;
    actualizarTablaArticulos(resultados);
}

// Función para buscar por código de barras
export function buscarPorCodigoBarras(codigo) {
    const articulo = state.todosLosArticulos.find(art => art.codigo_barras === codigo);
    if (articulo) {
        state.articulosFiltrados = [articulo];
        actualizarTablaArticulos(state.articulosFiltrados);
    }
}

// Función para cerrar el modal de receta
export function cerrarModalReceta() {
    const modal = document.getElementById('modal-receta');
    if (modal) {
        modal.classList.remove('show');
        setTimeout(() => {
            modal.style.display = 'none';
            // Limpiar el formulario y los ingredientes
            document.getElementById('articulo_numero').value = '';
            document.getElementById('descripcion_receta').value = '';
            document.getElementById('selector-ingrediente').value = '';
            document.getElementById('input-cantidad-ingrediente').value = '';
            state.ingredientesCargados = [];
            const tbody = document.querySelector('#tabla-ingredientes tbody');
            if (tbody) {
                // Remover event listener al cerrar
                tbody.removeEventListener('click', handleEliminarIngrediente);
                tbody.innerHTML = '';
            }
        }, 300);
    }
}

// Función para manejar la eliminación de ingredientes
function handleEliminarIngrediente(e) {
    if (e.target.classList.contains('btn-eliminar-ingrediente')) {
        const index = parseInt(e.target.dataset.index);
        if (!isNaN(index) && index >= 0 && index < state.ingredientesCargados.length) {
            state.ingredientesCargados.splice(index, 1);
            e.target.closest('tr').remove();
            // Actualizar índices de los botones restantes
            const tbody = document.querySelector('#tabla-ingredientes tbody');
            tbody.querySelectorAll('.btn-eliminar-ingrediente').forEach((btn, i) => {
                btn.dataset.index = i;
            });
        }
    }
}

// Función para agregar ingrediente a la tabla
function agregarIngredienteATabla(ingrediente, index) {
    const tbody = document.querySelector('#tabla-ingredientes tbody');
    if (!tbody) return;

    const tr = document.createElement('tr');
    tr.innerHTML = `
        <td>${ingrediente.nombre_ingrediente}</td>
        <td>${ingrediente.unidad_medida}</td>
        <td>${ingrediente.cantidad}</td>
        <td>
            <button class="btn-eliminar-ingrediente" data-index="${index ?? state.ingredientesCargados.length - 1}"
                    style="background-color: #dc3545; color: white; border: none; 
                           padding: 4px 8px; border-radius: 4px;">
                Eliminar
            </button>
        </td>
    `;
    tbody.appendChild(tr);
}

// Función para cargar ingredientes desde el backend
async function cargarIngredientesDisponibles() {
    try {
        const response = await fetch('/api/produccion/ingredientes');
        if (!response.ok) {
            throw new Error('Error al cargar ingredientes');
        }
        ingredientesDisponibles = await response.json();
        actualizarSelectorIngredientes();
    } catch (error) {
        mostrarError('No se pudieron cargar los ingredientes');
        console.error(error);
    }
}

// Función para actualizar el selector de ingredientes
function actualizarSelectorIngredientes() {
    const selector = document.getElementById('selector-ingrediente');
    selector.innerHTML = '<option value="">Seleccione un ingrediente...</option>';
    
    ingredientesDisponibles.forEach(ing => {
        selector.innerHTML += `
            <option value="${ing.id}" 
                    data-unidad="${ing.unidad_medida}">
                ${ing.nombre}
            </option>`;
    });
}

// Función para agregar ingrediente desde el selector
function agregarIngredienteDesdeSelector() {
    try {
        const selector = document.getElementById('selector-ingrediente');
        const cantidadInput = document.getElementById('input-cantidad-ingrediente');
        
        const ingredienteId = selector.value;
        const cantidad = parseFloat(cantidadInput.value);
        
        if (!ingredienteId) {
            throw new Error('Debe seleccionar un ingrediente');
        }
        
        if (isNaN(cantidad) || cantidad <= 0) {
            throw new Error('La cantidad debe ser un número mayor a 0');
        }
        
        const ingredienteSeleccionado = ingredientesDisponibles.find(i => i.id === parseInt(ingredienteId));
        
        const ingrediente = {
            ingrediente_id: ingredienteSeleccionado.id,
            nombre_ingrediente: ingredienteSeleccionado.nombre,
            unidad_medida: ingredienteSeleccionado.unidad_medida,
            cantidad: cantidad
        };
        
        state.ingredientesCargados.push(ingrediente);
        agregarIngredienteATabla(ingrediente);
        
        // Limpiar campos
        selector.value = '';
        cantidadInput.value = '';
        
    } catch (error) {
        mostrarError(error.message);
    }
}

// Función para guardar la receta
async function guardarReceta() {
    try {
        const articulo_numero = document.getElementById('articulo_numero').value.trim();
        const descripcion = document.getElementById('descripcion_receta').value;

        // Validaciones
        if (!articulo_numero) {
            throw new Error('El código de artículo es requerido');
        }

        if (state.ingredientesCargados.length === 0) {
            throw new Error('Debe agregar al menos un ingrediente a la receta');
        }

        // Preparar datos para enviar
        const datos = {
            articulo_numero,
            descripcion: descripcion,
            ingredientes: state.ingredientesCargados.map(ing => ({
                ingrediente_id: ing.ingrediente_id,
                nombre_ingrediente: ing.nombre_ingrediente,
                unidad_medida: ing.unidad_medida,
                cantidad: ing.cantidad
            }))
        };

        // Enviar al servidor
        const url = state.existeReceta
          ? `http://localhost:3002/api/produccion/recetas/${articulo_numero}`
          : 'http://localhost:3002/api/produccion/recetas';
        const method = state.existeReceta ? 'PUT' : 'POST';
        const response = await fetch(url, {
            method,

            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(datos)
        });

        if (!response.ok) {
            const errorData = await response.json();
            throw new Error(errorData.error || 'Error al guardar la receta');
        }

        // Guardar el artículo editado
        state.ultimoArticuloEditado = articulo_numero;
        
        // Actualizar tabla inmediatamente
        await actualizarTablaArticulos(state.articulosFiltrados);
        
        // Cerrar el modal
        cerrarModalReceta();

        // Buscar y resaltar el artículo editado
        const filaEditada = document.querySelector(`tr[data-numero="${articulo_numero}"]`);
        if (filaEditada) {
            filaEditada.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }

        // Mostrar mensaje de éxito
        const successDiv = document.createElement('div');
        successDiv.className = 'success-message';
        successDiv.textContent = 'Receta guardada correctamente';
        document.querySelector('.modal-content').appendChild(successDiv);
        
        // Remover el mensaje después de 3 segundos
        setTimeout(() => {
            successDiv.remove();
        }, 3000);

    } catch (error) {
        console.error('Error al guardar receta:', error);
        mostrarError(error.message);
    }
}

// Función para mostrar el modal de receta
export async function mostrarModalReceta(articulo_numero) {
    const modal = document.getElementById('modal-receta');
    if (modal) {
        try {
            // Establecer el código del artículo
            document.getElementById('articulo_numero').value = articulo_numero;
            
            // Cargar ingredientes disponibles primero
            await cargarIngredientesDisponibles();
            
            // Intentar obtener la receta existente
            try {
                const response = await fetch(`http://localhost:3002/api/produccion/recetas/${articulo_numero}`);
                
                if (response.ok) {
                    // Si la receta existe, cargar sus datos
                    const receta = await response.json();
                    document.getElementById('descripcion_receta').value = receta.descripcion || '';
                    state.ingredientesCargados = receta.ingredientes || [];
                    state.existeReceta = true;
} else if (response.status === 404) {

    // Si la receta no existe, inicializar vacía
    document.getElementById('descripcion_receta').value = '';
    state.ingredientesCargados = [];
    state.existeReceta = false;
} else {
    // Si hay otro error, lanzarlo
    throw new Error('Error al obtener la receta');
}

            } catch (error) {
                if (error.message !== 'Error al obtener la receta') {
                    console.error('Error al cargar la receta:', error);
                }
                // Si hay error que no sea 404, inicializar vacía
                document.getElementById('descripcion_receta').value = '';
                state.ingredientesCargados = [];
            }

            // Actualizar tabla de ingredientes
            const tbody = document.querySelector('#tabla-ingredientes tbody');
            if (tbody) {
                tbody.innerHTML = '';
                // Remover listener anterior si existe
                tbody.removeEventListener('click', handleEliminarIngrediente);
                // Agregar nuevo listener
                tbody.addEventListener('click', handleEliminarIngrediente);
                // Renderizar ingredientes
                state.ingredientesCargados.forEach((ingrediente, index) => {
                    agregarIngredienteATabla(ingrediente, index);
                });
            }

            // Mostrar el modal con animación
            modal.style.display = 'block';
            setTimeout(() => {
                modal.classList.add('show');
            }, 10);



            // Registrar el event listener para el botón de agregar ingrediente
            const btnAgregarIngrediente = document.getElementById('btn-agregar-ingrediente');
            if (btnAgregarIngrediente) {
                btnAgregarIngrediente.removeEventListener('click', agregarIngredienteDesdeSelector);
                btnAgregarIngrediente.addEventListener('click', agregarIngredienteDesdeSelector);
            }

            // Reconectar el event listener para el selector de ingredientes
            const selectorIngrediente = document.getElementById('selector-ingrediente');
            if (selectorIngrediente) {
                selectorIngrediente.removeEventListener('change', toggleCantidadField);
                selectorIngrediente.addEventListener('change', toggleCantidadField);
                toggleCantidadField();
            }

        } catch (error) {
            console.error('Error al preparar el modal de receta:', error);
            mostrarError('Error al preparar el formulario de receta');
            modal.style.display = 'none';
        }
    }
}

// Función para agregar artículo al carro
export async function agregarAlCarro(articulo_numero, descripcion, btnElement) {
    // Si el botón es rojo, mostrar el modal de receta en lugar de agregar al carro
    if (btnElement.classList.contains('btn-danger')) {
        mostrarModalReceta(articulo_numero);
        return;
    }

    try {
        const carroId = localStorage.getItem('carroActivo');
        if (!carroId) {
            throw new Error('No hay un carro de producción activo');
        }

        const colaboradorData = localStorage.getItem('colaboradorActivo');
        if (!colaboradorData) {
            throw new Error('No hay colaborador seleccionado');
        }

        const colaborador = JSON.parse(colaboradorData);
        const cantidadInput = btnElement.previousElementSibling;
        const cantidad = parseInt(cantidadInput.value);
        
        if (isNaN(cantidad) || cantidad <= 0) {
            throw new Error('La cantidad debe ser un número positivo');
        }

        const response = await fetch(`http://localhost:3002/api/produccion/carro/${carroId}/articulo`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                articulo_numero,
                descripcion,
                cantidad,
                usuarioId: colaborador.id
            })
        });

        if (!response.ok) {
            const errorData = await response.json();
            throw new Error(errorData.error || 'Error al agregar el artículo al carro');
        }

        // Mostrar mensaje de éxito
        const successDiv = document.createElement('div');
        successDiv.className = 'success-message';
        successDiv.textContent = 'Artículo agregado correctamente';
        document.querySelector('.modal-content').appendChild(successDiv);
        
        // Remover el mensaje después de 3 segundos
        setTimeout(() => {
            successDiv.remove();
        }, 3000);

        // Actualizar la lista de artículos en el carro
        await mostrarArticulosDelCarro();

        // Cerrar el modal después de agregar
        cerrarModalArticulos();

    } catch (error) {
        console.error('Error:', error);
        mostrarError(error.message);
    }
}

// Función para abrir el modal de nuevo ingrediente
function abrirModalNuevoIngrediente() {
    const modal = document.getElementById('modal-nuevo-ingrediente');
    if (modal) {
        modal.style.display = 'block';
        setTimeout(() => {
            modal.classList.add('show');
        }, 10);
    }
}

// Función para cerrar el modal de nuevo ingrediente
function cerrarModalNuevoIngrediente() {
    const modal = document.getElementById('modal-nuevo-ingrediente');
    if (modal) {
        modal.classList.remove('show');
        setTimeout(() => {
            modal.style.display = 'none';
            // Limpiar el formulario
            document.getElementById('nombre-ingrediente').value = '';
            document.getElementById('unidad-medida-ingrediente').value = '';
            document.getElementById('categoria-ingrediente').value = '';
            document.getElementById('stock-ingrediente').value = '';
        }, 300);
    }
}

// Función para guardar el nuevo ingrediente
async function guardarNuevoIngrediente() {
    try {
        const nombre = document.getElementById('nombre-ingrediente').value.trim();
        const unidadMedida = document.getElementById('unidad-medida-ingrediente').value;
        const categoria = document.getElementById('categoria-ingrediente').value;
        const stock = document.getElementById('stock-ingrediente').value;

        if (!nombre) {
            throw new Error('El nombre del ingrediente es requerido');
        }

        const datos = {
            nombre,
            unidad_medida: unidadMedida,
            categoria,
            stock: stock || 0
        };

        const response = await fetch('http://localhost:3002/api/produccion/ingredientes', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(datos)
        });

        if (!response.ok) {
            const errorData = await response.json();
            throw new Error(errorData.error || 'Error al guardar el ingrediente');
        }

        const nuevoIngrediente = await response.json();
        
        // Cerrar el modal
        cerrarModalNuevoIngrediente();
        
        // Actualizar la lista de ingredientes y preseleccionar el nuevo
        await cargarIngredientesDisponibles();
        
        // Seleccionar el nuevo ingrediente
        const selector = document.getElementById('selector-ingrediente');
        if (selector) {
            selector.value = nuevoIngrediente.id;
            // Disparar el evento change para que se muestre el campo de cantidad automáticamente
            selector.dispatchEvent(new Event('change'));
        }

        // Mostrar mensaje de éxito
        const successDiv = document.createElement('div');
        successDiv.className = 'success-message';
        successDiv.textContent = 'Ingrediente creado correctamente';
        document.querySelector('.modal-content').appendChild(successDiv);
        
        setTimeout(() => {
            successDiv.remove();
        }, 3000);

    } catch (error) {
        console.error('Error:', error);
        mostrarError(error.message);
    }
}

// Event Listeners
document.addEventListener('DOMContentLoaded', () => {
    const btnGuardarReceta = document.getElementById('btn-guardar-receta');
    if (btnGuardarReceta) {
        btnGuardarReceta.addEventListener('click', guardarReceta);
    }

    // Asignar el evento change y ejecutar la función inicialmente
    const selectorIngrediente = document.getElementById('selector-ingrediente');
    const cantidadContainer = document.getElementById('cantidad-container');
    if (selectorIngrediente && cantidadContainer) {
        selectorIngrediente.addEventListener('change', toggleCantidadField);
        // Asegurar el estado inicial correcto
        toggleCantidadField();
    }

    // Event listeners para el modal de nuevo ingrediente
    const btnNuevoIngrediente = document.getElementById('btn-nuevo-ingrediente');
    if (btnNuevoIngrediente) {
        btnNuevoIngrediente.addEventListener('click', abrirModalNuevoIngrediente);
    }

    const modalNuevoIngrediente = document.getElementById('modal-nuevo-ingrediente');
    if (modalNuevoIngrediente) {
        // Cerrar al hacer clic en el botón X
        const btnCerrar = modalNuevoIngrediente.querySelector('.close-modal');
        if (btnCerrar) {
            btnCerrar.addEventListener('click', cerrarModalNuevoIngrediente);
        }

        // Cerrar al hacer clic fuera del modal
        modalNuevoIngrediente.addEventListener('click', (e) => {
            if (e.target === modalNuevoIngrediente) {
                cerrarModalNuevoIngrediente();
            }
        });

        // Botón cancelar
        const btnCancelar = document.getElementById('btn-cancelar-ingrediente');
        if (btnCancelar) {
            btnCancelar.addEventListener('click', cerrarModalNuevoIngrediente);
        }

        // Botón guardar
        const btnGuardar = document.getElementById('btn-guardar-ingrediente');
        if (btnGuardar) {
            btnGuardar.addEventListener('click', guardarNuevoIngrediente);
        }
    }

    // Agregar event listener para el botón de cerrar del modal de receta
    const modalReceta = document.getElementById('modal-receta');
    if (modalReceta) {
        // Cerrar al hacer clic en el botón X
        const btnCerrar = modalReceta.querySelector('.close-modal');
        if (btnCerrar) {
            btnCerrar.addEventListener('click', cerrarModalReceta);
        }

        // Cerrar al hacer clic fuera del modal
        modalReceta.addEventListener('click', (e) => {
            if (e.target === modalReceta) {
                cerrarModalReceta();
            }
        });
    }

    // Agregar event listener para los botones de agregar al carro y editar receta
    document.addEventListener('click', async (e) => {
        if (e.target.classList.contains('btn-agregar')) {
            const articulo_numero = e.target.dataset.numero;
            const descripcion = e.target.dataset.nombre;
            await agregarAlCarro(articulo_numero, descripcion, e.target);
        } else if (e.target.classList.contains('btn-editar-receta')) {
            const articulo_numero = e.target.dataset.numero;
            mostrarModalReceta(articulo_numero);
        }
    });
});
