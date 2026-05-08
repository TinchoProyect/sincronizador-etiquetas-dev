// Variables globales para el inventario y ajustes

// Variables globales para filtrado
let todosLosArticulos = []; // Array para almacenar todos los artículos cargados
let articulosFiltrados = []; // Array para almacenar los artículos filtrados

/**
 * Formatea un número para mostrar de forma legible
 * - Redondea a 2 decimales máximo
 * - Elimina decimales innecesarios (.00)
 * - Maneja valores muy pequeños como 0
 * @param {number} valor - El valor numérico a formatear
 * @returns {string} - El valor formateado como string
 */
function formatearNumero(valor) {
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

// Función para mostrar mensajes
function mostrarMensaje(mensaje, tipo = 'error') {
    const mensajeDiv = document.createElement('div');
    mensajeDiv.className = tipo === 'error' ? 'mensaje-error' : 'mensaje-info';
    mensajeDiv.textContent = mensaje;
    
    // Remover mensaje anterior si existe
    const mensajeAnterior = document.querySelector('.mensaje-error, .mensaje-info');
    if (mensajeAnterior) {
        mensajeAnterior.remove();
    }
    
    const contentSection = document.querySelector('.content-section');
    if (contentSection) {
        contentSection.insertBefore(mensajeDiv, contentSection.firstChild);
    }
    
    // Remover el mensaje después de 3 segundos
    setTimeout(() => {
        if (mensajeDiv.parentNode) {
            mensajeDiv.parentNode.removeChild(mensajeDiv);
        }
    }, 3000);
}

// Función para actualizar la tabla con los artículos
function actualizarTablaArticulos(articulos) {
    const tbody = document.getElementById('tabla-articulos-body');
    if (!tbody) {
        console.error('❌ No se encontró el elemento tabla-articulos-body');
        return;
    }

    tbody.innerHTML = '';

    if (!articulos || articulos.length === 0) {
        tbody.innerHTML = `<tr><td colspan="7" class="mensaje-info">No hay artículos registrados</td></tr>`;
        return;
    }

    // Verificar duplicados
    const articulosUnicos = new Set();
    const duplicados = [];
    
    articulos.forEach((articulo, index) => {
        if (articulosUnicos.has(articulo.numero)) {
            duplicados.push(articulo.numero);
        } else {
            articulosUnicos.add(articulo.numero);
        }
    });
    
    if (duplicados.length > 0) {
        console.warn(`⚠️ Detectados ${duplicados.length} artículos duplicados en renderizado`);
    }

    // Renderizar artículos
    articulos.forEach((articulo) => {
        const stockConsolidado = articulo.stock_consolidado || 0;
        
        const tr = document.createElement('tr');
        
        tr.innerHTML = `
            <td>${articulo.numero}</td>
            <td>${articulo.nombre}</td>
            <td>${articulo.codigo_barras || '-'}</td>
            <td>${formatearNumero(stockConsolidado)}</td>
            <td class="kilos-unidad-cell">
                <input type="number" 
                       step="0.001" 
                       min="0" 
                       value="${articulo.kilos_unidad || ''}" 
                       data-articulo="${articulo.numero}"
                       class="input-kilos-unidad"
                       placeholder="0.000"
                       disabled
                       style="width: 80px; padding: 4px; border: 1px solid #ddd; border-radius: 3px; text-align: center; background-color: #f5f5f5;">
            </td>
            <td class="produccion-cell">
                <label class="switch">
                    <input type="checkbox" ${!articulo.no_producido_por_lambda ? 'checked' : ''} 
                           onchange="toggleProduccion('${articulo.numero}', this.checked)">
                    <span class="slider round"></span>
                </label>
            </td>
            <td class="produccion-cell">
                <label class="switch">
                    <input type="checkbox" ${articulo.solo_produccion_externa ? 'checked' : ''} 
                           onchange="toggleProduccionExterna('${articulo.numero}', this.checked)">
                    <span class="slider round"></span>
                </label>
            </td>
        `;
        tbody.appendChild(tr);
    });
    
    console.log(`🔧 Renderizados ${articulos.length} artículos correctamente`);

    // Configurar eventos para edición inline de kilos_unidad
    configurarEventosKilosUnidad(tbody);
    
    // SOLUCIÓN: Agregar listener de dblclick a las celdas TD que contienen inputs de kilos_unidad
    console.log('🔍 [VERIFICACIÓN] Verificando selector .kilos-unidad-cell...');
    const celdasKilosUnidad = tbody.querySelectorAll('.kilos-unidad-cell');
    console.log(`🔍 [VERIFICACIÓN] Celdas encontradas con clase .kilos-unidad-cell: ${celdasKilosUnidad.length}`);
    
    if (celdasKilosUnidad.length === 0) {
        console.warn('⚠️ [VERIFICACIÓN] No se encontraron celdas con clase .kilos-unidad-cell');
        console.warn('⚠️ [VERIFICACIÓN] Intentando asignar clase dinámicamente...');
        
        // Fallback: Asignar clase dinámicamente a celdas que contengan inputs .input-kilos-unidad
        const inputsKilosUnidad = tbody.querySelectorAll('.input-kilos-unidad');
        console.log(`🔍 [VERIFICACIÓN] Inputs encontrados: ${inputsKilosUnidad.length}`);
        
        inputsKilosUnidad.forEach((input, index) => {
            const celda = input.closest('td');
            if (celda) {
                celda.classList.add('kilos-unidad-cell');
                console.log(`✅ [VERIFICACIÓN] Clase agregada dinámicamente a celda ${index + 1}`);
            } else {
                console.warn(`⚠️ [VERIFICACIÓN] Input ${index + 1} no está dentro de un TD`);
            }
        });
        
        // Volver a buscar después de agregar las clases
        const celdasActualizadas = tbody.querySelectorAll('.kilos-unidad-cell');
        console.log(`🔍 [VERIFICACIÓN] Celdas después de asignación dinámica: ${celdasActualizadas.length}`);
    }
    
    // Agregar listeners a todas las celdas con clase .kilos-unidad-cell
    const celdasFinales = tbody.querySelectorAll('.kilos-unidad-cell');
    celdasFinales.forEach((td, index) => {
        console.log(`🔧 [SOLUCIÓN] Agregando listener a celda ${index + 1}:`, td);
        
        td.addEventListener('dblclick', function(e) {
            console.log('🎯 [SOLUCIÓN] Doble clic detectado en celda TD:', this);
            const input = this.querySelector('.input-kilos-unidad');
            if (input) {
                console.log('✅ [SOLUCIÓN] Input encontrado, activando edición:', input);
                activarEdicionKilosUnidad(input);
            } else {
                console.warn('⚠️ [SOLUCIÓN] No se encontró input en la celda');
            }
        });
        
        // Agregar estilo visual para indicar que la celda es clickeable
        td.style.cursor = 'pointer';
        td.title = 'Doble clic para editar';
    });
    
    console.log(`✅ [SOLUCIÓN] Listeners de doble clic agregados a ${celdasFinales.length} celdas`);
}

// Funciones de filtrado

/**
 * Normaliza texto eliminando acentos y convirtiendo a minúsculas
 * @param {string} texto - Texto a normalizar
 * @returns {string} - Texto normalizado
 */
function normalizarTexto(texto) {
    if (!texto) return '';
    return texto
        .toLowerCase()
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, ''); // Eliminar acentos
}

