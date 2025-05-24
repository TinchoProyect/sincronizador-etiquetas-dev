import { mostrarError } from './utils.js';
import { mostrarArticulosDelCarro } from './carro.js';

// Estado del módulo (privado)
const state = {
    todosLosArticulos: [],
    articulosFiltrados: []
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
            const response = await fetch('http://localhost:3002/api/produccion/articulos');
            if (!response.ok) {
                throw new Error('Error al obtener artículos');
            }
            state.todosLosArticulos = await response.json();
            state.articulosFiltrados = [...state.todosLosArticulos];
            actualizarTablaArticulos(state.articulosFiltrados);
        }
    } catch (error) {
        console.error('Error:', error);
        mostrarError(error.message);
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
            throw new Error('Error al obtener estado de recetas');
        }

        const estadoRecetas = await response.json();
        console.log('Estado de recetas recibido:', estadoRecetas);

        articulos.forEach(articulo => {
            const tr = document.createElement('tr');
            const tieneReceta = estadoRecetas[articulo.numero];
            
            tr.innerHTML = `
                <td>${articulo.numero}</td>
                <td>${articulo.nombre.replace(/'/g, "\\'")}</td>
                <td>${articulo.codigo_barras || '-'}</td>
                <td>
                    <input type="number" class="cantidad-input" min="1" value="1">
                    <button class="btn-agregar ${tieneReceta ? 'btn-verde' : 'btn-rojo'}" 
                            onclick="agregarAlCarro('${articulo.numero}', '${articulo.nombre.replace(/'/g, "\\'")}', this)">
                        Agregar al carro
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
            tr.innerHTML = `
                <td>${articulo.numero}</td>
                <td>${articulo.nombre.replace(/'/g, "\\'")}</td>
                <td>${articulo.codigo_barras || '-'}</td>
                <td>
                    <input type="number" class="cantidad-input" min="1" value="1">
                    <button class="btn-agregar btn-rojo" 
                            onclick="agregarAlCarro('${articulo.numero}', '${articulo.nombre.replace(/'/g, "\\'")}', this)">
                        Agregar al carro
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
        // Limpiar el formulario
        document.getElementById('articulo_numero').value = '';
        document.getElementById('descripcion_receta').value = '';
    }
}

// Función para mostrar el modal de receta
function mostrarModalReceta(articuloNumero) {
    const modal = document.getElementById('modal-receta');
    if (modal) {
        // Establecer el número de artículo en el campo
        document.getElementById('articulo_numero').value = articuloNumero;
        modal.style.display = 'block';
    }
}

// Función para agregar artículo al carro
export async function agregarAlCarro(articuloNumero, descripcion, btnElement) {
    // Si el botón es rojo, mostrar el modal de receta en lugar de agregar al carro
    if (btnElement.classList.contains('btn-rojo')) {
        mostrarModalReceta(articuloNumero);
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
                articuloNumero,
                descripcion,
                cantidad,
                usuarioId: colaborador.id
            })
        });

        if (!response.ok) {
            throw new Error('Error al agregar el artículo al carro');
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
