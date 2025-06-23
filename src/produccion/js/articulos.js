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
import { mostrarArticulosDelCarro, obtenerResumenIngredientesCarro, mostrarResumenIngredientes } from './carro.js';

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

        // Activar el filtro de producción por defecto
        const filtroProduccionSwitch = document.getElementById('filtroProduccionSwitch');
        if (filtroProduccionSwitch) {
            filtroProduccionSwitch.checked = true;
        }

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
            // Aplicar filtro de producción por defecto
            aplicarFiltros(0);
        } else {
            // Si ya hay artículos cargados, aplicar el filtro de producción
            aplicarFiltros(0);
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

// Función para actualizar la tabla de artículos con agrupación visual
export async function actualizarTablaArticulos(articulos) {
    const tbody = document.getElementById('tabla-articulos-body');
    tbody.innerHTML = '';

    if (!articulos || articulos.length === 0) {
        tbody.innerHTML = '<tr><td colspan="4" class="text-center">No hay artículos disponibles</td></tr>';
        return;
    }

    try {
        console.log('Consultando estado de recetas para artículos:', articulos.map(art => art.numero));
        
        const articulosNumeros = articulos.map(art => art.numero);
        
        // Obtener el estado de las recetas para todos los artículos
        const [estadoResponse, integridadResponse] = await Promise.all([
            fetch('http://localhost:3002/api/produccion/articulos/estado-recetas', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    articulos: articulosNumeros
                })
            }),
            fetch('http://localhost:3002/api/produccion/articulos/integridad-recetas', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    articulos: articulosNumeros
                })
            })
        ]);

        if (!estadoResponse.ok) {
            const errorData = await estadoResponse.json();
            throw new Error(errorData.error || 'Error al obtener estado de recetas');
        }

        if (!integridadResponse.ok) {
            const errorData = await integridadResponse.json();
            throw new Error(errorData.error || 'Error al obtener integridad de recetas');
        }

        const estadoRecetas = await estadoResponse.json();
        const integridadRecetas = await integridadResponse.json();
        console.log('Estado de recetas recibido:', estadoRecetas);
        console.log('Integridad de recetas recibida:', integridadRecetas);

        // Dividir artículos en dos grupos según no_producido_por_lambda
        const produccion = articulos.filter(art => art.no_producido_por_lambda === false);
        const resto = articulos.filter(art => art.no_producido_por_lambda === true);

        // Ordenar cada grupo alfabéticamente por nombre
        produccion.sort((a, b) => a.nombre.localeCompare(b.nombre));
        resto.sort((a, b) => a.nombre.localeCompare(b.nombre));

        // Función para renderizar un grupo con encabezado
        function renderGroup(title, group) {
            // Crear fila de encabezado con colspan 4
            const headerRow = document.createElement('tr');
            const headerCell = document.createElement('td');
            headerCell.colSpan = 4;
            headerCell.style.fontWeight = 'bold';
            headerCell.style.backgroundColor = '#f0f0f0';
            headerCell.style.padding = '8px';
            headerCell.textContent = title;
            headerRow.appendChild(headerCell);
            tbody.appendChild(headerRow);

            // Renderizar artículos del grupo
            group.forEach(articulo => {
                const tr = document.createElement('tr');
                const tieneReceta = estadoRecetas[articulo.numero];
                const esIntegra = integridadRecetas[articulo.numero];
                
                tr.setAttribute('data-numero', articulo.numero);
                const esArticuloEditado = articulo.numero === state.ultimoArticuloEditado;
                if (esArticuloEditado) {
                    tr.classList.add('resaltado-articulo');
                }

                // Determinar el estilo del botón "Agregar al carro" basado en la integridad
                let btnAgregarEstilo = '';
                let btnAgregarTitulo = 'Agregar al carro';
                let btnAgregarClase = 'btn-agregar icon-cart';
                
                if (tieneReceta && !esIntegra) {
                    // Receta con ingredientes faltantes - botón rojo con advertencia
                    btnAgregarEstilo = 'background-color: #dc3545; color: white; border: 1px solid #dc3545;';
                    btnAgregarTitulo = 'Advertencia: Esta receta tiene ingredientes que ya no existen en el sistema';
                    btnAgregarClase = 'btn-agregar btn-warning-integridad icon-cart';
                }
                
                tr.innerHTML = `
                    <td>${articulo.numero}</td>
                    <td>${articulo.nombre.replace(/'/g, "\\'")}</td>
                    <td style="text-align: center; font-weight: bold; color: ${articulo.stock_ventas > 0 ? '#28a745' : '#dc3545'};">
                        ${articulo.stock_ventas || 0}
                    </td>
                    <td>
                        ${tieneReceta ? `
                            <input type="number" class="cantidad-input" min="1" value="1" style="width: 50px; margin-right: 6px;">
                            <button class="${btnAgregarClase}" 
                                    data-numero="${articulo.numero}" 
                                    data-nombre="${articulo.nombre.replace(/'/g, "\\'")}"
                                    data-integra="${esIntegra}"
                                    style="${btnAgregarEstilo}"
                                    title="${btnAgregarTitulo}">
                                Ag. carro
                            </button>
                            <button class="btn-editar-receta icon-edit"
                                    data-numero="${articulo.numero}"
                                    data-modo="editar"
                                    data-nombre="${articulo.nombre.replace(/'/g, "\\'")}"
                                    title="Editar receta">
                                Editar
                            </button>
                            <button class="btn-desvincular-receta icon-trash"
                                    data-numero="${articulo.numero}"
                                    data-nombre="${articulo.nombre.replace(/'/g, "\\'")}"
                                    title="Quitar receta">
                                Quitar
                            </button>
                        ` : `
                            <button class="btn-editar-receta"
                                    style="background-color: #6c757d; color: white; border: none; padding: 6px 12px; border-radius: 4px;"
                                    data-numero="${articulo.numero}"
                                    data-modo="crear"
                                    data-nombre="${articulo.nombre.replace(/'/g, "\\'")}">
                                Vincular receta
                            </button>
                        `}
                    </td>
                `;
                tbody.appendChild(tr);
            });
        }

        // Si el filtro "Mostrar solo artículos de producción" está activo, mostrar solo el grupo de producción
        const filtroProduccionSwitch = document.getElementById('filtroProduccionSwitch');
        const mostrarSoloProduccion = filtroProduccionSwitch ? filtroProduccionSwitch.checked : false;

        if (mostrarSoloProduccion) {
            if (produccion.length === 0) {
                tbody.innerHTML = '<tr><td colspan="4" class="text-center">No hay artículos de producción disponibles</td></tr>';
            } else {
                renderGroup('Artículos de producción', produccion);
            }
        } else {
            // Mostrar ambos grupos con encabezados
            if (produccion.length > 0) {
                renderGroup('Artículos de producción', produccion);
            }
            if (resto.length > 0) {
                renderGroup('Resto de los artículos', resto);
            }
            if (produccion.length === 0 && resto.length === 0) {
                tbody.innerHTML = '<tr><td colspan="4" class="text-center">No hay artículos disponibles</td></tr>';
            }
        }

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
                <td style="text-align: center; font-weight: bold; color: ${articulo.stock_ventas > 0 ? '#28a745' : '#dc3545'};">
                    ${articulo.stock_ventas || 0}
                </td>
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

    // Obtener valor del switch de filtro de producción
    const filtroProduccionSwitch = document.getElementById('filtroProduccionSwitch');
    const mostrarSoloProduccion = filtroProduccionSwitch ? filtroProduccionSwitch.checked : false;

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

    // Aplicar filtro de producción si está activo
    if (mostrarSoloProduccion) {
        resultados = resultados.filter(art => art.no_producido_por_lambda === false);
    }

    // Ordenar resultados: primero producidos por LAMDA, luego no producidos
    resultados.sort((a, b) => {
        if (a.no_producido_por_lambda === b.no_producido_por_lambda) {
            // Orden alfabético por nombre
            return a.nombre.localeCompare(b.nombre);
        }
        // Los producidos (false) primero
        return a.no_producido_por_lambda ? 1 : -1;
    });

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
            document.getElementById('articulo_descripcion').value = '';
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
        <td>${Number(ingrediente.cantidad).toFixed(10)}</td>
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
        const response = await fetch('http://localhost:3002/api/produccion/ingredientes');
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
        const cantidad = Number(cantidadInput.value.replace(',', '.'));
        
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
            cantidad: Number(cantidadInput.value.replace(',', '.'))
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
                cantidad: Number(ing.cantidad)
            }))
        };

        // Enviar al servidor
        const url = state.existeReceta
          ? `http://localhost:3002/api/produccion/recetas/${encodeURIComponent(articulo_numero)}`
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
            
            // Si es error 400 por receta existente, mostrar mensaje especial
            if (response.status === 400 && errorData.error.includes('Ya existe una receta')) {
                const errorDiv = document.createElement('div');
                errorDiv.className = 'error-message';
                errorDiv.style.backgroundColor = '#f8d7da';
                errorDiv.style.color = '#721c24';
                errorDiv.style.padding = '10px';
                errorDiv.style.marginBottom = '10px';
                errorDiv.style.borderRadius = '4px';
                errorDiv.textContent = errorData.error;
                
                // Insertar al inicio del contenido del modal
                const modalContent = document.querySelector('.modal-content');
                modalContent.insertBefore(errorDiv, modalContent.firstChild);
                
                // Remover después de 5 segundos
                setTimeout(() => {
                    errorDiv.remove();
                }, 5000);
                return;
            }
            
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
export async function mostrarModalReceta(articulo_numero, articulo_nombre, modo = 'auto') {
    const modal = document.getElementById('modal-receta');
    if (modal) {
        try {
            // Establecer el modo explícitamente
            if (modo === 'crear') {
                state.existeReceta = false;
            } else if (modo === 'editar') {
                state.existeReceta = true;
            }

            // Establecer el código del artículo
            document.getElementById('articulo_numero').value = articulo_numero;
            document.getElementById('articulo_descripcion').value = articulo_nombre;
            
            // Cargar ingredientes disponibles primero
            await cargarIngredientesDisponibles();
            
            // Intentar obtener la receta existente solo si no es modo crear
            if (modo !== 'crear') {
                try {
                    const response = await fetch(`http://localhost:3002/api/produccion/recetas/${encodeURIComponent(articulo_numero)}`);
                    
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
            } else {
                // Si es modo crear, inicializar vacía directamente
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

// Función para agregar artículo al carro (optimizada)
export async function agregarAlCarro(articulo_numero, descripcion, btnElement) {
    // Si el botón es rojo, mostrar el modal de receta en lugar de agregar al carro
    if (btnElement.classList.contains('btn-danger')) {
        mostrarModalReceta(articulo_numero);
        return;
    }

    // Verificar si es una receta con problemas de integridad
    const esIntegra = btnElement.dataset.integra === 'true';
    if (btnElement.classList.contains('btn-warning-integridad') || !esIntegra) {
        const confirmar = confirm(
            `ADVERTENCIA: Esta receta contiene ingredientes que ya no existen en el sistema.\n\n` +
            `Esto puede causar errores en el cálculo de ingredientes necesarios.\n\n` +
            `¿Desea continuar agregando este artículo al carro?`
        );
        
        if (!confirmar) {
            return;
        }
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

        // Mostrar feedback inmediato
        btnElement.disabled = true;
        btnElement.textContent = 'Agregando...';

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

        // Restaurar botón
        btnElement.disabled = false;
        btnElement.textContent = 'Ag. carro';

        // Mostrar mensaje de éxito (diferente si hay problemas de integridad)
        const successDiv = document.createElement('div');
        successDiv.className = 'success-message';
        
        if (!esIntegra) {
            successDiv.textContent = 'Artículo agregado con advertencias de integridad';
            successDiv.style.backgroundColor = '#ffc107'; // Color amarillo para advertencia
            successDiv.style.color = '#212529';
        } else {
            successDiv.textContent = 'Artículo agregado correctamente';
            successDiv.style.backgroundColor = '#28a745';
            successDiv.style.color = 'white';
        }
        
        successDiv.style.cssText += `
            position: fixed;
            top: 20px;
            right: 20px;
            padding: 10px 20px;
            border-radius: 4px;
            z-index: 10000;
            animation: slideIn 0.3s ease-out;
        `;
        document.body.appendChild(successDiv);
        
        // Remover el mensaje después de 3 segundos
        setTimeout(() => {
            successDiv.remove();
        }, 3000);

        // Agregar el nuevo artículo al DOM inmediatamente
        await agregarArticuloAlDOM(articulo_numero, descripcion, cantidad);
        
        // Actualizar resumen en segundo plano
        actualizarResumenEnSegundoPlano(carroId, colaborador.id);

        // Cerrar el modal después de agregar
        cerrarModalArticulos();

    } catch (error) {
        console.error('Error:', error);
        mostrarError(error.message);
        // Restaurar botón en caso de error
        btnElement.disabled = false;
        btnElement.textContent = 'Ag. carro';
    }
}

// Función para agregar artículo al DOM inmediatamente
async function agregarArticuloAlDOM(articulo_numero, descripcion, cantidad) {
    try {
        const contenedor = document.getElementById('lista-articulos');
        if (!contenedor) return;

        const seccionArticulos = contenedor.querySelector('.seccion-articulos');
        if (!seccionArticulos) return;

        // Obtener ingredientes del artículo
        const ingredientes = await obtenerIngredientesExpandidos(articulo_numero);

        // Crear HTML del nuevo artículo
        let htmlArticulo = `
            <div class="articulo-container" data-numero="${articulo_numero}">
                <div class="articulo-info">
                    <span class="articulo-codigo">${articulo_numero}</span>
                    <span class="articulo-descripcion">${descripcion}</span>
                </div>
                <div class="articulo-actions">
                    <input type="number"
                           class="input-cantidad-articulo"
                           value="${cantidad}"
                           min="1"
                           data-numero="${articulo_numero}">
                    <button class="btn-eliminar-articulo"
                            data-numero="${articulo_numero}">
                        🗑️
                    </button>
                </div>
                <button class="toggle-ingredientes">Ver</button>
            </div>
        `;

        // Agregar ingredientes
        if (ingredientes && ingredientes.length > 0) {
            htmlArticulo += `
                <div class="ingredientes-expandidos hidden">
                    <div>
                        <table>
                            <thead>
                                <tr>
                                    <th>Ingrediente</th>
                                    <th>Cantidad</th>
                                    <th>Unidad</th>
                                </tr>
                            </thead>
                            <tbody>
            `;

            ingredientes.forEach(ing => {
                const cantidadTotal = Number(ing.cantidad) * Number(cantidad);
                htmlArticulo += `
                    <tr>
                        <td>${ing.nombre}</td>
                        <td data-base="${Number(ing.cantidad).toFixed(10)}">${Number(cantidadTotal).toFixed(10)}</td>
                        <td>${ing.unidad_medida}</td>
                    </tr>
                `;
            });

            htmlArticulo += `
                            </tbody>
                        </table>
                    </div>
                </div>
            `;
        } else {
            htmlArticulo += `
                <div class="ingredientes-expandidos hidden">
                    <div class="ingredientes-error">
                        No se pudieron cargar los ingredientes para este artículo.
                    </div>
                </div>
            `;
        }

        // Insertar el nuevo artículo al final
        seccionArticulos.insertAdjacentHTML('beforeend', htmlArticulo);

    } catch (error) {
        console.error('Error al agregar artículo al DOM:', error);
        // Si falla, recargar la vista completa
        const { mostrarArticulosDelCarro } = await import('./carro.js');
        await mostrarArticulosDelCarro();
    }
}

// Función para actualizar resumen en segundo plano
async function actualizarResumenEnSegundoPlano(carroId, colaboradorId) {
    try {
        const { obtenerResumenIngredientesCarro, mostrarResumenIngredientes, obtenerResumenMixesCarro, mostrarResumenMixes } = await import('./carro.js');
        
        // Actualizar ingredientes
        const ingredientes = await obtenerResumenIngredientesCarro(carroId, colaboradorId);
        mostrarResumenIngredientes(ingredientes);
        
        // Actualizar mixes
        const mixes = await obtenerResumenMixesCarro(carroId, colaboradorId);
        mostrarResumenMixes(mixes);
    } catch (error) {
        console.error('Error al actualizar resumen:', error);
    }
}

// Función auxiliar para obtener ingredientes expandidos
async function obtenerIngredientesExpandidos(numeroArticulo) {
    try {
        const numeroArticuloEncoded = encodeURIComponent(numeroArticulo);
        const response = await fetch(`http://localhost:3002/api/produccion/recetas/${numeroArticuloEncoded}/ingredientes-expandido`);
        if (!response.ok) throw new Error('No se encontraron ingredientes');
        return await response.json();
    } catch (error) {
        console.error(`Error al obtener ingredientes para ${numeroArticulo}:`, error);
        return null;
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

// Función para desvincular receta
async function desvincularReceta(articulo_numero, articulo_nombre) {
    try {
        if (!confirm(`¿Está seguro que desea desvincular la receta del artículo ${articulo_nombre}?`)) {
            return;
        }

        // 1. Eliminar la receta - usar el número de artículo sin modificar
        const deleteResponse = await fetch(`http://localhost:3002/api/produccion/recetas/${encodeURIComponent(articulo_numero)}`, {
            method: 'DELETE'
        });

        if (!deleteResponse.ok) {
            const errorData = await deleteResponse.json();
            throw new Error(errorData.error || 'Error al desvincular la receta');
        }

        // 2. Obtener el estado actualizado de todas las recetas
        const estadoResponse = await fetch('http://localhost:3002/api/produccion/articulos/estado-recetas', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                articulos: state.articulosFiltrados.map(art => art.numero.replace(/[^a-zA-Z0-9]/g, ''))
            })
        });

        if (!estadoResponse.ok) {
            throw new Error('Error al actualizar el estado de las recetas');
        }

        // 3. Actualizar el estado local
        const estadoRecetas = await estadoResponse.json();
        
        // 4. Actualizar la tabla con el nuevo estado
        await actualizarTablaArticulos(state.articulosFiltrados);

        // Mostrar mensaje de éxito
        const successDiv = document.createElement('div');
        successDiv.className = 'success-message';
        successDiv.textContent = 'Receta desvinculada correctamente';
        successDiv.style.cssText = `
            position: fixed;
            top: 20px;
            right: 20px;
            background-color: #28a745;
            color: white;
            padding: 10px 20px;
            border-radius: 4px;
            z-index: 10000;
            animation: slideIn 0.3s ease-out;
        `;
        document.body.appendChild(successDiv);
        
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
            const articulo_nombre = e.target.dataset.nombre;
            const modo = e.target.dataset.modo;
            mostrarModalReceta(articulo_numero, articulo_nombre, modo);
        } else if (e.target.classList.contains('btn-desvincular-receta')) {
            const articulo_numero = e.target.dataset.numero;
            const articulo_nombre = e.target.dataset.nombre;
            await desvincularReceta(articulo_numero, articulo_nombre);
        }
    });
});