/**
 * Filtra artículos por nombre usando lógica multi-criterio (AND)
 * Divide el texto de búsqueda en tokens (grupos de caracteres) separados por espacios
 * y verifica que TODOS los tokens estén presentes en la descripción del artículo
 * 
 * @param {Array} articulos - Array de artículos a filtrar
 * @param {string} texto - Texto de búsqueda ingresado por el usuario
 * @returns {Array} - Array de artículos filtrados
 * 
 * Ejemplo:
 * - Búsqueda: "mi la 5"
 * - Tokens: ["mi", "la", "5"]
 * - Resultado: Solo artículos cuya descripción contenga "mi" Y "la" Y "5"
 *   (ej: "Mix Extralight 5 KG" ✅)
 */
function filtrarPorNombre(articulos, texto) {
    console.log('🔍 [FILTRO-NOMBRE] Iniciando filtrado multi-criterio');
    console.log('🔍 [FILTRO-NOMBRE] Texto de búsqueda original:', `"${texto}"`);
    
    if (!texto || texto.trim() === '') {
        console.log('🔍 [FILTRO-NOMBRE] Texto vacío, retornando todos los artículos');
        return articulos;
    }
    
    // 1. Normalizar el texto de búsqueda (eliminar acentos, convertir a minúsculas)
    const textoNormalizado = normalizarTexto(texto);
    console.log('🔍 [FILTRO-NOMBRE] Texto normalizado:', `"${textoNormalizado}"`);
    
    // 2. Dividir el texto en tokens (grupos de caracteres) usando espacios como separador
    const tokens = textoNormalizado
        .split(/\s+/)           // Dividir por uno o más espacios
        .filter(token => token.length > 0); // Eliminar tokens vacíos
    
    console.log('🔍 [FILTRO-NOMBRE] Tokens generados:', tokens);
    console.log('🔍 [FILTRO-NOMBRE] Total de tokens:', tokens.length);
    
    if (tokens.length === 0) {
        console.log('🔍 [FILTRO-NOMBRE] No hay tokens válidos, retornando todos los artículos');
        return articulos;
    }
    
    // 3. Filtrar artículos: un artículo pasa el filtro SOLO SI contiene TODOS los tokens
    const articulosFiltrados = articulos.filter(articulo => {
        // Normalizar el nombre del artículo para comparación
        const nombreNormalizado = normalizarTexto(articulo.nombre);
        
        // Verificar que TODOS los tokens estén presentes en el nombre (lógica AND)
        const cumpleTodosLosTokens = tokens.every(token => 
            nombreNormalizado.includes(token)
        );
        
        // Log detallado para debugging (solo para los primeros 5 artículos)
        if (articulos.indexOf(articulo) < 5) {
            console.log(`🔍 [FILTRO-NOMBRE] Artículo: "${articulo.nombre}"`);
            console.log(`   - Normalizado: "${nombreNormalizado}"`);
            console.log(`   - Cumple todos los tokens: ${cumpleTodosLosTokens}`);
            tokens.forEach(token => {
                const contiene = nombreNormalizado.includes(token);
                console.log(`   - Contiene "${token}": ${contiene ? '✅' : '❌'}`);
            });
        }
        
        return cumpleTodosLosTokens;
    });
    
    console.log('✅ [FILTRO-NOMBRE] Filtrado completado');
    console.log('✅ [FILTRO-NOMBRE] Artículos antes del filtro:', articulos.length);
    console.log('✅ [FILTRO-NOMBRE] Artículos después del filtro:', articulosFiltrados.length);
    
    return articulosFiltrados;
}

