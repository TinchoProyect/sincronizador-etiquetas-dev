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
    tipoCarro: 'interna',
    // Mejora solicitada por Martín - selección persistente en modal de artículos
    selectedArticles: new Map() // Map<numero_articulo, {nombre, cantidad, esIntegra}>
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

            const responseData = await response.json();
            // ✅ CORRECCIÓN: Manejar nuevo formato de respuesta { success, data, total }
            const articulos = responseData.data || responseData;

            if (articulos.length === 0) {
                const mensaje = tipoCarro === 'externa'
                    ? 'No se encontraron artículos de producción externa disponibles'
                    : 'No se encontraron artículos disponibles';
                mostrarError(mensaje);
                return;
            }

            // 🔍 FASE 1: Filtrar artículos ya agregados al carro (solo producción interna)
            let articulosDisponibles = articulos;
            if (tipoCarro === 'interna' && carroId) {
                articulosDisponibles = await filtrarArticulosYaAgregados(articulos, carroId);
                console.log(`🔍 [FASE 1] Filtro aplicado - Artículos totales: ${articulos.length}, Disponibles: ${articulosDisponibles.length}`);
            }

            state[cacheKey] = articulosDisponibles;
            state.todosLosArticulos = articulosDisponibles;
            state.articulosFiltrados = [...articulosDisponibles];
            aplicarFiltros(0);
        } else {
            // 🔍 FASE 1: Aplicar filtro también al usar caché (solo producción interna)
            let articulosDisponibles = state[cacheKey];
            if (tipoCarro === 'interna' && carroId) {
                // Re-obtener artículos originales para aplicar filtro actualizado
                const url = 'http://localhost:3002/api/produccion/articulos';
                const response = await fetch(url);
                if (response.ok) {
                    const responseData = await response.json();
                    // ✅ CORRECCIÓN: Manejar nuevo formato de respuesta { success, data, total }
                    const articulosOriginales = responseData.data || responseData;
                    articulosDisponibles = await filtrarArticulosYaAgregados(articulosOriginales, carroId);
                    console.log(`🔍 [FASE 1] Filtro aplicado (caché) - Artículos totales: ${articulosOriginales.length}, Disponibles: ${articulosDisponibles.length}`);

                    // Actualizar caché con artículos filtrados
                    state[cacheKey] = articulosDisponibles;
                }
            }

            state.todosLosArticulos = articulosDisponibles;
            state.articulosFiltrados = [...articulosDisponibles];
            aplicarFiltros(0);
        }

        const modalTitle = modal.querySelector('h2');
        if (modalTitle) {
            const tipoTexto = tipoCarro === 'externa' ? 'Producción Externa' : 'Producción Interna';
            const icono = tipoCarro === 'externa' ? '' : '🏭 '; // Sin icono para externos
            modalTitle.textContent = `${icono}Seleccionar Artículo - ${tipoTexto}`;
        }

        // 🎯 AJUSTE UI: Ocultar botón "Agregar al carro" para Producción Externa
        // En carros externos, los artículos se seleccionan desde las tarjetas individuales
        const btnAgregarMultiples = document.getElementById('btn-agregar-multiples');
        if (btnAgregarMultiples) {
            if (tipoCarro === 'externa') {
                btnAgregarMultiples.style.display = 'none';
                console.log('🎨 [UI-LIMPIA] Botón "Agregar al carro" ocultado para Producción Externa');
            } else {
                // Para producción interna, la visibilidad se maneja en actualizarVisibilidadBotonMultiple()
                console.log('🎨 [UI-LIMPIA] Botón "Agregar al carro" disponible para Producción Interna');
            }
        }

    } catch (error) {
        console.error('Error al abrir modal de artículos:', error);
        mostrarError(error.message);
        const modal = document.getElementById('modal-articulos');
        modal.style.display = 'none';
    }
}

/**
 * 🔍 FASE 1: Filtra artículos que ya están agregados al carro actual
 * Solo se ejecuta para carros de producción interna
 * @param {Array} articulos - Lista completa de artículos disponibles
 * @param {string} carroId - ID del carro activo
 * @returns {Array} Artículos filtrados (sin los ya agregados al carro)
 */
async function filtrarArticulosYaAgregados(articulos, carroId) {
    try {
        const colaboradorData = localStorage.getItem('colaboradorActivo');
        if (!colaboradorData) {
            console.warn('🔍 [FASE 1] No hay colaborador activo, no se puede filtrar');
            return articulos;
        }

        const colaborador = JSON.parse(colaboradorData);

        // Obtener artículos ya agregados al carro
        const response = await fetch(`http://localhost:3002/api/produccion/carro/${carroId}/articulos?usuarioId=${colaborador.id}`);

        if (!response.ok) {
            console.warn('🔍 [FASE 1] Error al obtener artículos del carro, no se aplicará filtro');
            return articulos;
        }

        const articulosEnCarro = await response.json();
        const numerosEnCarro = articulosEnCarro.map(art => art.numero);

        console.log(`🔍 [FASE 1] Artículos en carro: ${numerosEnCarro.length} (${numerosEnCarro.slice(0, 3).join(', ')}${numerosEnCarro.length > 3 ? '...' : ''})`);

        // Filtrar artículos que no están en el carro
        const articulosFiltrados = articulos.filter(art => !numerosEnCarro.includes(art.numero));

        return articulosFiltrados;

    } catch (error) {
        console.error('🔍 [FASE 1] Error al filtrar artículos ya agregados:', error);
        return articulos; // En caso de error, devolver todos los artículos
    }
}

// Función para cerrar el modal
export function cerrarModalArticulos() {
    const modal = document.getElementById('modal-articulos');
    modal.classList.remove('show');
    setTimeout(() => {
        modal.style.display = 'none';
    }, 300);

    // Limpiar campo de búsqueda inteligente
    const busquedaInteligente = document.getElementById('busqueda-inteligente');
    if (busquedaInteligente) {
        busquedaInteligente.value = '';
    }

    // Limpiar código de barras
    const codigoBarras = document.getElementById('codigo-barras');
    if (codigoBarras) {
        codigoBarras.value = '';
    }

    // Mejora solicitada por Martín - limpiar selecciones persistentes al cerrar modal
    state.selectedArticles.clear();
    actualizarResumenSeleccionados();
    console.log('🔍 [SELECCIÓN PERSISTENTE] Selecciones limpiadas al cerrar modal');
}

