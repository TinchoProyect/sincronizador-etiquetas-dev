import { mostrarError } from './utils.js';
import { mostrarArticulosDelCarro, obtenerResumenIngredientesCarro, mostrarResumenIngredientes, obtenerResumenMixesCarro, mostrarResumenMixes, obtenerResumenArticulosCarro, mostrarResumenArticulos } from './carro.js';

// Estado del módulo
const state = {
    todosLosArticulos: [],
    articulosFiltrados: [],
    ingredientesCargados: [],
    articulosReceta: [],
    ultimoArticuloEditado: null,
    existeReceta: false,
    tipoCarro: 'interna'
};

let ingredientesDisponibles = [];

/**
 * Formatea un número de stock para mostrar de forma legible
 * - Redondea a 2 decimales máximo
 * - Elimina decimales innecesarios (.00)
 * - Maneja valores muy pequeños como 0
 * @param {number} valor - El valor numérico a formatear
 * @returns {string} - El valor formateado como string
 */
function formatearStock(valor) {
    if (valor === null || valor === undefined || isNaN(valor)) {
        return '0';
    }
    
    const numero = Number(valor);
    
    // Si el valor es prácticamente cero (debido a precisión de punto flotante)
    if (Math.abs(numero) < 0.001) {
        return '0';
    }
    
    // Redondear a 2 decimales y eliminar ceros innecesarios
    return numero.toFixed(2).replace(/\.?0+$/, '');
}

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
        setTimeout(() => {
            modal.classList.add('show');
        }, 10);

        const filtroProduccionSwitch = document.getElementById('filtroProduccionSwitch');
        if (filtroProduccionSwitch) {
            filtroProduccionSwitch.checked = true;
        }

        let tipoCarro = 'interna';
        const carroId = localStorage.getItem('carroActivo');
        
        if (carroId) {
            try {
                const carroResponse = await fetch(`http://localhost:3002/api/produccion/carro/${carroId}/estado`);
                if (carroResponse.ok) {
                    const carroData = await carroResponse.json();
                    tipoCarro = carroData.tipo_carro || 'interna';
                }
            } catch (error) {
                console.warn('Error al obtener tipo de carro:', error);
            }
        }

        const cacheKey = `articulos_${tipoCarro}`;
        if (!state[cacheKey] || state[cacheKey].length === 0) {
            const url = tipoCarro === 'externa' 
                ? 'http://localhost:3002/api/produccion/articulos?tipo_carro=externa'
                : 'http://localhost:3002/api/produccion/articulos';
                
            const response = await fetch(url);
            
            if (!response.ok) {
                const errorData = await response.json();
                throw new Error(errorData.error || 'Error al obtener artículos');
            }

            const articulos = await response.json();
            
            if (articulos.length === 0) {
                const mensaje = tipoCarro === 'externa' 
                    ? 'No se encontraron artículos de producción externa disponibles'
                    : 'No se encontraron artículos disponibles';
                mostrarError(mensaje);
                return;
            }

            state[cacheKey] = articulos;
            state.todosLosArticulos = articulos;
            state.articulosFiltrados = [...articulos];
            aplicarFiltros(0);
        } else {
            state.todosLosArticulos = state[cacheKey];
            state.articulosFiltrados = [...state[cacheKey]];
            aplicarFiltros(0);
        }

        const modalTitle = modal.querySelector('h2');
        if (modalTitle) {
            const tipoTexto = tipoCarro === 'externa' ? 'Producción Externa' : 'Producción Interna';
            const icono = tipoCarro === 'externa' ? '🚚' : '🏭';
            modalTitle.textContent = `${icono} Seleccionar Artículo - ${tipoTexto}`;
        }
        
    } catch (error) {
        console.error('Error al abrir modal de artículos:', error);
        mostrarError(error.message);
        const modal = document.getElementById('modal-articulos');
        modal.style.display = 'none';
    }
}