function filtrarPorStock(articulos, condicion) {
    console.log('🔍 [DEBUG] filtrarPorStock - Iniciando filtrado');
    console.log('🔍 [DEBUG] Condición de filtro:', condicion);
    console.log('🔍 [DEBUG] Cantidad de artículos a filtrar:', articulos.length);
    
    // Umbral para considerar un valor como "prácticamente cero"
    const UMBRAL_CERO = 0.01;

    let resultado;
    switch (condicion) {
        case 'igual-cero':
            resultado = articulos.filter(articulo => {
                const stock = articulo.stock_consolidado || 0;
                const esIgualCero = Math.abs(stock) <= UMBRAL_CERO;
                if (esIgualCero) {
                    console.log(`📊 [DEBUG] Artículo con stock = 0: ${articulo.nombre} (${stock})`);
                }
                return esIgualCero;
            });
            break;
        case 'mayor-cero':
            resultado = articulos.filter(articulo => {
                const stock = articulo.stock_consolidado || 0;
                const esMayorCero = stock > UMBRAL_CERO;
                if (esMayorCero) {
                    console.log(`📊 [DEBUG] Artículo con stock > 0: ${articulo.nombre} (${stock})`);
                }
                return esMayorCero;
            });
            break;
        case 'menor-cero':
            resultado = articulos.filter(articulo => {
                const stock = articulo.stock_consolidado || 0;
                const esMenorCero = stock < -UMBRAL_CERO;
                if (esMenorCero) {
                    console.log(`📊 [DEBUG] Artículo con stock < 0: ${articulo.nombre} (${stock})`);
                }
                return esMenorCero;
            });
            break;
        default:
            resultado = articulos;
    }
    
    console.log('✅ [DEBUG] filtrarPorStock - Filtrado completado');
    console.log('✅ [DEBUG] Artículos después del filtro:', resultado.length);
    return resultado;
}