// Función para actualizar la tabla de artículos
export async function actualizarTablaArticulos(articulos) {
    const tbody = document.getElementById('tabla-articulos-body');
    tbody.innerHTML = '';

    if (!articulos || articulos.length === 0) {
        tbody.innerHTML = '<tr><td colspan="5" class="text-center">No hay artículos disponibles</td></tr>';
        return;
    }

    try {
        // 🔍 [FASE 2] Detectar tipo de carro para habilitar selección múltiple
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
                console.warn('Error al obtener tipo de carro para tabla:', error);
            }
        }

        console.log('🔍 [FASE 2] Renderizando tabla para tipo de carro:', tipoCarro);

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

        // 🔍 [FASE 2] Actualizar encabezado de tabla según tipo de carro
        const tableHeader = document.getElementById('tabla-articulos-header');

        // 🎨 REDISEÑO UX: Para carros externos, usar vista de tarjetas en lugar de tabla
        if (tipoCarro === 'externa') {
            // Ocultar tabla y mostrar contenedor de tarjetas
            const tablaArticulos = document.querySelector('.tabla-articulos');
            if (tablaArticulos) {
                tablaArticulos.style.display = 'none';
            }

            // Crear o mostrar contenedor de tarjetas
            let contenedorTarjetas = document.getElementById('contenedor-tarjetas-articulos');
            if (!contenedorTarjetas) {
                contenedorTarjetas = document.createElement('div');
                contenedorTarjetas.id = 'contenedor-tarjetas-articulos';
                contenedorTarjetas.className = 'contenedor-tarjetas-articulos';
                tbody.parentElement.parentElement.appendChild(contenedorTarjetas);
            }
            contenedorTarjetas.style.display = 'grid';
            contenedorTarjetas.innerHTML = ''; // Limpiar contenido previo

            // Renderizar tarjetas para producción externa
            await renderizarTarjetasProduccionExterna(produccion, contenedorTarjetas, estadoRecetas, integridadRecetas);

            return; // Salir temprano para carros externos
        } else {
            // Para carros internos, ocultar tarjetas y mostrar tabla
            const contenedorTarjetas = document.getElementById('contenedor-tarjetas-articulos');
            if (contenedorTarjetas) {
                contenedorTarjetas.style.display = 'none';
            }
            const tablaArticulos = document.querySelector('.tabla-articulos');
            if (tablaArticulos) {
                tablaArticulos.style.display = 'table';
            }
        }

        if (tableHeader) {
            if (tipoCarro === 'interna') {
                tableHeader.innerHTML = `
                    <th style="width: 50px; text-align: center;">Sel.</th>
                    <th>Código</th>
                    <th>Descripción</th>
                    <th>Stock</th>
                    <th>Acciones</th>
                `;
            } else {
                tableHeader.innerHTML = `
                    <th>Código</th>
                    <th>Descripción</th>
                    <th>Stock</th>
                    <th>Acciones</th>
                `;
            }
        }

        function renderGroup(title, group) {
            const headerRow = document.createElement('tr');
            const headerCell = document.createElement('td');
            headerCell.colSpan = tipoCarro === 'interna' ? 5 : 4; // 🔍 [FASE 2] Ajustar colspan según tipo
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

                // 🔍 [FASE 2] Generar HTML diferente según tipo de carro
                if (tipoCarro === 'interna') {
                    // PRODUCCIÓN INTERNA: Checkbox + cantidad editable + botones de receta
                    tr.innerHTML = `
                        <td style="text-align: center;">
                            ${tieneReceta ? `<input type="checkbox" class="seleccionar-articulo modal-articulos-interna-multiple" data-numero="${articulo.numero}" data-nombre="${articulo.nombre.replace(/'/g, "\\'")}" data-integra="${esIntegra}">` : ''}
                        </td>
                        <td>${articulo.numero}</td>
                        <td>${articulo.nombre.replace(/'/g, "\\'")}</td>
                        <td style="text-align: center; font-weight: bold; color: ${articulo.stock_consolidado > 0 ? '#28a745' : '#dc3545'};">
                            ${formatearStock(articulo.stock_consolidado || 0)}
                        </td>
                        <td>
                            ${tieneReceta ? `
                                <input type="number" class="cantidad-multiple modal-articulos-interna-multiple" min="1" value="1" style="width: 60px; margin-right: 6px;" data-numero="${articulo.numero}">
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
                } else {
                    // PRODUCCIÓN EXTERNA: Comportamiento original
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
                }
                tbody.appendChild(tr);
            });
        }

        const filtroProduccionSwitch = document.getElementById('filtroProduccionSwitch');
        const mostrarSoloProduccion = filtroProduccionSwitch ? filtroProduccionSwitch.checked : false;

        if (mostrarSoloProduccion) {
            if (produccion.length === 0) {
                const colspanValue = tipoCarro === 'interna' ? 5 : 4;
                tbody.innerHTML = `<tr><td colspan="${colspanValue}" class="text-center">No hay artículos de producción disponibles</td></tr>`;
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
                const colspanValue = tipoCarro === 'interna' ? 5 : 4;
                tbody.innerHTML = `<tr><td colspan="${colspanValue}" class="text-center">No hay artículos disponibles</td></tr>`;
            }
        }

        // 🔍 [FASE 2] Actualizar visibilidad del botón de agregar múltiples
        actualizarVisibilidadBotonMultiple();

        // 🔍 [OPTIMIZACIÓN] Agregar event listeners para auto-selección al modificar cantidad
        if (tipoCarro === 'interna') {
            agregarEventListenersAutoSeleccion();
        }

        // Mejora solicitada por Martín - restaurar selecciones después de actualizar tabla
        if (tipoCarro === 'interna') {
            restaurarSeleccionesPreservadas();
        }

    } catch (error) {
        console.error('Error al actualizar tabla:', error);
        const colspanValue = 4; // Valor por defecto en caso de error
        tbody.innerHTML = `<tr><td colspan="${colspanValue}" class="text-center">Error al cargar artículos</td></tr>`;
    }
}

/**
 * Normaliza un texto para búsqueda: minúsculas y sin acentos
 * @param {string} texto - Texto a normalizar
 * @returns {string} Texto normalizado
 */
function normalizarTexto(texto) {
    if (!texto) return '';
    return texto
        .toLowerCase()
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "");
}

/**
 * Función para aplicar filtros con búsqueda inteligente multi-término
 * Permite buscar por múltiples palabras separadas por espacios
 * Los artículos deben contener TODOS los términos (sin importar el orden)
 */
export function aplicarFiltros(filtroIndex) {
    // Mejora solicitada por Martín - preservar selecciones antes de filtrar
    preservarSeleccionesActuales();

    // Obtener valor del campo de búsqueda inteligente
    const busquedaInteligente = document.getElementById('busqueda-inteligente');
    const textoBusqueda = busquedaInteligente ? busquedaInteligente.value.trim() : '';

    const filtroProduccionSwitch = document.getElementById('filtroProduccionSwitch');
    const mostrarSoloProduccion = filtroProduccionSwitch ? filtroProduccionSwitch.checked : false;

    let resultados = state.todosLosArticulos;

    // Aplicar búsqueda inteligente multi-término
    if (textoBusqueda) {
        // Normalizar el texto de búsqueda
        const textoNormalizado = normalizarTexto(textoBusqueda);

        // Dividir por espacios para obtener términos individuales
        const terminos = textoNormalizado.split(/\s+/).filter(t => t.length > 0);

        console.log(`🔍 [BÚSQUEDA INTELIGENTE] Buscando con ${terminos.length} término(s):`, terminos);

        if (terminos.length > 0) {
            // Filtrar artículos que contengan TODOS los términos
            resultados = resultados.filter(art => {
                const nombreNormalizado = normalizarTexto(art.nombre);

                // Verificar que el nombre contenga TODOS los términos
                const contieneTodasLasPalabras = terminos.every(termino =>
                    nombreNormalizado.includes(termino)
                );

                return contieneTodasLasPalabras;
            });

            console.log(`🔍 [BÚSQUEDA INTELIGENTE] Resultados encontrados: ${resultados.length}`);
        }
    }

    // Aplicar filtro de producción
    if (mostrarSoloProduccion) {
        resultados = resultados.filter(art => art.no_producido_por_lambda === false);
    }

    // Mejora solicitada por Martín - incluir artículos seleccionados aunque no coincidan con filtro
    const articulosSeleccionados = Array.from(state.selectedArticles.keys());
    const articulosSeleccionadosData = state.todosLosArticulos.filter(art =>
        articulosSeleccionados.includes(art.numero) && !resultados.some(r => r.numero === art.numero)
    );

    if (articulosSeleccionadosData.length > 0) {
        console.log(`🔍 [SELECCIÓN PERSISTENTE] Agregando ${articulosSeleccionadosData.length} artículos seleccionados que no coinciden con filtro`);
        resultados = [...articulosSeleccionadosData, ...resultados];
    }

    // Ordenar resultados
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
    const buscarIng = document.getElementById('buscar-ingrediente-receta');
    if (buscarIng) buscarIng.value = '';
    const cntContainer = document.getElementById('cantidad-container');
    if (cntContainer) cntContainer.style.display = 'none';

    const buscarArt = document.getElementById('buscar-articulo-receta');
    if (buscarArt) buscarArt.value = '';
    const cntArtContainer = document.getElementById('cantidad-articulo-container');
    if (cntArtContainer) cntArtContainer.style.display = 'none';
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
            console.log('🔄 [AGREGAR] Iniciando actualización completa del resumen...');

            // 🎯 DELAY ESTRATÉGICO: Esperar a que el backend procese completamente
            await new Promise(resolve => setTimeout(resolve, 300));

            // 1. Actualizar lista de artículos del carro
            await mostrarArticulosDelCarro();
            console.log('✅ [AGREGAR] Lista de artículos actualizada');

            // 2. FORZAR recarga de ingredientes
            const ingredientes = await obtenerResumenIngredientesCarro(carroId, colaborador.id);
            await mostrarResumenIngredientes(ingredientes);
            console.log('✅ [AGREGAR] Resumen de ingredientes actualizado');

            // 3. FORZAR recarga de mixes
            const mixes = await obtenerResumenMixesCarro(carroId, colaborador.id);
            mostrarResumenMixes(mixes);
            console.log('✅ [AGREGAR] Resumen de mixes actualizado');

            // 4. 🎯 FORZAR ACTUALIZACIÓN DE ARTÍCULOS EXTERNOS (CRÍTICO)
            const articulos = await obtenerResumenArticulosCarro(carroId, colaborador.id);
            const seccionArticulos = document.getElementById('resumen-articulos');

            console.log(`🔍 [AGREGAR-ARTÍCULOS] Artículos obtenidos: ${articulos?.length || 0}`);

            if (articulos && articulos.length > 0) {
                // FORZAR visualización de la sección
                if (seccionArticulos) {
                    seccionArticulos.style.display = 'block';
                    // Forzar reflow para asegurar que el cambio se aplique
                    seccionArticulos.offsetHeight;
                    console.log('✅ [AGREGAR-ARTÍCULOS] Sección mostrada y forzado reflow');
                }

                // FORZAR actualización de la tabla
                mostrarResumenArticulos(articulos);
                console.log('✅ [AGREGAR-ARTÍCULOS] Tabla actualizada con datos');
            } else {
                // Si no hay artículos, ocultar sección
                if (seccionArticulos) {
                    seccionArticulos.style.display = 'none';
                    console.log('ℹ️ [AGREGAR-ARTÍCULOS] No hay artículos, sección oculta');
                }
            }

            console.log('✅ [AGREGAR] Resumen completo actualizado correctamente');
        } catch (updateError) {
            console.error('⚠️ [AGREGAR] Error al actualizar resumen:', updateError);
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
        const responseData = await response.json();
        // ✅ CORRECCIÓN: Manejar nuevo formato de respuesta { success, data, total }
        const articulos = responseData.data || responseData;
        state.articulosDisponibles = articulos;
        actualizarSelectorArticulos();
    } catch (error) {
        mostrarError(error.message);
        console.error(error);
    }
}

export function actualizarSelectorArticulos() {
    const inputBuscar = document.getElementById('buscar-articulo-receta');
    const inputOculto = document.getElementById('selector-articulo');
    if (inputBuscar) inputBuscar.value = '';
    if (inputOculto) inputOculto.value = '';
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
        const buscarArt = document.getElementById('buscar-articulo-receta');
        if (buscarArt) buscarArt.value = '';
        const cntArtContainer = document.getElementById('cantidad-articulo-container');
        if (cntArtContainer) cntArtContainer.style.display = 'none';
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
    const inputBuscar = document.getElementById('buscar-ingrediente-receta');
    const inputOculto = document.getElementById('selector-ingrediente');
    if (inputBuscar) inputBuscar.value = '';
    if (inputOculto) inputOculto.value = '';
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

// --- LÓGICA DE BÚSQUEDA INTELIGENTE PARA MODAL RECETA ---
function manejarBusquedaIngredienteReceta(e) {
    const input = e.target;
    const listaResultados = document.getElementById('lista-resultados-ingrediente-receta');
    const hiddenInput = document.getElementById('selector-ingrediente');
    const query = input.value.trim();

    if (query === '') {
        hiddenInput.value = '';
        listaResultados.style.display = 'none';
        const cantidadContainer = document.getElementById('cantidad-container');
        if (cantidadContainer) cantidadContainer.style.display = 'none';
        return;
    }

    const tokens = normalizarTexto(query).split(/\s+/).filter(t => t.length > 0);

    const resultados = ingredientesDisponibles.filter(ing => {
        const nombreNormalizado = normalizarTexto(ing.nombre);
        return tokens.every(token => nombreNormalizado.includes(token)); // Lógica AND
    });

    listaResultados.innerHTML = '';
    if (resultados.length > 0) {
        resultados.slice(0, 50).forEach(ing => {
            const li = document.createElement('li');
            const sectorDisplay = ing.sector_letra ? ` [Sector ${ing.sector_letra}]` : '';
            li.textContent = `${ing.nombre} (${ing.unidad_medida})${sectorDisplay}`;

            li.addEventListener('click', () => {
                hiddenInput.value = ing.id;
                input.value = ing.nombre;
                listaResultados.innerHTML = '';
                listaResultados.style.display = 'none';

                // Mostrar campo de cantidad y hacerle focus
                const cantidadContainer = document.getElementById('cantidad-container');
                if (cantidadContainer) {
                    cantidadContainer.style.display = 'block';
                    document.getElementById('input-cantidad-ingrediente').focus();
                }
            });
            listaResultados.appendChild(li);
        });
        listaResultados.style.display = 'block';
    } else {
        listaResultados.innerHTML = '<li style="padding: 8px 12px; color: #dc3545; cursor: default;">No se encontraron ingredientes</li>';
        listaResultados.style.display = 'block';
    }
}

function manejarBusquedaArticuloReceta(e) {
    const input = e.target;
    const listaResultados = document.getElementById('lista-resultados-articulo-receta');
    const hiddenInput = document.getElementById('selector-articulo');
    const query = input.value.trim();

    if (query === '') {
        hiddenInput.value = '';
        listaResultados.style.display = 'none';
        const cantidadContainer = document.getElementById('cantidad-articulo-container');
        if (cantidadContainer) cantidadContainer.style.display = 'none';
        return;
    }

    const tokens = normalizarTexto(query).split(/\s+/).filter(t => t.length > 0);

    const resultados = (state.articulosDisponibles || []).filter(art => {
        const nombreNormalizado = normalizarTexto(art.nombre);
        const numeroNormalizado = normalizarTexto(art.numero ? art.numero.toString() : '');
        return tokens.every(token => nombreNormalizado.includes(token) || numeroNormalizado.includes(token));
    });

    listaResultados.innerHTML = '';
    if (resultados.length > 0) {
        resultados.slice(0, 50).forEach(art => {
            const li = document.createElement('li');
            const stockFormateado = formatearStock(art.stock_consolidado);
            const sectorDisplay = art.sector_letra ? ` [Sector ${art.sector_letra}]` : '';
            li.innerHTML = `
                <div style="display: flex; justify-content: space-between; width: 100%;">
                    <span>${art.numero} - ${art.nombre}${sectorDisplay}</span>
                    <span style="color: #6c757d; font-size: 0.9em; font-weight: bold;">(Stock: ${stockFormateado})</span>
                </div>
            `;

            li.addEventListener('click', () => {
                hiddenInput.value = art.numero;
                input.value = art.nombre;
                listaResultados.innerHTML = '';
                listaResultados.style.display = 'none';

                // Mostrar campo de cantidad y hacerle focus
                const cantidadContainer = document.getElementById('cantidad-articulo-container');
                if (cantidadContainer) {
                    cantidadContainer.style.display = 'block';
                    document.getElementById('input-cantidad-articulo').focus();
                }
            });
            listaResultados.appendChild(li);
        });
        listaResultados.style.display = 'block';
    } else {
        listaResultados.innerHTML = '<li style="padding: 8px 12px; color: #dc3545; cursor: default;">No se encontraron artículos</li>';
        listaResultados.style.display = 'block';
    }
}

// Event listeners
document.addEventListener('DOMContentLoaded', () => {
    // Activar buscadores inteligentes de la receta
    const inputBuscarIngrediente = document.getElementById('buscar-ingrediente-receta');
    if (inputBuscarIngrediente) {
        inputBuscarIngrediente.addEventListener('input', manejarBusquedaIngredienteReceta);
        inputBuscarIngrediente.addEventListener('focus', manejarBusquedaIngredienteReceta);
    }

    const inputBuscarArticulo = document.getElementById('buscar-articulo-receta');
    if (inputBuscarArticulo) {
        inputBuscarArticulo.addEventListener('input', manejarBusquedaArticuloReceta);
        inputBuscarArticulo.addEventListener('focus', manejarBusquedaArticuloReceta);
    }

    // Ocultar listas al hacer clic fuera
    document.addEventListener('click', (e) => {
        if (inputBuscarIngrediente && e.target !== inputBuscarIngrediente) {
            const listaIng = document.getElementById('lista-resultados-ingrediente-receta');
            if (listaIng && !listaIng.contains(e.target)) listaIng.style.display = 'none';
        }
        if (inputBuscarArticulo && e.target !== inputBuscarArticulo) {
            const listaArt = document.getElementById('lista-resultados-articulo-receta');
            if (listaArt && !listaArt.contains(e.target)) listaArt.style.display = 'none';
        }
    });

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

                // 🔄 EMITIR EVENTO DE ACTUALIZACIÓN para sincronizar modales
                console.log('🔔 [EVENTO] Emitiendo evento recetaActualizada...');
                document.dispatchEvent(new CustomEvent('recetaActualizada', {
                    detail: { articulo_numero }
                }));

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
                const buscarIng = document.getElementById('buscar-ingrediente-receta');
                if (buscarIng) buscarIng.value = '';
                const cntContainer = document.getElementById('cantidad-container');
                if (cntContainer) cntContainer.style.display = 'none';
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

        // ELIMINADO: Click fuera del modal ya NO cierra (backdrop estático)
        // El modal solo se cierra con el botón X o botón Cerrar
    }

    // Mejora solicitada por Martín - Event listeners para checkboxes de selección múltiple
    document.addEventListener('change', (e) => {
        if (e.target.classList.contains('seleccionar-articulo')) {
            const checkbox = e.target;
            const numeroArticulo = checkbox.dataset.numero;
            const nombreArticulo = checkbox.dataset.nombre;
            const esIntegra = checkbox.dataset.integra === 'true';

            // Buscar input de cantidad correspondiente
            const inputCantidad = document.querySelector(`.cantidad-multiple[data-numero="${numeroArticulo}"]`);
            const cantidad = inputCantidad ? parseFloat(inputCantidad.value) || 1 : 1;

            if (checkbox.checked) {
                // Agregar a selección persistente
                actualizarSeleccionEnTiempoReal(numeroArticulo, nombreArticulo, esIntegra, cantidad);

                // Agregar clase visual
                const fila = checkbox.closest('tr');
                if (fila) {
                    fila.classList.add('selected-row');
                }

                console.log(`🔍 [CHECKBOX] Seleccionado: ${nombreArticulo} (${cantidad})`);
            } else {
                // Remover de selección persistente
                removerSeleccionEnTiempoReal(numeroArticulo);

                // Remover clase visual
                const fila = checkbox.closest('tr');
                if (fila) {
                    fila.classList.remove('selected-row');
                }

                console.log(`🔍 [CHECKBOX] Deseleccionado: ${nombreArticulo}`);
            }
        }
    });
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

// 🔍 [FASE 2] FUNCIONES PARA SELECCIÓN MÚLTIPLE (SOLO PRODUCCIÓN INTERNA)

/**
 * Actualiza la visibilidad del botón de agregar múltiples artículos
 * Solo se muestra para carros de producción interna
 */
export function actualizarVisibilidadBotonMultiple() {
    const btnAgregarMultiples = document.getElementById('btn-agregar-multiples');
    if (!btnAgregarMultiples) return;

    // Detectar si hay checkboxes de selección múltiple en la tabla
    const checkboxes = document.querySelectorAll('.seleccionar-articulo');

    if (checkboxes.length > 0) {
        btnAgregarMultiples.style.display = 'inline-block';
        console.log('🔍 [FASE 2] Botón múltiple habilitado - checkboxes encontrados:', checkboxes.length);
    } else {
        btnAgregarMultiples.style.display = 'none';
        console.log('🔍 [FASE 2] Botón múltiple oculto - no hay checkboxes');
    }
}

/**
 * Función principal para agregar múltiples artículos al carro
 * Solo funciona para carros de producción interna
 */
export async function agregarMultiplesAlCarroInterno() {
    try {
        console.log('🔍 [FASE 2] Iniciando agregado múltiple...');

        // Verificar que es un carro de producción interna
        const carroId = localStorage.getItem('carroActivo');
        if (!carroId) {
            throw new Error('No hay un carro de producción activo');
        }

        let tipoCarro = 'interna';
        try {
            const carroResponse = await fetch(`http://localhost:3002/api/produccion/carro/${carroId}/estado`);
            if (carroResponse.ok) {
                const carroData = await carroResponse.json();
                tipoCarro = carroData.tipo_carro || 'interna';
            }
        } catch (error) {
            console.warn('Error al verificar tipo de carro:', error);
        }

        if (tipoCarro !== 'interna') {
            throw new Error('La selección múltiple solo está disponible para producción interna');
        }

        // Obtener artículos seleccionados
        const checkboxesSeleccionados = document.querySelectorAll('.seleccionar-articulo:checked');

        if (checkboxesSeleccionados.length === 0) {
            throw new Error('Debe seleccionar al menos un artículo');
        }

        console.log(`🔍 [FASE 2] Artículos seleccionados: ${checkboxesSeleccionados.length}`);

        // Validar cantidades y preparar datos
        const articulosParaAgregar = [];
        let hayErrores = false;
        let articulosConAdvertencias = [];

        checkboxesSeleccionados.forEach(checkbox => {
            const numeroArticulo = checkbox.dataset.numero;
            const nombreArticulo = checkbox.dataset.nombre;
            const esIntegra = checkbox.dataset.integra === 'true';

            // Buscar el input de cantidad correspondiente
            const inputCantidad = document.querySelector(`.cantidad-multiple[data-numero="${numeroArticulo}"]`);

            if (!inputCantidad) {
                console.error(`No se encontró input de cantidad para artículo ${numeroArticulo}`);
                hayErrores = true;
                return;
            }

            const cantidad = parseFloat(inputCantidad.value);

            if (isNaN(cantidad) || cantidad <= 0) {
                console.error(`Cantidad inválida para artículo ${numeroArticulo}: ${inputCantidad.value}`);
                hayErrores = true;
                return;
            }

            // Verificar integridad de receta
            if (!esIntegra) {
                articulosConAdvertencias.push(nombreArticulo);
            }

            articulosParaAgregar.push({
                numero: numeroArticulo,
                nombre: nombreArticulo,
                cantidad: cantidad,
                esIntegra: esIntegra
            });
        });

        if (hayErrores) {
            throw new Error('Hay errores en las cantidades. Verifique que todas sean números positivos.');
        }

        // Mostrar advertencia si hay artículos con problemas de integridad
        if (articulosConAdvertencias.length > 0) {
            const mensaje = `ADVERTENCIA: Los siguientes artículos tienen recetas con ingredientes que ya no existen:\n\n` +
                `${articulosConAdvertencias.join('\n')}\n\n` +
                `Esto puede causar errores en el cálculo de ingredientes necesarios.\n\n` +
                `¿Desea continuar agregando estos artículos al carro?`;

            if (!confirm(mensaje)) {
                return;
            }
        }

        // Obtener datos del colaborador
        const colaboradorData = localStorage.getItem('colaboradorActivo');
        if (!colaboradorData) {
            throw new Error('No hay colaborador seleccionado');
        }
        const colaborador = JSON.parse(colaboradorData);

        // Deshabilitar botón durante el proceso
        const btnAgregarMultiples = document.getElementById('btn-agregar-multiples');
        if (btnAgregarMultiples) {
            btnAgregarMultiples.disabled = true;
            btnAgregarMultiples.textContent = 'Agregando...';
        }

        // Procesar cada artículo
        let articulosAgregados = 0;
        let articulosConError = [];

        for (const articulo of articulosParaAgregar) {
            try {
                console.log(`🔍 [FASE 2] Agregando: ${articulo.nombre} (${articulo.cantidad})`);

                const response = await fetch(`http://localhost:3002/api/produccion/carro/${carroId}/articulo`, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify({
                        articulo_numero: articulo.numero,
                        descripcion: articulo.nombre,
                        cantidad: articulo.cantidad,
                        usuarioId: colaborador.id
                    })
                });

                if (!response.ok) {
                    const errorData = await response.json();

                    // Si el artículo ya existe, no es un error crítico
                    if (errorData.error === 'Este artículo ya fue agregado al carro') {
                        console.warn(`🔍 [FASE 2] Artículo ya existe: ${articulo.nombre}`);
                        articulosConError.push(`${articulo.nombre} (ya existe en el carro)`);
                    } else {
                        throw new Error(errorData.error || 'Error desconocido');
                    }
                } else {
                    articulosAgregados++;
                    console.log(`🔍 [FASE 2] ✅ Agregado: ${articulo.nombre}`);
                }

            } catch (error) {
                console.error(`🔍 [FASE 2] Error al agregar ${articulo.nombre}:`, error);
                articulosConError.push(`${articulo.nombre} (${error.message})`);
            }
        }

        // Restaurar botón
        if (btnAgregarMultiples) {
            btnAgregarMultiples.disabled = false;
            btnAgregarMultiples.textContent = '➕ Agregar seleccionados al carro';
        }

        // Mostrar resultado
        let mensaje = '';
        if (articulosAgregados > 0) {
            mensaje += `✅ ${articulosAgregados} artículo${articulosAgregados > 1 ? 's' : ''} agregado${articulosAgregados > 1 ? 's' : ''} correctamente`;
        }

        if (articulosConError.length > 0) {
            if (mensaje) mensaje += '\n\n';
            mensaje += `⚠️ Problemas con ${articulosConError.length} artículo${articulosConError.length > 1 ? 's' : ''}:\n${articulosConError.join('\n')}`;
        }

        // Mostrar notificación
        const notificationDiv = document.createElement('div');
        notificationDiv.className = 'success-message';
        notificationDiv.style.cssText = `
            position: fixed;
            top: 20px;
            right: 20px;
            background-color: ${articulosAgregados > 0 ? '#28a745' : '#ffc107'};
            color: ${articulosAgregados > 0 ? 'white' : '#212529'};
            padding: 15px 20px;
            border-radius: 4px;
            z-index: 10000;
            max-width: 400px;
            white-space: pre-line;
            font-weight: bold;
            box-shadow: 0 4px 6px rgba(0, 0, 0, 0.1);
        `;
        notificationDiv.textContent = mensaje;
        document.body.appendChild(notificationDiv);

        setTimeout(() => {
            notificationDiv.remove();
        }, 6000);

        // Si se agregó al menos un artículo, cerrar modal y actualizar
        if (articulosAgregados > 0) {
            cerrarModalArticulos();

            // Actualizar resumen automáticamente
            try {
                console.log('🔍 [FASE 2] Actualizando resumen después de agregado múltiple...');

                await mostrarArticulosDelCarro();

                const ingredientes = await obtenerResumenIngredientesCarro(carroId, colaborador.id);
                mostrarResumenIngredientes(ingredientes);

                const mixes = await obtenerResumenMixesCarro(carroId, colaborador.id);
                mostrarResumenMixes(mixes);

                const articulos = await obtenerResumenArticulosCarro(carroId, colaborador.id);
                if (articulos && articulos.length > 0) {
                    mostrarResumenArticulos(articulos);
                    const seccionArticulos = document.getElementById('resumen-articulos');
                    if (seccionArticulos) {
                        seccionArticulos.style.display = 'block';
                    }
                }

                console.log('🔍 [FASE 2] ✅ Resumen actualizado correctamente');
            } catch (updateError) {
                console.error('🔍 [FASE 2] ⚠️ Error al actualizar resumen:', updateError);
            }
        }

    } catch (error) {
        console.error('🔍 [FASE 2] Error en agregado múltiple:', error);
        mostrarError(error.message);

        // Restaurar botón en caso de error
        const btnAgregarMultiples = document.getElementById('btn-agregar-multiples');
        if (btnAgregarMultiples) {
            btnAgregarMultiples.disabled = false;
            btnAgregarMultiples.textContent = '➕ Agregar seleccionados al carro';
        }
    }
}

/**
 * 🔍 [OPTIMIZACIÓN] Agregar event listeners para auto-selección al modificar cantidad
 * Solo para producción interna - cuando el usuario modifica la cantidad, se marca automáticamente el checkbox
 */
function agregarEventListenersAutoSeleccion() {
    // Obtener todos los inputs de cantidad múltiple
    const inputsCantidad = document.querySelectorAll('.cantidad-multiple.modal-articulos-interna-multiple');

    inputsCantidad.forEach(input => {
        // Remover listeners previos para evitar duplicados
        input.removeEventListener('input', manejarCambioEnCantidad);
        input.removeEventListener('change', manejarCambioEnCantidad);

        // Agregar nuevos listeners
        input.addEventListener('input', manejarCambioEnCantidad);
        input.addEventListener('change', manejarCambioEnCantidad);
    });

    console.log(`🔍 [OPTIMIZACIÓN] Event listeners agregados a ${inputsCantidad.length} inputs de cantidad`);
}

/**
 * 🔍 [OPTIMIZACIÓN] Maneja el cambio en el campo de cantidad
 * Activa automáticamente el checkbox correspondiente cuando se modifica la cantidad
 */
function manejarCambioEnCantidad(event) {
    const input = event.target;
    const numeroArticulo = input.dataset.numero;

    if (!numeroArticulo) {
        console.warn('🔍 [OPTIMIZACIÓN] Input sin data-numero:', input);
        return;
    }

    // Buscar el checkbox correspondiente
    const checkbox = document.querySelector(`.seleccionar-articulo[data-numero="${numeroArticulo}"]`);

    if (!checkbox) {
        console.warn(`🔍 [OPTIMIZACIÓN] No se encontró checkbox para artículo ${numeroArticulo}`);
        return;
    }

    // Verificar si el valor es válido (mayor a 0)
    const cantidad = parseFloat(input.value);

    if (!isNaN(cantidad) && cantidad > 0) {
        // Solo marcar si no está ya marcado (evitar loops)
        if (!checkbox.checked) {
            checkbox.checked = true;
            console.log(`🔍 [OPTIMIZACIÓN] Auto-seleccionado artículo ${numeroArticulo} (cantidad: ${cantidad})`);

            // Agregar clase visual para indicar selección automática
            const fila = checkbox.closest('tr');
            if (fila) {
                fila.classList.add('selected-row');
            }
        }

        // Mejora solicitada por Martín - actualizar resumen en tiempo real
        actualizarSeleccionEnTiempoReal(numeroArticulo, checkbox.dataset.nombre, checkbox.dataset.integra === 'true', cantidad);

    } else if (cantidad === 0 || input.value === '') {
        // Si la cantidad es 0 o está vacía, desmarcar el checkbox
        if (checkbox.checked) {
            checkbox.checked = false;
            console.log(`🔍 [OPTIMIZACIÓN] Auto-desmarcado artículo ${numeroArticulo} (cantidad vacía/cero)`);

            // Remover clase visual
            const fila = checkbox.closest('tr');
            if (fila) {
                fila.classList.remove('selected-row');
            }
        }

        // Mejora solicitada por Martín - remover del resumen en tiempo real
        removerSeleccionEnTiempoReal(numeroArticulo);
    }
}

// Mejora solicitada por Martín - FUNCIONES PARA SELECCIÓN PERSISTENTE

/**
 * Preserva las selecciones actuales antes de aplicar filtros
 * Guarda el estado de checkboxes y cantidades en el Map persistente
 */
function preservarSeleccionesActuales() {
    try {
        // Solo para producción interna
        const carroId = localStorage.getItem('carroActivo');
        if (!carroId) return;

        // Obtener todos los checkboxes seleccionados
        const checkboxesSeleccionados = document.querySelectorAll('.seleccionar-articulo:checked');

        checkboxesSeleccionados.forEach(checkbox => {
            const numeroArticulo = checkbox.dataset.numero;
            const nombreArticulo = checkbox.dataset.nombre;
            const esIntegra = checkbox.dataset.integra === 'true';

            // Buscar la cantidad correspondiente
            const inputCantidad = document.querySelector(`.cantidad-multiple[data-numero="${numeroArticulo}"]`);
            const cantidad = inputCantidad ? parseFloat(inputCantidad.value) || 1 : 1;

            // Guardar en el Map persistente
            state.selectedArticles.set(numeroArticulo, {
                nombre: nombreArticulo,
                cantidad: cantidad,
                esIntegra: esIntegra
            });

            console.log(`🔍 [SELECCIÓN PERSISTENTE] Preservado: ${nombreArticulo} (${cantidad})`);
        });

        // Actualizar resumen visual
        actualizarResumenSeleccionados();

        console.log(`🔍 [SELECCIÓN PERSISTENTE] Total preservado: ${state.selectedArticles.size} artículos`);

    } catch (error) {
        console.error('🔍 [SELECCIÓN PERSISTENTE] Error al preservar selecciones:', error);
    }
}

/**
 * Restaura las selecciones después de regenerar la tabla
 * Marca checkboxes y restaura cantidades desde el Map persistente
 */
function restaurarSeleccionesPreservadas() {
    try {
        if (state.selectedArticles.size === 0) return;

        console.log(`🔍 [SELECCIÓN PERSISTENTE] Restaurando ${state.selectedArticles.size} selecciones...`);

        state.selectedArticles.forEach((datos, numeroArticulo) => {
            // Buscar checkbox correspondiente
            const checkbox = document.querySelector(`.seleccionar-articulo[data-numero="${numeroArticulo}"]`);
            if (checkbox) {
                checkbox.checked = true;

                // Agregar clase visual
                const fila = checkbox.closest('tr');
                if (fila) {
                    fila.classList.add('selected-row');
                }
            }

            // Buscar input de cantidad correspondiente
            const inputCantidad = document.querySelector(`.cantidad-multiple[data-numero="${numeroArticulo}"]`);
            if (inputCantidad) {
                inputCantidad.value = datos.cantidad;
            }

            console.log(`🔍 [SELECCIÓN PERSISTENTE] Restaurado: ${datos.nombre} (${datos.cantidad})`);
        });

    } catch (error) {
        console.error('🔍 [SELECCIÓN PERSISTENTE] Error al restaurar selecciones:', error);
    }
}

/**
 * Actualiza el resumen visual de artículos seleccionados en el encabezado del modal
 */
function actualizarResumenSeleccionados() {
    try {
        // Buscar o crear contenedor del resumen
        let contenedorResumen = document.getElementById('resumen-seleccionados');
        if (!contenedorResumen) {
            // Crear contenedor si no existe
            contenedorResumen = document.createElement('div');
            contenedorResumen.id = 'resumen-seleccionados';
            contenedorResumen.className = 'resumen-seleccionados-container';

            // Insertar después del título del modal
            const modalContent = document.querySelector('#modal-articulos .modal-content');
            const titulo = modalContent.querySelector('h2');
            if (titulo && modalContent) {
                titulo.insertAdjacentElement('afterend', contenedorResumen);
            }
        }

        // Limpiar contenido anterior
        contenedorResumen.innerHTML = '';

        if (state.selectedArticles.size === 0) {
            contenedorResumen.style.display = 'none';
            return;
        }

        // Mostrar resumen
        contenedorResumen.style.display = 'block';

        const titulo = document.createElement('h4');
        titulo.textContent = `📋 Artículos Seleccionados (${state.selectedArticles.size})`;
        titulo.style.cssText = `
            margin: 10px 0 5px 0;
            color: #007bff;
            font-size: 14px;
            font-weight: bold;
        `;
        contenedorResumen.appendChild(titulo);

        const lista = document.createElement('div');
        lista.className = 'lista-seleccionados';
        lista.style.cssText = `
            max-height: 120px;
            overflow-y: auto;
            background-color: #f8f9fa;
            border: 1px solid #dee2e6;
            border-radius: 4px;
            padding: 8px;
            margin-bottom: 10px;
        `;

        state.selectedArticles.forEach((datos, numeroArticulo) => {
            const item = document.createElement('div');
            item.className = 'item-seleccionado';
            item.style.cssText = `
                display: flex;
                justify-content: space-between;
                align-items: center;
                padding: 4px 8px;
                margin: 2px 0;
                background-color: white;
                border-radius: 3px;
                border-left: 3px solid ${datos.esIntegra ? '#28a745' : '#ffc107'};
                font-size: 12px;
            `;

            const info = document.createElement('span');
            info.textContent = `${datos.nombre}`;
            info.style.cssText = `
                flex: 1;
                margin-right: 8px;
                overflow: hidden;
                text-overflow: ellipsis;
                white-space: nowrap;
            `;

            const cantidad = document.createElement('span');
            cantidad.textContent = `Cant: ${datos.cantidad}`;
            cantidad.style.cssText = `
                font-weight: bold;
                color: #007bff;
                margin-right: 8px;
            `;

            const btnEliminar = document.createElement('button');
            btnEliminar.textContent = '✕';
            btnEliminar.style.cssText = `
                background: #dc3545;
                color: white;
                border: none;
                border-radius: 50%;
                width: 20px;
                height: 20px;
                font-size: 10px;
                cursor: pointer;
                display: flex;
                align-items: center;
                justify-content: center;
            `;
            btnEliminar.title = 'Quitar de selección';
            btnEliminar.onclick = () => eliminarSeleccion(numeroArticulo);

            item.appendChild(info);
            item.appendChild(cantidad);
            item.appendChild(btnEliminar);
            lista.appendChild(item);
        });

        contenedorResumen.appendChild(lista);

        console.log(`🔍 [SELECCIÓN PERSISTENTE] Resumen actualizado: ${state.selectedArticles.size} artículos`);

    } catch (error) {
        console.error('🔍 [SELECCIÓN PERSISTENTE] Error al actualizar resumen:', error);
    }
}

/**
 * Elimina un artículo específico de la selección persistente
 */
function eliminarSeleccion(numeroArticulo) {
    try {
        const datos = state.selectedArticles.get(numeroArticulo);
        if (datos) {
            state.selectedArticles.delete(numeroArticulo);
            console.log(`🔍 [SELECCIÓN PERSISTENTE] Eliminado: ${datos.nombre}`);

            // Desmarcar checkbox si está visible
            const checkbox = document.querySelector(`.seleccionar-articulo[data-numero="${numeroArticulo}"]`);
            if (checkbox) {
                checkbox.checked = false;
                const fila = checkbox.closest('tr');
                if (fila) {
                    fila.classList.remove('selected-row');
                }
            }

            // Actualizar resumen
            actualizarResumenSeleccionados();
        }
    } catch (error) {
        console.error('🔍 [SELECCIÓN PERSISTENTE] Error al eliminar selección:', error);
    }
}

// Mejora solicitada por Martín - FUNCIONES PARA ACTUALIZACIÓN EN TIEMPO REAL

/**
 * Actualiza la selección en tiempo real cuando se marca un checkbox o se modifica una cantidad
 * @param {string} numeroArticulo - Número del artículo
 * @param {string} nombreArticulo - Nombre del artículo
 * @param {boolean} esIntegra - Si la receta es íntegra
 * @param {number} cantidad - Cantidad seleccionada
 */
function actualizarSeleccionEnTiempoReal(numeroArticulo, nombreArticulo, esIntegra, cantidad) {
    try {
        // Agregar o actualizar en el Map persistente
        state.selectedArticles.set(numeroArticulo, {
            nombre: nombreArticulo,
            cantidad: cantidad,
            esIntegra: esIntegra
        });

        // Actualizar resumen visual inmediatamente
        actualizarResumenSeleccionados();

        console.log(`🔍 [TIEMPO REAL] Actualizado: ${nombreArticulo} (${cantidad})`);

    } catch (error) {
        console.error('🔍 [TIEMPO REAL] Error al actualizar selección:', error);
    }
}

/**
 * Remueve una selección en tiempo real cuando se desmarca o se vacía la cantidad
 * @param {string} numeroArticulo - Número del artículo a remover
 */
function removerSeleccionEnTiempoReal(numeroArticulo) {
    try {
        const datos = state.selectedArticles.get(numeroArticulo);
        if (datos) {
            state.selectedArticles.delete(numeroArticulo);

            // Actualizar resumen visual inmediatamente
            actualizarResumenSeleccionados();

            console.log(`🔍 [TIEMPO REAL] Removido: ${datos.nombre}`);
        }

    } catch (error) {
        console.error('🔍 [TIEMPO REAL] Error al remover selección:', error);
    }
}

// 🎨 REDISEÑO UX: FUNCIÓN PARA RENDERIZAR TARJETAS DE PRODUCCIÓN EXTERNA

/**
 * Renderiza tarjetas informativas para artículos de producción externa
 * @param {Array} articulos - Lista de artículos a renderizar
 * @param {HTMLElement} contenedor - Contenedor donde se renderizarán las tarjetas
 * @param {Object} estadoRecetas - Estado de recetas por artículo
 * @param {Object} integridadRecetas - Integridad de recetas por artículo
 */
async function renderizarTarjetasProduccionExterna(articulos, contenedor, estadoRecetas, integridadRecetas) {
    try {
        console.log('🎨 [TARJETAS] Renderizando tarjetas para producción externa...');

        if (!articulos || articulos.length === 0) {
            contenedor.innerHTML = '<p class="no-articulos-mensaje">No hay artículos de producción externa disponibles</p>';
            return;
        }

        // Obtener recetas de todos los artículos de una vez
        const colaboradorData = localStorage.getItem('colaboradorActivo');
        const colaborador = colaboradorData ? JSON.parse(colaboradorData) : null;

        // Obtener recetas completas para mostrar insumos base
        let recetasPorArticulo = {};
        for (const articulo of articulos) {
            try {
                const recetaResponse = await fetch(`http://localhost:3002/api/produccion/recetas/${encodeURIComponent(articulo.numero)}`);
                if (recetaResponse.ok) {
                    const receta = await recetaResponse.json();
                    recetasPorArticulo[articulo.numero] = receta;
                }
            } catch (error) {
                console.warn(`⚠️ No se pudo obtener receta para ${articulo.numero}`);
            }
        }

        for (const articulo of articulos) {
            const tieneReceta = estadoRecetas[articulo.numero];
            const esIntegra = integridadRecetas[articulo.numero];
            const receta = recetasPorArticulo[articulo.numero] || null;

            // Crear tarjeta
            const tarjeta = document.createElement('div');
            tarjeta.className = 'tarjeta-articulo-externo';
            tarjeta.dataset.numero = articulo.numero;

            // Cabecera de la tarjeta
            const cabecera = `
                <div class="tarjeta-cabecera">
                    <h3 class="tarjeta-titulo">${articulo.nombre}</h3>
                    <span class="tarjeta-codigo">${articulo.numero}</span>
                </div>
            `;

            // Información del ARTÍCULO BASE (insumo que compone la UP)
            // 🔧 CORRECCIÓN: Usar datos reales del backend en lugar de buscar en state
            let infoInsumoBase = '';

            if (articulo.articulo_base_codigo) {
                // Hay artículo base configurado - usar datos del backend
                const stockInsumo = articulo.articulo_base_stock || 0;
                const colorStock = stockInsumo > 0 ? '#28a745' : '#dc3545';
                const nombreBase = articulo.articulo_base_nombre || articulo.articulo_base_codigo;

                infoInsumoBase = `
                    <div class="tarjeta-info-item">
                        <span class="info-icono">📦</span>
                        <span class="info-label">Artículo Base:</span>
                        <span class="info-valor">${articulo.articulo_base_codigo} - ${nombreBase}</span>
                    </div>
                    <div class="tarjeta-info-item">
                        <span class="info-icono">📊</span>
                        <span class="info-label">Stock:</span>
                        <span class="info-valor" style="color: ${colorStock}; font-weight: bold;">
                            ${formatearStock(stockInsumo)} unidades
                        </span>
                    </div>
                `;
            } else {
                infoInsumoBase = `
                    <div class="tarjeta-info-item">
                        <span class="info-icono">⚠️</span>
                        <span class="info-label">Artículo Base:</span>
                        <span class="info-valor texto-advertencia">Sin configurar</span>
                    </div>
                `;
            }

            // Información de ingredientes adicionales (miel, aceite, etc.)
            let infoIngredientesHTML = '';
            if (receta && receta.ingredientes && receta.ingredientes.length > 0) {
                const nombresIngredientes = receta.ingredientes.map(ing => ing.nombre_ingrediente).join(', ');
                infoIngredientesHTML = `
                    <div class="tarjeta-info-item">
                        <span class="info-icono">🥄</span>
                        <span class="info-label">Ingredientes extra:</span>
                        <span class="info-valor">${nombresIngredientes}</span>
                    </div>
                `;
            } else {
                infoIngredientesHTML = `
                    <div class="tarjeta-info-item">
                        <span class="info-icono">🥄</span>
                        <span class="info-label">Ingredientes extra:</span>
                        <span class="info-valor" style="color: #6c757d;">Sin ingredientes extra</span>
                    </div>
                `;
            }

            // Texto de ayuda
            const textoAyuda = articulo.articulo_base_codigo
                ? `Esta UP consume <strong>${articulo.articulo_base_codigo} - ${articulo.articulo_base_nombre || articulo.articulo_base_codigo}</strong> como artículo base y lo transforma en <strong>${articulo.nombre}</strong>`
                : 'Configure la receta para definir el artículo base y los ingredientes necesarios';

            // Botones de acción
            let botonesHTML = '';
            if (tieneReceta) {
                botonesHTML = `
                    <button class="btn-seleccionar-tarjeta" 
                            data-numero="${articulo.numero}" 
                            data-nombre="${articulo.nombre.replace(/'/g, "\\'")}"
                            data-integra="${esIntegra}">
                        ✅ Seleccionar / Asignar
                    </button>
                    <button class="btn-editar-receta-tarjeta" 
                            data-numero="${articulo.numero}" 
                            data-nombre="${articulo.nombre.replace(/'/g, "\\'")}"
                            onclick="mostrarModalReceta('${articulo.numero}', '${articulo.nombre.replace(/'/g, "\\'")}', 'editar')">
                        ⚙️ Editar Configuración UP
                    </button>
                `;
            } else {
                botonesHTML = `
                    <button class="btn-configurar-receta" 
                            data-numero="${articulo.numero}" 
                            data-nombre="${articulo.nombre.replace(/'/g, "\\'")}"
                            onclick="mostrarModalReceta('${articulo.numero}', '${articulo.nombre.replace(/'/g, "\\'")}', 'crear')">
                        ⚙️ Configurar Receta
                    </button>
                `;
            }

            // Ensamblar tarjeta completa
            tarjeta.innerHTML = `
                ${cabecera}
                <div class="tarjeta-cuerpo">
                    ${infoInsumoBase}
                    ${infoIngredientesHTML}
                    <div class="tarjeta-ayuda">
                        <span class="ayuda-icono">💡</span>
                        <p class="ayuda-texto">${textoAyuda}</p>
                    </div>
                </div>
                <div class="tarjeta-pie">
                    ${botonesHTML}
                </div>
            `;

            contenedor.appendChild(tarjeta);
        }

        // Agregar event listeners para botones de selección
        contenedor.querySelectorAll('.btn-seleccionar-tarjeta').forEach(btn => {
            btn.addEventListener('click', async () => {
                const numero = btn.dataset.numero;
                const nombre = btn.dataset.nombre;
                const esIntegra = btn.dataset.integra === 'true';

                await agregarArticuloExternoAlCarro(numero, nombre, esIntegra, btn);
            });
        });

        console.log(`🎨 [TARJETAS] ${articulos.length} tarjetas renderizadas`);

    } catch (error) {
        console.error('🎨 [TARJETAS] Error al renderizar tarjetas:', error);
        contenedor.innerHTML = '<p class="error-mensaje">Error al cargar artículos</p>';
    }
}

/**
 * Agrega un artículo de producción externa al carro
 * @param {string} numero - Número del artículo
 * @param {string} nombre - Nombre del artículo
 * @param {boolean} esIntegra - Si la receta es íntegra
 * @param {HTMLElement} btnElement - Botón que disparó la acción
 */
async function agregarArticuloExternoAlCarro(numero, nombre, esIntegra, btnElement) {
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

        // Para producción externa, cantidad por defecto es 1
        const cantidad = 1;

        btnElement.disabled = true;
        btnElement.textContent = '⏳ Agregando...';

        const response = await fetch(`http://localhost:3002/api/produccion/carro/${carroId}/articulo`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                articulo_numero: numero,
                descripcion: nombre,
                cantidad: cantidad,
                usuarioId: colaborador.id
            })
        });

        if (!response.ok) {
            const errorData = await response.json();
            throw new Error(errorData.error || 'Error al agregar el artículo al carro');
        }

        btnElement.disabled = false;
        btnElement.textContent = '✅ Seleccionar / Asignar';

        const successDiv = document.createElement('div');
        successDiv.className = 'success-message';
        successDiv.textContent = 'Artículo agregado correctamente';
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

        cerrarModalArticulos();

        // 🔄 ACTUALIZAR RESUMEN AUTOMÁTICAMENTE (PRODUCCIÓN EXTERNA)
        try {
            console.log('🔄 [EXTERNO] Iniciando actualización completa del resumen...');

            // 🎯 DELAY ESTRATÉGICO: Esperar a que el backend procese completamente
            await new Promise(resolve => setTimeout(resolve, 300));

            // 1. Actualizar lista de artículos del carro
            await mostrarArticulosDelCarro();
            console.log('✅ [EXTERNO] Lista de artículos actualizada');

            // 2. FORZAR recarga de ingredientes
            const ingredientes = await obtenerResumenIngredientesCarro(carroId, colaborador.id);
            await mostrarResumenIngredientes(ingredientes);
            console.log('✅ [EXTERNO] Resumen de ingredientes actualizado');

            // 3. FORZAR recarga de mixes
            const mixes = await obtenerResumenMixesCarro(carroId, colaborador.id);
            mostrarResumenMixes(mixes);
            console.log('✅ [EXTERNO] Resumen de mixes actualizado');

            // 4. 🎯 FORZAR ACTUALIZACIÓN DE ARTÍCULOS EXTERNOS (CRÍTICO)
            const articulos = await obtenerResumenArticulosCarro(carroId, colaborador.id);
            const seccionArticulos = document.getElementById('resumen-articulos');

            console.log(`🔍 [EXTERNO-ARTÍCULOS] Artículos obtenidos: ${articulos?.length || 0}`);

            if (articulos && articulos.length > 0) {
                // FORZAR visualización de la sección
                if (seccionArticulos) {
                    seccionArticulos.style.display = 'block';
                    // Forzar reflow para asegurar que el cambio se aplique
                    seccionArticulos.offsetHeight;
                    console.log('✅ [EXTERNO-ARTÍCULOS] Sección mostrada y forzado reflow');
                }

                // FORZAR actualización de la tabla
                mostrarResumenArticulos(articulos);
                console.log('✅ [EXTERNO-ARTÍCULOS] Tabla actualizada con datos');
            } else {
                if (seccionArticulos) {
                    seccionArticulos.style.display = 'none';
                    console.log('ℹ️ [EXTERNO-ARTÍCULOS] No hay artículos, sección oculta');
                }
            }

            console.log('✅ [EXTERNO] Resumen completo actualizado correctamente');
        } catch (updateError) {
            console.error('⚠️ [EXTERNO] Error al actualizar resumen:', updateError);
        }

    } catch (error) {
        console.error('Error:', error);
        mostrarError(error.message);
        btnElement.disabled = false;
        btnElement.textContent = '✅ Seleccionar / Asignar';
    }
}