// Función para cerrar el modal
export function cerrarModalArticulos() {
    const modal = document.getElementById('modal-articulos');
    modal.classList.remove('show');
    setTimeout(() => {
        modal.style.display = 'none';
    }, 300);
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
        const articulosNumeros = articulos.map(art => art.numero);
        
        const [estadoResponse, integridadResponse] = await Promise.all([
            fetch('http://localhost:3002/api/produccion/articulos/estado-recetas', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ articulos: articulosNumeros })
            }),
            fetch('http://localhost:3002/api/produccion/articulos/integridad-recetas', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ articulos: articulosNumeros })
            })
        ]);

        if (!estadoResponse.ok || !integridadResponse.ok) {
            throw new Error('Error al obtener estado de recetas');
        }

        const estadoRecetas = await estadoResponse.json();
        const integridadRecetas = await integridadResponse.json();

        const produccion = articulos.filter(art => art.no_producido_por_lambda === false);
        const resto = articulos.filter(art => art.no_producido_por_lambda === true);

        produccion.sort((a, b) => a.nombre.localeCompare(b.nombre));
        resto.sort((a, b) => a.nombre.localeCompare(b.nombre));

        function renderGroup(title, group) {
            const headerRow = document.createElement('tr');
            const headerCell = document.createElement('td');
            headerCell.colSpan = 4;
            headerCell.style.fontWeight = 'bold';
            headerCell.style.backgroundColor = '#f0f0f0';
            headerCell.style.padding = '8px';
            headerCell.textContent = title;
            headerRow.appendChild(headerCell);
            tbody.appendChild(headerRow);

            group.forEach(articulo => {
                const tr = document.createElement('tr');
                const tieneReceta = estadoRecetas[articulo.numero];
                const esIntegra = integridadRecetas[articulo.numero];
                
                tr.setAttribute('data-numero', articulo.numero);
                if (articulo.numero === state.ultimoArticuloEditado) {
                    tr.classList.add('resaltado-articulo');
                }

                let btnAgregarEstilo = '';
                let btnAgregarTitulo = 'Agregar al carro';
                let btnAgregarClase = 'btn-agregar icon-cart';
                
                if (tieneReceta && !esIntegra) {
                    btnAgregarEstilo = 'background-color: #dc3545; color: white; border: 1px solid #dc3545;';
                    btnAgregarTitulo = 'Advertencia: Esta receta tiene ingredientes que ya no existen en el sistema';
                    btnAgregarClase = 'btn-agregar btn-warning-integridad icon-cart';
                }
                
                tr.innerHTML = `
                    <td>${articulo.numero}</td>
                    <td>${articulo.nombre.replace(/'/g, "\\'")}</td>
                    <td style="text-align: center; font-weight: bold; color: ${articulo.stock_consolidado > 0 ? '#28a745' : '#dc3545'};">
                        ${formatearStock(articulo.stock_consolidado || 0)}
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

        const filtroProduccionSwitch = document.getElementById('filtroProduccionSwitch');
        const mostrarSoloProduccion = filtroProduccionSwitch ? filtroProduccionSwitch.checked : false;

        if (mostrarSoloProduccion) {
            if (produccion.length === 0) {
                tbody.innerHTML = '<tr><td colspan="4" class="text-center">No hay artículos de producción disponibles</td></tr>';
            } else {
                renderGroup('Artículos de producción', produccion);
            }
        } else {
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
        tbody.innerHTML = '<tr><td colspan="4" class="text-center">Error al cargar artículos</td></tr>';
    }
}

// Función para aplicar filtros
export function aplicarFiltros(filtroIndex) {
    const filtro1 = document.getElementById('filtro1').value.toLowerCase();
    const filtro2 = document.getElementById('filtro2').value.toLowerCase();
    const filtro3 = document.getElementById('filtro3').value.toLowerCase();

    const filtroProduccionSwitch = document.getElementById('filtroProduccionSwitch');
    const mostrarSoloProduccion = filtroProduccionSwitch ? filtroProduccionSwitch.checked : false;

    if (filtroIndex === 1) {
        document.getElementById('filtro2').value = '';
        document.getElementById('filtro3').value = '';
    } else if (filtroIndex === 2) {
        document.getElementById('filtro3').value = '';
    }

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

    if (mostrarSoloProduccion) {
        resultados = resultados.filter(art => art.no_producido_por_lambda === false);
    }

    resultados.sort((a, b) => {
        if (a.no_producido_por_lambda === b.no_producido_por_lambda) {
            return a.nombre.localeCompare(b.nombre);
        }
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
            document.getElementById('articulo_numero').value = '';
            document.getElementById('articulo_descripcion').value = '';
            document.getElementById('descripcion_receta').value = '';
            document.getElementById('selector-ingrediente').value = '';
            document.getElementById('input-cantidad-ingrediente').value = '';
            
            const selectorArticulo = document.getElementById('selector-articulo');
            if (selectorArticulo) {
                selectorArticulo.value = '';
            }
            const inputCantidadArticulo = document.getElementById('input-cantidad-articulo');
            if (inputCantidadArticulo) {
                inputCantidadArticulo.value = '';
            }
            
            state.ingredientesCargados = [];
            state.articulosReceta = [];
            
            const tbody = document.querySelector('#tabla-ingredientes tbody');
            if (tbody) {
                tbody.innerHTML = '';
            }
            
            const tbodyArticulos = document.querySelector('#tabla-articulos-receta tbody');
            if (tbodyArticulos) {
                tbodyArticulos.innerHTML = '';
            }
            
            const seccionArticulos = document.getElementById('seccion-articulos-receta');
            if (seccionArticulos) {
                seccionArticulos.style.display = 'none';
            }
            
            const contenedorArticulos = document.getElementById('contenedor-articulos');
            if (contenedorArticulos) {
                contenedorArticulos.style.display = 'none';
            }
            
            const formActionsArticulos = document.getElementById('form-actions-articulos');
            if (formActionsArticulos) {
                formActionsArticulos.style.display = 'none';
            }
        }, 300);
    }
}

// Función para agregar artículo al carro
export async function agregarAlCarro(articulo_numero, descripcion, btnElement) {
    if (btnElement.classList.contains('btn-danger')) {
        mostrarModalReceta(articulo_numero);
        return;
    }

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
        const cantidad = parseFloat(cantidadInput.value);
        
        if (isNaN(cantidad) || cantidad <= 0) {
            throw new Error('La cantidad debe ser un número positivo');
        }

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
            
            // Verificar si es el error específico de artículo duplicado
            if (errorData.error === 'Este artículo ya fue agregado al carro') {
                // Mostrar mensaje específico con estilo de alerta
                const alertDiv = document.createElement('div');
                alertDiv.className = 'alert-message';
                alertDiv.textContent = errorData.error;
                alertDiv.style.cssText = `
                    position: fixed;
                    top: 20px;
                    right: 20px;
                    background-color: #dc3545;
                    color: white;
                    padding: 15px 20px;
                    border-radius: 4px;
                    z-index: 10000;
                    font-weight: bold;
                    box-shadow: 0 4px 6px rgba(0, 0, 0, 0.1);
                    animation: slideIn 0.3s ease-out;
                `;
                document.body.appendChild(alertDiv);
                
                setTimeout(() => {
                    alertDiv.remove();
                }, 4000);
                
                btnElement.disabled = false;
                btnElement.textContent = 'Ag. carro';
                return;
            }
            
            throw new Error(errorData.error || 'Error al agregar el artículo al carro');
        }

        btnElement.disabled = false;
        btnElement.textContent = 'Ag. carro';

        const successDiv = document.createElement('div');
        successDiv.className = 'success-message';
        
        if (!esIntegra) {
            successDiv.textContent = 'Artículo agregado con advertencias de integridad';
            successDiv.style.backgroundColor = '#ffc107';
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
        
        setTimeout(() => {
            successDiv.remove();
        }, 3000);

        cerrarModalArticulos();

        // 🔄 ACTUALIZAR RESUMEN AUTOMÁTICAMENTE DESPUÉS DE AGREGAR ARTÍCULO
        try {
            console.log('🔄 Actualizando resumen después de agregar artículo...');
            
            // Actualizar lista de artículos del carro
            await mostrarArticulosDelCarro();
            
            // Actualizar resumen de ingredientes
            const ingredientes = await obtenerResumenIngredientesCarro(carroId, colaborador.id);
            mostrarResumenIngredientes(ingredientes);
            
            // Actualizar resumen de mixes
            const mixes = await obtenerResumenMixesCarro(carroId, colaborador.id);
            mostrarResumenMixes(mixes);
            
            // Actualizar resumen de artículos (solo para carros externos)
            const articulos = await obtenerResumenArticulosCarro(carroId, colaborador.id);
            if (articulos && articulos.length > 0) {
                mostrarResumenArticulos(articulos);
                const seccionArticulos = document.getElementById('resumen-articulos');
                if (seccionArticulos) {
                    seccionArticulos.style.display = 'block';
                }
            }
            
            console.log('✅ Resumen actualizado correctamente');
        } catch (updateError) {
            console.error('⚠️ Error al actualizar resumen:', updateError);
            // No mostrar error al usuario, solo log para debug
        }

    } catch (error) {
        console.error('Error:', error);
        mostrarError(error.message);
        btnElement.disabled = false;
        btnElement.textContent = 'Ag. carro';
    }
}

// Funciones para manejo de artículos en recetas
export async function cargarArticulosDisponibles() {
    try {
        // Para el desplegable de artículos en recetas, cargar TODOS los artículos
        // No aplicar filtro de tipo_carro para permitir insumos como "mezcla para grana de sol"
        const response = await fetch('http://localhost:3002/api/produccion/articulos');
        if (!response.ok) {
            throw new Error('Error al cargar artículos disponibles');
        }
        const articulos = await response.json();
        state.articulosDisponibles = articulos;
        actualizarSelectorArticulos();
    } catch (error) {
        mostrarError(error.message);
        console.error(error);
    }
}

export function actualizarSelectorArticulos() {
    const selector = document.getElementById('selector-articulo');
    if (!selector) return;
    selector.innerHTML = '<option value="">Seleccione un artículo...</option>';
    state.articulosDisponibles.forEach(art => {
        selector.innerHTML += `<option value="${art.numero}">${art.nombre}</option>`;
    });
}

export function toggleCantidadArticuloField() {
    const selector = document.getElementById('selector-articulo');
    const cantidadContainer = document.getElementById('cantidad-articulo-container');
    if (!selector || !cantidadContainer) return;

    if (selector.value) {
        cantidadContainer.style.display = 'block';
    } else {
        cantidadContainer.style.display = 'none';
        const inputCantidad = document.getElementById('input-cantidad-articulo');
        if (inputCantidad) inputCantidad.value = '';
    }
}

export function agregarArticuloATabla(articulo, index) {
    const tbody = document.querySelector('#tabla-articulos-receta tbody');
    if (!tbody) return;

    // Buscar la información completa del artículo en state.articulosDisponibles
    const articuloCompleto = state.articulosDisponibles.find(art => art.numero === articulo.articulo_numero);
    
    // Obtener descripción y código de barras
    const descripcion = articuloCompleto ? articuloCompleto.nombre : 'Descripción no disponible';
    const codigoBarras = articuloCompleto ? (articuloCompleto.codigo_barras || 'Sin código') : 'Sin código';

    const tr = document.createElement('tr');
    tr.innerHTML = `
        <td>${articulo.articulo_numero}</td>
        <td title="${descripcion}">${descripcion}</td>
        <td>${codigoBarras}</td>
        <td>${Number(articulo.cantidad).toFixed(2)}</td>
        <td>
            <button class="btn-eliminar-articulo-receta" data-index="${index}" style="background-color: #dc3545; color: white; border: none; padding: 4px 8px; border-radius: 4px;">
                Eliminar
            </button>
        </td>
    `;
    tbody.appendChild(tr);
}

export function agregarArticuloDesdeSelector() {
    try {
        const selector = document.getElementById('selector-articulo');
        const cantidadInput = document.getElementById('input-cantidad-articulo');

        const articuloNumero = selector.value;
        const cantidad = Number(cantidadInput.value.replace(',', '.'));

        if (!articuloNumero) {
            throw new Error('Debe seleccionar un artículo');
        }

        if (isNaN(cantidad) || cantidad <= 0) {
            throw new Error('La cantidad debe ser un número mayor a 0');
        }

        const articuloSeleccionado = state.articulosDisponibles.find(a => a.numero === articuloNumero);

        const articulo = {
            articulo_numero: articuloSeleccionado.numero,
            cantidad: cantidad
        };

        state.articulosReceta.push(articulo);
        agregarArticuloATabla(articulo, state.articulosReceta.length - 1);

        selector.value = '';
        cantidadInput.value = '';

    } catch (error) {
        mostrarError(error.message);
    }
}

export function eliminarArticuloDeTabla(index) {
    if (index >= 0 && index < state.articulosReceta.length) {
        state.articulosReceta.splice(index, 1);
        const tbody = document.querySelector('#tabla-articulos-receta tbody');
        if (!tbody) return;
        tbody.innerHTML = '';
        state.articulosReceta.forEach((art, idx) => {
            agregarArticuloATabla(art, idx);
        });
    }
}

// Función para mostrar modal de receta
export async function mostrarModalReceta(articulo_numero, articulo_nombre, modo = 'auto') {
    const modal = document.getElementById('modal-receta');
    if (modal) {
        try {
            if (modo === 'crear') {
                state.existeReceta = false;
            } else if (modo === 'editar') {
                state.existeReceta = true;
            }

            document.getElementById('articulo_numero').value = articulo_numero;
            document.getElementById('articulo_descripcion').value = articulo_nombre;
            
            // Detectar tipo de carro para mostrar/ocultar sección de artículos
            const carroId = localStorage.getItem('carroActivo');
            let tipoCarro = 'interna';
            
            if (carroId) {
                try {
                    const carroResponse = await fetch(`http://localhost:3002/api/produccion/carro/${carroId}/estado`);
                    if (carroResponse.ok) {
                        const carroData = await carroResponse.json();
                        tipoCarro = carroData.tipo_carro || 'interna';
                    }
                } catch (error) {
                    console.warn('Error al obtener tipo de carro:', error);
                }
            }

            // Mostrar/ocultar sección de artículos según tipo de carro
            const seccionArticulos = document.getElementById('seccion-articulos-receta');
            const contenedorArticulos = document.getElementById('contenedor-articulos');
            const formActionsArticulos = document.getElementById('form-actions-articulos');
            
            if (tipoCarro === 'externa') {
                if (seccionArticulos) seccionArticulos.style.display = 'block';
                if (contenedorArticulos) contenedorArticulos.style.display = 'block';
                if (formActionsArticulos) formActionsArticulos.style.display = 'block';
                
                // Cargar artículos disponibles
                await cargarArticulosDisponibles();
            } else {
                if (seccionArticulos) seccionArticulos.style.display = 'none';
                if (contenedorArticulos) contenedorArticulos.style.display = 'none';
                if (formActionsArticulos) formActionsArticulos.style.display = 'none';
            }
            
            // Cargar ingredientes disponibles
            await cargarIngredientesDisponibles();
            
            // Intentar obtener la receta existente
            if (modo !== 'crear') {
                try {
                    const response = await fetch(`http://localhost:3002/api/produccion/recetas/${encodeURIComponent(articulo_numero)}`);
                    
                    if (response.ok) {
                        const receta = await response.json();
                        document.getElementById('descripcion_receta').value = receta.descripcion || '';
                        state.ingredientesCargados = receta.ingredientes || [];
                        state.articulosReceta = receta.articulos || [];
                        state.existeReceta = true;
                    } else if (response.status === 404) {
                        document.getElementById('descripcion_receta').value = '';
                        state.ingredientesCargados = [];
                        state.articulosReceta = [];
                        state.existeReceta = false;
                    }
                } catch (error) {
                    console.error('Error al cargar la receta:', error);
                    document.getElementById('descripcion_receta').value = '';
                    state.ingredientesCargados = [];
                    state.articulosReceta = [];
                }
            } else {
                document.getElementById('descripcion_receta').value = '';
                state.ingredientesCargados = [];
                state.articulosReceta = [];
            }

            // Actualizar tablas
            const tbody = document.querySelector('#tabla-ingredientes tbody');
            if (tbody) {
                tbody.innerHTML = '';
                state.ingredientesCargados.forEach((ingrediente, index) => {
                    agregarIngredienteATabla(ingrediente, index);
                });
            }

            const tbodyArticulos = document.querySelector('#tabla-articulos-receta tbody');
            if (tbodyArticulos) {
                tbodyArticulos.innerHTML = '';
                state.articulosReceta.forEach((articulo, index) => {
                    agregarArticuloATabla(articulo, index);
                });
            }

            modal.style.display = 'block';
            setTimeout(() => {
                modal.classList.add('show');
            }, 10);

        } catch (error) {
            console.error('Error al preparar el modal de receta:', error);
            mostrarError('Error al preparar el formulario de receta');
            modal.style.display = 'none';
        }
    }
}