function filtrarPorProduccion(articulos, condicion) {
    console.log('🏭 [DEBUG] filtrarPorProduccion - Iniciando filtrado');
    console.log('🏭 [DEBUG] Condición de filtro:', condicion);
    console.log('🏭 [DEBUG] Cantidad de artículos a filtrar:', articulos.length);
    
    let resultado;
    switch (condicion) {
        case 'producidos':
            resultado = articulos.filter(articulo => {
                const esProducidoPorLamda = !articulo.no_producido_por_lambda;
                if (esProducidoPorLamda) {
                    console.log(`🏭 [DEBUG] Artículo producido por LAMDA: ${articulo.nombre}`);
                }
                return esProducidoPorLamda;
            });
            break;
        case 'no_producidos':
            resultado = articulos.filter(articulo => {
                const noEsProducidoPorLamda = articulo.no_producido_por_lambda === true;
                if (noEsProducidoPorLamda) {
                    console.log(`🏭 [DEBUG] Artículo NO producido por LAMDA: ${articulo.nombre}`);
                }
                return noEsProducidoPorLamda;
            });
            break;
        default:
            resultado = articulos;
    }
    
    console.log('✅ [DEBUG] filtrarPorProduccion - Filtrado completado');
    console.log('✅ [DEBUG] Artículos después del filtro:', resultado.length);
    return resultado;
}

function filtrarPorProduccionExterna(articulos, condicion) {
    console.log('🚚 [DEBUG] filtrarPorProduccionExterna - Iniciando filtrado');
    console.log('🚚 [DEBUG] Condición de filtro:', condicion);
    console.log('🚚 [DEBUG] Cantidad de artículos a filtrar:', articulos.length);
    
    let resultado;
    switch (condicion) {
        case 'externa_si':
            resultado = articulos.filter(articulo => {
                const esSoloProduccionExterna = articulo.solo_produccion_externa === true;
                if (esSoloProduccionExterna) {
                    console.log(`🚚 [DEBUG] Artículo de solo producción externa: ${articulo.nombre}`);
                }
                return esSoloProduccionExterna;
            });
            break;
        case 'externa_no':
            resultado = articulos.filter(articulo => {
                const noEsSoloProduccionExterna = !articulo.solo_produccion_externa;
                if (noEsSoloProduccionExterna) {
                    console.log(`🚚 [DEBUG] Artículo NO de solo producción externa: ${articulo.nombre}`);
                }
                return noEsSoloProduccionExterna;
            });
            break;
        default:
            resultado = articulos;
    }
    
    console.log('✅ [DEBUG] filtrarPorProduccionExterna - Filtrado completado');
    console.log('✅ [DEBUG] Artículos después del filtro:', resultado.length);
    return resultado;
}