// 🔄 AUTO-REFRESH: Listener para actualizar tarjetas cuando se guarda una receta
document.addEventListener('recetaActualizada', async (event) => {
    try {
        console.log('🔔 [AUTO-REFRESH] Evento recetaActualizada recibido:', event.detail);

        // Verificar si el modal de artículos está abierto
        const modalArticulos = document.getElementById('modal-articulos');
        if (!modalArticulos || modalArticulos.style.display === 'none') {
            console.log('🔔 [AUTO-REFRESH] Modal de artículos no está abierto, omitiendo actualización');
            return;
        }

        // Verificar si es un carro externo
        const carroId = localStorage.getItem('carroActivo');
        if (!carroId) {
            console.log('🔔 [AUTO-REFRESH] No hay carro activo, omitiendo actualización');
            return;
        }

        let tipoCarro = 'interna';
        try {
            const carroResponse = await fetch(`http://localhost:3002/api/produccion/carro/${carroId}/estado`);
            if (carroResponse.ok) {
                const carroData = await carroResponse.json();
                tipoCarro = carroData.tipo_carro || 'interna';
            }
        } catch (error) {
            console.warn('🔔 [AUTO-REFRESH] Error al obtener tipo de carro:', error);
        }

        if (tipoCarro !== 'externa') {
            console.log('🔔 [AUTO-REFRESH] No es carro externo, omitiendo actualización de tarjetas');
            return;
        }

        console.log('🔄 [AUTO-REFRESH] Esperando 500ms para que el backend procese los cambios...');

        // 🎯 RETRASO ESTRATÉGICO: Esperar a que el backend termine de procesar
        await new Promise(resolve => setTimeout(resolve, 500));

        console.log('🔄 [AUTO-REFRESH] Recargando artículos con cache-busting...');

        // Limpiar caché para forzar recarga desde backend
        const cacheKey = `articulos_${tipoCarro}`;
        delete state[cacheKey];

        // 🎯 CACHE-BUSTING: Agregar timestamp para forzar datos frescos
        const timestamp = Date.now();
        const url = `http://localhost:3002/api/produccion/articulos?tipo_carro=externa&_t=${timestamp}`;
        const response = await fetch(url);

        if (!response.ok) {
            throw new Error('Error al recargar artículos');
        }

        const responseData = await response.json();
        const articulos = responseData.data || responseData;

        console.log(`🔄 [AUTO-REFRESH] Artículos recibidos del backend: ${articulos.length}`);

        // Actualizar state
        state[cacheKey] = articulos;
        state.todosLosArticulos = articulos;
        state.articulosFiltrados = [...articulos];

        // Aplicar filtros actuales para regenerar las tarjetas
        aplicarFiltros(0);

        console.log('✅ [AUTO-REFRESH] Tarjetas actualizadas con datos frescos del backend');

        // Efecto visual de actualización
        const contenedorTarjetas = document.getElementById('contenedor-tarjetas-articulos');
        if (contenedorTarjetas) {
            contenedorTarjetas.style.opacity = '0.5';
            setTimeout(() => {
                contenedorTarjetas.style.opacity = '1';
                contenedorTarjetas.style.transition = 'opacity 0.3s ease';
            }, 100);
        }

    } catch (error) {
        console.error('🔔 [AUTO-REFRESH] Error al actualizar tarjetas:', error);
    }
});

// Hacer la función disponible globalmente para el HTML
window.agregarMultiplesAlCarroInterno = agregarMultiplesAlCarroInterno;
window.mostrarModalReceta = mostrarModalReceta;
