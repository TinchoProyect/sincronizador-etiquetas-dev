import { mostrarError } from './utils.js';
import { mostrarArticulosDelCarro } from './carro.js';

// Estado del módulo (privado)
const state = {
    todosLosArticulos: [],
    articulosFiltrados: [],
    ingredientesCargados: [], // Array temporal para almacenar ingredientes
    ultimoArticuloEditado: null // Almacena el último artículo que se editó
};

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
    modal.style.display = 'none';
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
                    <input type="number" class="cantidad-input" min="1" value="1">
                      <button class="btn-agregar${!tieneReceta ? ' btn-danger' : ''}" 
                      style="background-color: ${tieneReceta ? '#28a745' : '#6c757d'}; color: white; border: none; padding: 6px 12px; border-radius: 4px;"
                      data-numero="${articulo.numero}" 
                      data-nombre="${articulo.nombre.replace(/'/g, "\\'")}">
                       ${tieneReceta ? 'Agregar al carro' : 'Vincular receta'}
                       </button>
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
        modal.style.display = 'none';
        // Limpiar el formulario y los ingredientes
        document.getElementById('articulo_numero').value = '';
        document.getElementById('descripcion_receta').value = '';
        state.ingredientesCargados = [];
        const tbody = document.querySelector('#tabla-ingredientes tbody');
        if (tbody) tbody.innerHTML = '';
    }
}

// Función para validar los datos del ingrediente
function validarDatosIngrediente(nombre, unidad, cantidad) {
    if (!nombre || !unidad || !cantidad) {
        throw new Error('Todos los campos son obligatorios');
    }
    
    const cantidadNum = parseFloat(cantidad);
    if (isNaN(cantidadNum) || cantidadNum <= 0) {
        throw new Error('La cantidad debe ser un número mayor a 0');
    }
    
    return {
        nombre_ingrediente: nombre.trim(),
        unidad_medida: unidad.trim(),
        cantidad: cantidadNum
    };
}

// Función para agregar ingrediente a la tabla
function agregarIngredienteATabla(ingrediente) {
    const tbody = document.querySelector('#tabla-ingredientes tbody');
    if (!tbody) return;

    const tr = document.createElement('tr');
    tr.innerHTML = `
        <td>${ingrediente.nombre_ingrediente}</td>
        <td>${ingrediente.unidad_medida}</td>
        <td>${ingrediente.cantidad}</td>
    `;
    tbody.appendChild(tr);
}

// Función para manejar la carga de ingredientes
function cargarIngrediente() {
    try {
        // Solicitar datos al usuario
        const nombre = prompt('Ingrese el nombre del ingrediente:');
        if (nombre === null) return; // Usuario canceló

        const unidad = prompt('Ingrese la unidad de medida:');
        if (unidad === null) return; // Usuario canceló

        const cantidad = prompt('Ingrese la cantidad:');
        if (cantidad === null) return; // Usuario canceló

        // Validar y formatear datos
        const ingrediente = validarDatosIngrediente(nombre, unidad, cantidad);
        
        // Agregar al array temporal
        state.ingredientesCargados.push(ingrediente);
        
        // Agregar a la tabla
        agregarIngredienteATabla(ingrediente);

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
            ingredientes: state.ingredientesCargados
        };

        // Enviar al servidor
        const response = await fetch('http://localhost:3002/api/produccion/recetas', {
            method: 'POST',
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

document.addEventListener('DOMContentLoaded', () => {
    const btnCargarIngredientes = document.getElementById('btn-cargar-ingredientes');
    if (btnCargarIngredientes) {
        btnCargarIngredientes.addEventListener('click', cargarIngrediente);
    }

    const btnGuardarReceta = document.getElementById('btn-guardar-receta');
    if (btnGuardarReceta) {
        btnGuardarReceta.addEventListener('click', guardarReceta);
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

    // Agregar event listener para los botones de agregar al carro
    document.addEventListener('click', async (e) => {
        if (e.target.classList.contains('btn-agregar')) {
            const articulo_numero = e.target.dataset.numero;
            const descripcion = e.target.dataset.nombre;
            await agregarAlCarro(articulo_numero, descripcion, e.target);
        }
    });
});

// Función para mostrar el modal de receta
export function mostrarModalReceta(articulo_numero) {
    const modal = document.getElementById('modal-receta');
    if (modal) {
        // Establecer el código del artículo en el campo
        document.getElementById('articulo_numero').value = articulo_numero;
        modal.style.display = 'block';
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