function aplicarFiltros() {
    console.log('🔍 [DEBUG] aplicarFiltros - Iniciando aplicación de filtros');
    
    const textoFiltro = document.getElementById('filtro-nombre').value;
    const stockFiltro = document.getElementById('filtro-stock').value;
    const filtroProduccion = document.querySelector('input[name="filtroProduccion"]:checked').value;
    const filtroProduccionExterna = document.querySelector('input[name="filtroProduccionExterna"]:checked').value;
    
    console.log('🔍 [DEBUG] Filtros actuales:');
    console.log('- Texto:', textoFiltro);
    console.log('- Stock:', stockFiltro);
    console.log('- Filtro producción:', filtroProduccion);
    console.log('- Filtro producción externa:', filtroProduccionExterna);
    console.log('- Total artículos antes de filtrar:', todosLosArticulos.length);
    
    let articulosFiltrados = [...todosLosArticulos];
    
    // Aplicar filtro de nombre
    if (textoFiltro) {
        console.log('📝 [DEBUG] Aplicando filtro por nombre:', textoFiltro);
        articulosFiltrados = filtrarPorNombre(articulosFiltrados, textoFiltro);
        console.log('📝 [DEBUG] Artículos después de filtrar por nombre:', articulosFiltrados.length);
    }
    
    // Aplicar filtro de stock
    if (stockFiltro !== 'todos') {
        console.log('📊 [DEBUG] Aplicando filtro por stock:', stockFiltro);
        articulosFiltrados = filtrarPorStock(articulosFiltrados, stockFiltro);
        console.log('📊 [DEBUG] Artículos después de filtrar por stock:', articulosFiltrados.length);
    }
    
    // Aplicar filtro de producción
    if (filtroProduccion !== 'todos') {
        console.log('🏭 [DEBUG] Aplicando filtro de producción:', filtroProduccion);
        articulosFiltrados = filtrarPorProduccion(articulosFiltrados, filtroProduccion);
        console.log('🏭 [DEBUG] Artículos después de filtrar por producción:', articulosFiltrados.length);
    }
    
    // Aplicar filtro de producción externa
    if (filtroProduccionExterna !== 'todos') {
        console.log('🚚 [DEBUG] Aplicando filtro de producción externa:', filtroProduccionExterna);
        articulosFiltrados = filtrarPorProduccionExterna(articulosFiltrados, filtroProduccionExterna);
        console.log('🚚 [DEBUG] Artículos después de filtrar por producción externa:', articulosFiltrados.length);
    }
    
    console.log('✅ [DEBUG] Filtrado completado');
    console.log('✅ [DEBUG] Total artículos después de filtrar:', articulosFiltrados.length);
    
    // Actualizar la tabla con los resultados filtrados
    actualizarTablaArticulos(articulosFiltrados);
}