// Funciones auxiliares para ingredientes
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

// Event listeners
document.addEventListener('DOMContentLoaded', () => {
    // Event listeners para el modal de receta
    const btnGuardarReceta = document.getElementById('btn-guardar-receta');
    if (btnGuardarReceta) {
        btnGuardarReceta.addEventListener('click', async () => {
            try {
                const articulo_numero = document.getElementById('articulo_numero').value.trim();
                const descripcion = document.getElementById('descripcion_receta').value;

                if (!articulo_numero) {
                    throw new Error('El código de artículo es requerido');
                }

                if (state.ingredientesCargados.length === 0 && state.articulosReceta.length === 0) {
                    throw new Error('Debe agregar al menos un ingrediente o artículo a la receta');
                }

                // Detectar si es un carro de producción externa para permitir recetas sin ingredientes
                const carroId = localStorage.getItem('carroActivo');
                let esProduccionExternaConArticuloPrincipal = false;
                
                if (carroId) {
                    try {
                        const carroResponse = await fetch(`http://localhost:3002/api/produccion/carro/${carroId}/estado`);
                        if (carroResponse.ok) {
                            const carroData = await carroResponse.json();
                            const tipoCarro = carroData.tipo_carro || 'interna';
                            // Es producción externa con artículo principal si:
                            // 1. Es carro externo
                            // 2. Tiene artículos en la receta (artículo principal)
                            // 3. No tiene ingredientes (solo el artículo principal)
                            esProduccionExternaConArticuloPrincipal = (
                                tipoCarro === 'externa' && 
                                state.articulosReceta.length > 0 && 
                                state.ingredientesCargados.length === 0
                            );
                        }
                    } catch (error) {
                        console.warn('Error al obtener tipo de carro:', error);
                    }
                }

                const datos = {
                    articulo_numero,
                    descripcion,
                    ingredientes: state.ingredientesCargados.map(ing => ({
                        ingrediente_id: ing.ingrediente_id,
                        nombre_ingrediente: ing.nombre_ingrediente,
                        unidad_medida: ing.unidad_medida,
                        cantidad: Number(ing.cantidad)
                    })),
                    articulos: state.articulosReceta.map(art => ({
                        articulo_numero: art.articulo_numero,
                        cantidad: Number(art.cantidad)
                    })),
                    esProduccionExternaConArticuloPrincipal: esProduccionExternaConArticuloPrincipal
                };

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
                    throw new Error(errorData.error || 'Error al guardar la receta');
                }

                state.ultimoArticuloEditado = articulo_numero;
                await actualizarTablaArticulos(state.articulosFiltrados);
                cerrarModalReceta();

                const successDiv = document.createElement('div');
                successDiv.className = 'success-message';
                successDiv.textContent = 'Receta guardada correctamente';
                successDiv.style.cssText = `
                    position: fixed;
                    top: 20px;
                    right: 20px;
                    background-color: #28a745;
                    color: white;
                    padding: 10px 20px;
                    border-radius: 4px;
                    z-index: 10000;
                `;
                document.body.appendChild(successDiv);

                setTimeout(() => {
                    successDiv.remove();
                }, 3000);

            } catch (error) {
                mostrarError(error.message);
            }
        });
    }

    // Event listeners para agregar ingredientes
    const btnAgregarIngrediente = document.getElementById('btn-agregar-ingrediente');
    if (btnAgregarIngrediente) {
        btnAgregarIngrediente.addEventListener('click', () => {
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
                    cantidad: cantidad
                };
                
                state.ingredientesCargados.push(ingrediente);
                agregarIngredienteATabla(ingrediente);
                
                selector.value = '';
                cantidadInput.value = '';
                
            } catch (error) {
                mostrarError(error.message);
            }
        });
    }

    // Event listeners para agregar artículos
    const btnAgregarArticulo = document.getElementById('btn-agregar-articulo');
    if (btnAgregarArticulo) {
        btnAgregarArticulo.addEventListener('click', agregarArticuloDesdeSelector);
    }

    // Event listeners para selectores
    const selectorIngrediente = document.getElementById('selector-ingrediente');
    if (selectorIngrediente) {
        selectorIngrediente.addEventListener('change', () => {
            const cantidadContainer = document.getElementById('cantidad-container');
            if (cantidadContainer) {
                cantidadContainer.style.display = selectorIngrediente.value ? 'block' : 'none';
            }
        });
    }

    const selectorArticulo = document.getElementById('selector-articulo');
    if (selectorArticulo) {
        selectorArticulo.addEventListener('change', toggleCantidadArticuloField);
    }

    // Event listeners para eliminar elementos
    document.addEventListener('click', (e) => {
        if (e.target.classList.contains('btn-eliminar-ingrediente')) {
            const index = parseInt(e.target.dataset.index);
            if (!isNaN(index) && index >= 0 && index < state.ingredientesCargados.length) {
                state.ingredientesCargados.splice(index, 1);
                e.target.closest('tr').remove();
                const tbody = document.querySelector('#tabla-ingredientes tbody');
                tbody.querySelectorAll('.btn-eliminar-ingrediente').forEach((btn, i) => {
                    btn.dataset.index = i;
                });
            }
        }

        if (e.target.classList.contains('btn-eliminar-articulo-receta')) {
            const index = parseInt(e.target.dataset.index);
            eliminarArticuloDeTabla(index);
        }

        if (e.target.classList.contains('btn-agregar')) {
            const articulo_numero = e.target.dataset.numero;
            const descripcion = e.target.dataset.nombre;
            agregarAlCarro(articulo_numero, descripcion, e.target);
        }

        if (e.target.classList.contains('btn-editar-receta')) {
            const articulo_numero = e.target.dataset.numero;
            const articulo_nombre = e.target.dataset.nombre;
            const modo = e.target.dataset.modo;
            mostrarModalReceta(articulo_numero, articulo_nombre, modo);
        }

        if (e.target.classList.contains('btn-desvincular-receta')) {
            const articulo_numero = e.target.dataset.numero;
            const articulo_nombre = e.target.dataset.nombre;
            desvincularReceta(articulo_numero, articulo_nombre);
        }
    });

    // Event listeners para cerrar modales
    const modalReceta = document.getElementById('modal-receta');
    if (modalReceta) {
        const btnCerrar = modalReceta.querySelector('.close-modal');
        if (btnCerrar) {
            btnCerrar.addEventListener('click', cerrarModalReceta);
        }

        modalReceta.addEventListener('click', (e) => {
            if (e.target === modalReceta) {
                cerrarModalReceta();
            }
        });
    }

    const modalArticulos = document.getElementById('modal-articulos');
    if (modalArticulos) {
        const btnCerrar = modalArticulos.querySelector('.close-modal');
        if (btnCerrar) {
            btnCerrar.addEventListener('click', cerrarModalArticulos);
        }

        modalArticulos.addEventListener('click', (e) => {
            if (e.target === modalArticulos) {
                cerrarModalArticulos();
            }
        });
    }
});

// Función para desvincular receta
async function desvincularReceta(articulo_numero, articulo_nombre) {
    try {
        if (!confirm(`¿Está seguro que desea desvincular la receta del artículo ${articulo_nombre}?`)) {
            return;
        }

        const deleteResponse = await fetch(`http://localhost:3002/api/produccion/recetas/${encodeURIComponent(articulo_numero)}`, {
            method: 'DELETE'
        });

        if (!deleteResponse.ok) {
            const errorData = await deleteResponse.json();
            throw new Error(errorData.error || 'Error al desvincular la receta');
        }

        await actualizarTablaArticulos(state.articulosFiltrados);

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