// Función para cargar los artículos
async function cargarArticulos() {
    try {
        console.log('🔍 [FRONTEND] ===== INICIANDO cargarArticulos() =====');
        console.log('🔍 [FRONTEND] Timestamp:', new Date().toISOString());
        console.log('🔍 [FRONTEND] Stack trace de llamada:', new Error().stack.split('\n').slice(1, 4));
        
        console.log('🔍 [FRONTEND] Realizando fetch a /api/produccion/articulos');
        const response = await fetch('/api/produccion/articulos');
        
        console.log('🔍 [FRONTEND] Respuesta recibida - Status:', response.status);
        console.log('🔍 [FRONTEND] Respuesta recibida - OK:', response.ok);
        
        if (!response.ok) {
            const errorData = await response.json();
            throw new Error(errorData.error || 'Error al obtener los artículos');
        }

        const responseData = await response.json();
        console.log('🔍 [FRONTEND] ===== DATOS RECIBIDOS DEL BACKEND =====');
        console.log('🔍 [FRONTEND] Respuesta completa:', responseData);
        
        // ✅ CORRECCIÓN: Manejar nuevo formato de respuesta { success, data, total }
        const articulos = responseData.data || responseData;
        
        console.log('🔍 [FRONTEND] Total artículos recibidos:', articulos.length);
        console.log('🔍 [FRONTEND] Muestra del primer artículo:', articulos[0]);
        
        // DIAGNÓSTICO CRÍTICO: Verificar si hay duplicados en los datos recibidos
        const articulosUnicos = new Set();
        const duplicados = [];
        
        articulos.forEach((articulo, index) => {
            if (articulosUnicos.has(articulo.numero)) {
                duplicados.push({
                    index,
                    numero: articulo.numero,
                    nombre: articulo.nombre
                });
            } else {
                articulosUnicos.add(articulo.numero);
            }
        });
        
        console.log('🔍 [FRONTEND] ===== ANÁLISIS DE DUPLICADOS EN FRONTEND =====');
        console.log('🔍 [FRONTEND] Artículos únicos encontrados:', articulosUnicos.size);
        console.log('🔍 [FRONTEND] Total artículos recibidos:', articulos.length);
        console.log('🔍 [FRONTEND] Duplicados detectados:', duplicados.length);
        
        if (duplicados.length > 0) {
            console.log('🚨 [FRONTEND] ¡DUPLICADOS ENCONTRADOS EN DATOS RECIBIDOS!');
            duplicados.forEach(dup => {
                console.log(`🚨 [FRONTEND] Duplicado: ${dup.numero} - ${dup.nombre} (índice ${dup.index})`);
            });
        } else {
            console.log('✅ [FRONTEND] No se encontraron duplicados en los datos recibidos del backend');
        }
        
        // Almacenar todos los artículos globalmente
        todosLosArticulos = articulos;
        
        // Mostrar los artículos en la tabla
        console.log('🔍 [FRONTEND] Llamando a actualizarTablaArticulos()');
        actualizarTablaArticulos(articulos);
        
        console.log('🔍 [FRONTEND] ===== FIN cargarArticulos() =====');

    } catch (error) {
        console.error('❌ [FRONTEND] Error al cargar artículos:', error);
        mostrarMensaje(error.message || 'No se pudieron cargar los artículos');
    }
}

// Event Listeners
document.addEventListener('DOMContentLoaded', () => {
    console.log('Página de gestión de artículos cargada');
    cargarArticulos();

// Filtros
    const filtroNombre = document.getElementById('filtro-nombre');
    const filtroStock = document.getElementById('filtro-stock');
    const filtrosProduccion = document.querySelectorAll('input[name="filtroProduccion"]');
    const filtrosProduccionExterna = document.querySelectorAll('input[name="filtroProduccionExterna"]');
    
    filtroNombre.addEventListener('input', aplicarFiltros);
    filtroStock.addEventListener('change', aplicarFiltros);
    filtrosProduccion.forEach(radio => {
        radio.addEventListener('change', aplicarFiltros);
    });
    filtrosProduccionExterna.forEach(radio => {
        radio.addEventListener('change', aplicarFiltros);
    });
});

// Función para alternar el estado de producción de un artículo
async function toggleProduccion(articuloId, checked) {
    const switchElement = document.querySelector(`input[type="checkbox"][onchange="toggleProduccion('${articuloId}', this.checked)"]`);
    if (!switchElement) {
        console.error('No se encontró el switch para el artículo:', articuloId);
        return;
    }
    // Deshabilitar el switch para evitar múltiples clics
    switchElement.disabled = true;
    const previousChecked = !checked; // Estado anterior invertido

    try {
        const response = await fetch(`/api/produccion/articulos/${encodeURIComponent(articuloId)}/toggle-produccion`, {
            method: 'PUT',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                no_producido_por_lambda: !checked // Si está checked, es producido, por lo que no_producido_por_lambda es false
            })
        });

        if (!response.ok) {
            throw new Error('Error al actualizar el estado de producción');
        }

        // Actualizar el estado en todosLosArticulos para reflejar el cambio
        const articulo = todosLosArticulos.find(a => a.numero === articuloId);
        if (articulo) {
            articulo.no_producido_por_lambda = !checked;
        }

        // Actualizar la UI: aplicar filtros actuales para reflejar cambios sin perder filtrado
        aplicarFiltros();
        
        mostrarMensaje(`Estado de producción actualizado correctamente`, 'info');
        
    } catch (error) {
        console.error('Error:', error);
        mostrarMensaje('Error al actualizar el estado de producción');
        // Revertir el estado del switch al anterior
        switchElement.checked = previousChecked;
    } finally {
        // Habilitar el switch nuevamente
        switchElement.disabled = false;
    }
}

async function toggleProduccionExterna(articuloId, checked) {
    const switchElement = document.querySelector(`input[type="checkbox"][onchange="toggleProduccionExterna('${articuloId}', this.checked)"]`);
    if (!switchElement) {
        console.error('No se encontró el switch para el artículo (producción externa):', articuloId);
        return;
    }
    // Deshabilitar el switch para evitar múltiples clics
    switchElement.disabled = true;
    const previousChecked = !checked; // Estado anterior invertido

    try {
        const response = await fetch(`/api/produccion/articulos/${encodeURIComponent(articuloId)}/toggle-produccion-externa`, {
            method: 'PUT',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                solo_produccion_externa: checked
            })
        });

        if (!response.ok) {
            throw new Error('Error al actualizar el estado de producción externa');
        }

        // Actualizar el estado en todosLosArticulos para reflejar el cambio
        const articulo = todosLosArticulos.find(a => a.numero === articuloId);
        if (articulo) {
            articulo.solo_produccion_externa = checked;
        }

        // Actualizar la UI: aplicar filtros actuales para reflejar cambios sin perder filtrado
        aplicarFiltros();
        
        mostrarMensaje(`Estado de producción externa actualizado correctamente`, 'info');
        
    } catch (error) {
        console.error('Error:', error);
        mostrarMensaje('Error al actualizar el estado de producción externa');
        // Revertir el estado del switch al anterior
        switchElement.checked = previousChecked;
    } finally {
        // Habilitar el switch nuevamente
        switchElement.disabled = false;
    }
}

// Funciones para edición inline de kilos_unidad

/**
 * Configura los event listeners para la edición inline de kilos_unidad
 * @param {HTMLElement} tbody - El tbody de la tabla donde están los inputs
 */
function configurarEventosKilosUnidad(tbody) {
    const inputsKilosUnidad = tbody.querySelectorAll('.input-kilos-unidad');
    
    inputsKilosUnidad.forEach((input) => {
        // Remover listeners anteriores si existen
        const newInput = input.cloneNode(true);
        input.parentNode.replaceChild(newInput, input);
        
        // Agregar listener de dblclick
        newInput.addEventListener('dblclick', function(e) {
            activarEdicionKilosUnidad(this);
        }, true);
        
        // Agregar otros listeners necesarios
        newInput.addEventListener('keypress', function(e) {
            if (e.key === 'Enter') {
                e.preventDefault();
                guardarKilosUnidad(this);
            }
        });
        
        newInput.addEventListener('blur', function() {
            // Solo guardar si no está editando activamente o si perdió el foco por más de 500ms
            if (!this.disabled && this.dataset.editandoActivamente === 'true') {
                // Dar tiempo al usuario para seguir escribiendo
                setTimeout(() => {
                    if (document.activeElement !== this && this.dataset.editandoActivamente === 'true') {
                        guardarKilosUnidad(this);
                    }
                }, 500);
            }
        });
        
        newInput.addEventListener('keydown', function(e) {
            if (e.key === 'Escape') {
                e.preventDefault();
                cancelarEdicionKilosUnidad(this);
            }
        });
    });
}

function activarEdicionKilosUnidad(input) {
    console.log(`✏️ [LOG Edición] Activando edición para artículo: ${input.dataset.articulo}`);
    console.log(`✏️ [LOG Edición] Estado inicial - disabled: ${input.disabled}, valor: "${input.value}"`);
    
    if (input.disabled) {
        const valorAnterior = input.value;
        input.disabled = false;
        input.style.backgroundColor = '#ffffff';
        input.style.border = '2px solid #007bff';
        input.dataset.valorAnterior = valorAnterior;
        input.dataset.editandoActivamente = 'true';
        
        // Seleccionar todo el texto para facilitar la edición
        setTimeout(() => {
            input.focus();
            input.select();
        }, 10);
        
        console.log(`✏️ [LOG Edición] Edición activada para artículo: ${input.dataset.articulo}`);
        console.log(`🔧 [KILOS_UNIDAD] Edición activada para artículo ${input.dataset.articulo}`);
    } else {
        console.log(`⚠️ [LOG Edición] Input ya estaba habilitado para artículo: ${input.dataset.articulo}`);
    }
}

function cancelarEdicionKilosUnidad(input) {
    input.value = input.dataset.valorAnterior || '';
    input.disabled = true;
    input.style.backgroundColor = '#f5f5f5';
    console.log(`❌ [KILOS_UNIDAD] Edición cancelada para artículo ${input.dataset.articulo}`);
}

async function guardarKilosUnidad(input) {
    if (input.disabled) return;

    const nuevoValor = input.value.trim();
    const valorAnterior = input.dataset.valorAnterior || '';
    const articuloId = input.dataset.articulo;

    console.log(`💾 Guardando kilos_unidad para artículo ${articuloId}`);
    console.log(`📊 Valor anterior: "${valorAnterior}" → Nuevo valor: "${nuevoValor}"`);

    // Validar valor numérico positivo o cero
    if (nuevoValor !== '' && (isNaN(nuevoValor) || Number(nuevoValor) < 0)) {
        console.log(`❌ Valor inválido: ${nuevoValor}`);
        mostrarMensaje('Valor inválido para kilos por unidad. Debe ser un número positivo o cero.', 'error');
        cancelarEdicionKilosUnidad(input);
        return;
    }

    if (nuevoValor === valorAnterior) {
        console.log(`ℹ️ Sin cambios para artículo ${articuloId}`);
        cancelarEdicionKilosUnidad(input);
        return;
    }

    try {
        const valorNumerico = nuevoValor === '' ? null : Number(nuevoValor);
        
        console.log(`📤 Enviando al backend: articulo_numero=${articuloId}, kilos_unidad=${valorNumerico}`);
        
        const response = await fetch(`/api/produccion/articulos/${encodeURIComponent(articuloId)}/kilos-unidad`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ kilos_unidad: valorNumerico })
        });

        console.log(`📥 Respuesta del backend: Status ${response.status}`);

        if (!response.ok) {
            const errorData = await response.json();
            console.log(`❌ [LOG Error] Error al actualizar valor: ${response.status} ${response.statusText}`);
            console.log(`❌ [LOG Error] Detalles del error:`, errorData);
            throw new Error(errorData.error || 'Error al actualizar kilos por unidad');
        }

        const responseData = await response.json();
        console.log(`📡 [LOG Backend] Respuesta OK del servidor. Valor actualizado.`);
        console.log(`✅ Backend confirmó guardado exitoso:`, responseData);

        // Actualizar el valor en todosLosArticulos
        const articulo = todosLosArticulos.find(a => a.numero === articuloId);
        if (articulo) {
            articulo.kilos_unidad = valorNumerico;
            console.log(`✅ Valor actualizado en memoria local`);
        }

        mostrarMensaje('Kilos por unidad actualizado correctamente', 'info');
        input.dataset.valorAnterior = nuevoValor;
        input.disabled = true;
        input.style.backgroundColor = '#f5f5f5';
        
        console.log(`✅ Guardado completado para artículo ${articuloId}`);
    } catch (error) {
        console.error(`❌ Error al guardar kilos_unidad para artículo ${articuloId}:`, error);
        mostrarMensaje('Error al guardar kilos por unidad: ' + error.message, 'error');
        cancelarEdicionKilosUnidad(input);
    }
}
