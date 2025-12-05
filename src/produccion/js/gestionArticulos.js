// Variables globales para el inventario y ajustes
let usuarioSeleccionado = null;
let usuarioAjustes = null;
let articulosInventario = new Map(); // Mapa para almacenar los artículos escaneados
let articulosSeleccionados = new Map(); // Mapa para almacenar los artículos seleccionados para ajuste
let socket = null;
let sessionId = null;
let modoSeleccion = false;

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
        const colspan = modoSeleccion ? 8 : 7;
        tbody.innerHTML = `<tr><td colspan="${colspan}" class="mensaje-info">No hay artículos registrados</td></tr>`;
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
        const checkboxHtml = modoSeleccion ? `
            <td class="checkbox-cell">
                <input type="checkbox" 
                       class="checkbox-articulo" 
                       data-articulo="${articulo.numero}"
                       ${articulosSeleccionados.has(articulo.numero) ? 'checked' : ''}>
            </td>` : '';
        
        tr.innerHTML = `
            ${checkboxHtml}
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

    // Actualizar eventos de los checkboxes si estamos en modo selección
    if (modoSeleccion) {
        const checkboxes = tbody.querySelectorAll('.checkbox-articulo');
        checkboxes.forEach(checkbox => {
            checkbox.addEventListener('change', function() {
                const articuloNumero = this.dataset.articulo;
                const articulo = todosLosArticulos.find(a => a.numero === articuloNumero);
                
                if (this.checked) {
                    articulosSeleccionados.set(articuloNumero, articulo);
                } else {
                    articulosSeleccionados.delete(articuloNumero);
                }
            });
        });
    }

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

        const articulos = await response.json();
        console.log('🔍 [FRONTEND] ===== DATOS RECIBIDOS DEL BACKEND =====');
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

// Funciones para el modal de inventario
function mostrarModal() {
    const modal = document.getElementById('modal-inventario');
    modal.style.display = 'block';
    document.getElementById('paso-usuario').style.display = 'block';
    document.getElementById('paso-conteo').style.display = 'none';
    cargarUsuarios();
}

function cerrarModal() {
    const modal = document.getElementById('modal-inventario');
    modal.style.display = 'none';
    reiniciarInventario();
}

function reiniciarInventario() {
    console.log('🧹 Reiniciando inventario...');
    usuarioSeleccionado = null;
    articulosInventario.clear();
    document.getElementById('select-usuario').value = '';
    document.getElementById('input-codigo-barras').value = '';
    document.getElementById('articulos-inventario').innerHTML = '';
    document.getElementById('btn-continuar-usuario').disabled = true;
    
    // Limpiar botones de prueba si existen
    const testButtons = document.getElementById('test-buttons');
    if (testButtons) {
        console.log('🧹 Eliminando botones de prueba existentes');
        testButtons.remove();
    }
    
    // Cerrar conexión WebSocket si existe
    if (socket) {
        console.log('🧹 Cerrando conexión WebSocket');
        socket.emit('finalizar_inventario', { sessionId });
        socket.disconnect();
        socket = null;
    }
    sessionId = null;
    sessionStorage.removeItem('usuarioInventario');
    console.log('🧹 Inventario reiniciado completamente');
}

async function cargarUsuarios() {
    try {
        console.log('🔄 Cargando usuarios...');
        
        // Limpiar botones de prueba existentes antes de cargar nuevos
        const testButtonsExistentes = document.getElementById('test-buttons');
        if (testButtonsExistentes) {
            console.log('🧹 Eliminando botones de prueba existentes antes de cargar');
            testButtonsExistentes.remove();
        }
        
        const response = await fetch('/api/usuarios?rol=3&activo=true');
        if (!response.ok) throw new Error('Error al cargar usuarios');
        
        const usuarios = await response.json();
        const select = document.getElementById('select-usuario');
        select.innerHTML = '<option value="">-- Seleccionar usuario --</option>';
        
        usuarios.forEach(usuario => {
            const option = document.createElement('option');
            option.value = usuario.id;
            option.textContent = usuario.nombre_completo;
            select.appendChild(option);
        });
        
        // Agregar botones de prueba para cada usuario (temporal para testing)
        const pasoUsuario = document.getElementById('paso-usuario');
        const testDiv = document.createElement('div');
        testDiv.id = 'test-buttons';
        testDiv.style.marginTop = '10px';
        testDiv.innerHTML = '<p><strong>Botones de prueba:</strong></p>';
        
        usuarios.forEach(usuario => {
            const btn = document.createElement('button');
            btn.textContent = `Seleccionar ${usuario.nombre_completo}`;
            btn.style.margin = '5px';
            btn.style.padding = '5px 10px';
            btn.style.backgroundColor = '#28a745';
            btn.style.color = 'white';
            btn.style.border = 'none';
            btn.style.borderRadius = '3px';
            btn.style.cursor = 'pointer';
            
            btn.addEventListener('click', () => {
                console.log('🔘 Botón de prueba clickeado para:', usuario.nombre_completo);
                select.value = usuario.id;
                usuarioSeleccionado = usuario.id;
                const btnContinuar = document.getElementById('btn-continuar-usuario');
                btnContinuar.disabled = false;
                console.log('✅ Usuario seleccionado:', usuario.id);
                
                // Disparar evento change manualmente
                const event = new Event('change', { bubbles: true });
                select.dispatchEvent(event);
            });
            
            testDiv.appendChild(btn);
        });
        
        pasoUsuario.appendChild(testDiv);
        
        console.log('✅ Usuarios cargados:', usuarios.length);
        
    } catch (error) {
        console.error('Error al cargar usuarios:', error);
        mostrarMensaje('No se pudieron cargar los usuarios');
    }
}

function mostrarPasoConteo() {
    document.getElementById('paso-usuario').style.display = 'none';
    document.getElementById('paso-conteo').style.display = 'block';
    
    // PRIMERO: Guardar el usuario seleccionado en la sesión
    const usuarioNombre = document.getElementById('select-usuario').options[document.getElementById('select-usuario').selectedIndex].text;
    sessionStorage.setItem('usuarioInventario', JSON.stringify({
        id: usuarioSeleccionado,
        nombre: usuarioNombre
    }));
    
    // DESPUÉS: Inicializar WebSocket y generar sesión
    inicializarWebSocket();
    
    document.getElementById('input-codigo-barras').focus();
}

/**
 * Inicializa la conexión WebSocket y genera una sesión de inventario
 */
function inicializarWebSocket() {
    try {
        console.log('🚀 [PC] ===== INICIANDO WEBSOCKET PARA INVENTARIO =====');
        console.log('📅 [PC] Timestamp:', new Date().toISOString());
        
        // Conectar a WebSocket con opciones de reconexión
        socket = io({
            reconnection: true,
            reconnectionAttempts: 5,
            reconnectionDelay: 1000
        });
        
        // Generar ID de sesión único con timestamp para debugging
        const timestamp = Date.now();
        const random = Math.random().toString(36).substr(2, 9);
        sessionId = `inv_${timestamp}_${random}`;
        
        console.log('🆔 [PC] ===== GENERACIÓN DE SESSION ID =====');
        console.log('- Timestamp:', timestamp);
        console.log('- Random:', random);
        console.log('- Session ID completo:', sessionId);
        
        socket.on('connect', () => {
            console.log('✅ [PC] Conectado a WebSocket con socket ID:', socket.id);
            
            // Obtener información del usuario
            const usuarioInfo = JSON.parse(sessionStorage.getItem('usuarioInventario') || '{}');
            console.log('👤 [PC] Información del usuario para sesión:', usuarioInfo);
            
            // Iniciar sesión de inventario
            const datosInicioSesion = { 
                sessionId,
                usuario: usuarioInfo
            };
            console.log('📤 [PC] Enviando iniciar_inventario con datos:', datosInicioSesion);
            socket.emit('iniciar_inventario', datosInicioSesion);
        });
        
        socket.on('inventario_iniciado', (data) => {
            console.log('🎉 [PC] SESIÓN DE INVENTARIO INICIADA EXITOSAMENTE');
            console.log('🎉 [PC] Datos recibidos del servidor:', data);
            console.log('🎉 [PC] Session ID confirmado:', data.sessionId);
            
            // Generar código QR con el ID de sesión
            generarCodigoQR();
        });
        
        socket.on('movil_conectado', (data) => {
            console.log('📱 [PC] DISPOSITIVO MÓVIL CONECTADO');
            console.log('📱 [PC] Datos del móvil:', data);
            mostrarMensaje('Dispositivo móvil conectado', 'info');
        });
        
        socket.on('movil_desconectado', (data) => {
            console.log('📱 [PC] DISPOSITIVO MÓVIL DESCONECTADO');
            console.log('📱 [PC] Datos:', data);
            mostrarMensaje('Dispositivo móvil desconectado', 'info');
        });
        
        socket.on('nuevo_articulo', (data) => {
            console.log('🔥 [PC] ===== EVENTO nuevo_articulo RECIBIDO =====');
            console.log('🔥 [PC] Datos completos recibidos:', JSON.stringify(data, null, 2));
            console.log('🔥 [PC] Session ID del evento:', data.sessionId);
            console.log('🔥 [PC] Session ID actual de PC:', sessionId);
            console.log('🔥 [PC] Estructura del artículo:', data.articulo);
            console.log('🔥 [PC] Cantidad recibida:', data.cantidad);
            
            // Verificar que el sessionId coincida
            if (data.sessionId !== sessionId) {
                console.error('❌ [PC] ERROR: Session ID no coincide');
                console.error('❌ [PC] Esperado:', sessionId);
                console.error('❌ [PC] Recibido:', data.sessionId);
                mostrarMensaje('Error: Sesión no válida', 'error');
                return;
            }
            
            const articulo = data.articulo;
            const cantidad = data.cantidad;
            
            if (!articulo) {
                console.error('❌ [PC] ERROR: No se recibió información del artículo');
                mostrarMensaje('Error: Datos del artículo incompletos', 'error');
                return;
            }
            
            console.log('🔍 [PC] Buscando artículo existente con número:', articulo.numero);
            
            // Si el artículo ya existe, actualizar cantidad
            const existingInput = document.querySelector(`input[data-articulo="${articulo.numero}"]`);
            if (existingInput) {
                console.log('✅ [PC] Artículo existente encontrado, actualizando cantidad');
                console.log('✅ [PC] Input encontrado:', existingInput);
                existingInput.value = cantidad;
                mostrarMensaje(`Cantidad actualizada para ${articulo.nombre}: ${cantidad}`, 'info');
            } else {
                console.log('➕ [PC] Artículo nuevo, agregando al inventario');
                console.log('➕ [PC] Llamando a agregarArticuloAInventario...');
                // Agregar nuevo artículo
                agregarArticuloAInventario(articulo, cantidad);
                mostrarMensaje(`Artículo agregado desde móvil: ${articulo.nombre}`, 'info');
            }
            
            console.log('🔥 [PC] ===== FIN PROCESAMIENTO nuevo_articulo =====');
        });
        
        socket.on('disconnect', () => {
            console.log('❌ [PC] Desconectado de WebSocket');
            console.log('❌ [PC] Session ID era:', sessionId);
        });
        
        // Agregar listener para errores generales
        socket.on('error', (error) => {
            console.error('❌ [PC] Error en WebSocket:', error);
        });
        
        // Agregar listener para eventos no manejados
        socket.onAny((eventName, ...args) => {
            if (!['connect', 'inventario_iniciado', 'movil_conectado', 'movil_desconectado', 'nuevo_articulo', 'disconnect'].includes(eventName)) {
                console.log('🔔 [PC] Evento WebSocket no manejado:', eventName, args);
            }
        });
        
    } catch (error) {
        console.error('❌ [PC] Error al inicializar WebSocket:', error);
        mostrarMensaje('Error al conectar con el servidor', 'error');
    }
}

/**
 * Genera el código QR para acceso móvil al inventario
 */
function generarCodigoQR() {
    try {
        console.log('🔗 [PC] ===== GENERANDO CÓDIGO QR =====');
        console.log('🔗 [PC] Timestamp:', new Date().toISOString());
        console.log('🔗 [PC] Session ID actual:', sessionId);
        console.log('🔗 [PC] Tipo de sessionId:', typeof sessionId);
        console.log('🔗 [PC] Longitud sessionId:', sessionId?.length);
        
        // Validar sessionId antes de generar QR
        if (!sessionId) {
            console.error('❌ [PC] ERROR: sessionId es null/undefined');
            mostrarMensaje('Error: No hay ID de sesión válido', 'error');
            return;
        }
        
        if (!sessionId.startsWith('inv_')) {
            console.error('❌ [PC] ERROR: sessionId no tiene formato válido:', sessionId);
            mostrarMensaje('Error: Formato de sesión inválido', 'error');
            return;
        }
        
        // Usar la URL de Cloudflare para acceso externo
        const baseUrl = 'https://inventario.lamdaser.com';
        // Mantener la ruta original a /pages/inventario-movil.html
        const urlMovil = `${baseUrl}/pages/inventario-movil.html?session=${encodeURIComponent(sessionId)}`;
        
        console.log('🔗 [PC] URL base (Cloudflare):', baseUrl);
        console.log('🔗 [PC] URL generada para el QR:', urlMovil);
        console.log('🔗 [PC] Session ID en URL:', sessionId);
        console.log('🔗 [PC] Verificando formato URL...');
        
        // Verificar que la URL se construyó correctamente
        try {
            const testUrl = new URL(urlMovil);
            const testSessionId = testUrl.searchParams.get('session');
            console.log('🔗 [PC] URL parseada correctamente');
            console.log('🔗 [PC] Session ID extraído de URL de prueba:', testSessionId);
            
            if (testSessionId !== sessionId) {
                console.error('❌ [PC] ERROR: Session ID no coincide en URL');
                console.error('❌ [PC] Original:', sessionId);
                console.error('❌ [PC] Extraído:', testSessionId);
                mostrarMensaje('Error: Problema al generar URL', 'error');
                return;
            }
        } catch (urlError) {
            console.error('❌ [PC] ERROR: URL malformada:', urlError);
            mostrarMensaje('Error: URL inválida generada', 'error');
            return;
        }
        
        // Mostrar la URL en texto para debugging
        document.getElementById('url-movil').textContent = urlMovil;
        
        // Verificar si la librería QRCode está disponible
        if (typeof QRCode === 'undefined') {
            console.error('La librería QRCode no está cargada');
            mostrarMensaje('Error: Librería QR no disponible', 'error');
            return;
        }
        
        // Verificar si el contenedor existe
        const qrContainer = document.getElementById('qr-canvas');
        if (!qrContainer) {
            console.error('Contenedor qr-canvas no encontrado');
            mostrarMensaje('Error: Contenedor QR no encontrado', 'error');
            return;
        }
        
        // Limpiar contenido anterior
        qrContainer.innerHTML = '';
        
        console.log('Contenedor encontrado:', qrContainer);
        console.log('QRCode disponible:', typeof QRCode);
        
        // Generar el código QR usando la API de qrcodejs
        const qrcode = new QRCode(qrContainer, {
            text: urlMovil,
            width: 200,
            height: 200,
            colorDark: '#000000',
            colorLight: '#FFFFFF',
            correctLevel: QRCode.CorrectLevel.M
        });
        
        console.log('Código QR generado correctamente');
        
    } catch (error) {
        console.error('Error en generarCodigoQR:', error);
        mostrarMensaje('Error al generar código QR: ' + error.message, 'error');
    }
}

async function buscarArticuloPorCodigo(codigoBarras) {
    try {
        const response = await fetch(`/api/produccion/articulos/buscar?codigo_barras=${codigoBarras}`);
        if (!response.ok) throw new Error('Artículo no encontrado');
        return await response.json();
    } catch (error) {
        console.error('Error al buscar artículo:', error);
        mostrarMensaje('Artículo no encontrado');
        return null;
    }
}

function agregarArticuloAInventario(articulo, cantidadInicial = 0) {
    console.log('🚀 EJECUTANDO agregarArticuloAInventario');
    console.log('🚀 Artículo recibido:', articulo);
    console.log('🚀 Cantidad inicial:', cantidadInicial);
    console.log('🚀 Artículos en inventario actual:', articulosInventario.size);
    
    if (articulosInventario.has(articulo.numero)) {
        console.log('⚠️ Artículo ya existe en inventario');
        // Si el artículo ya existe, actualizar la cantidad si viene del móvil
        if (cantidadInicial > 0) {
            const input = document.querySelector(`input[data-articulo="${articulo.numero}"]`);
            if (input) {
                input.value = cantidadInicial;
                mostrarMensaje(`Cantidad actualizada para ${articulo.nombre}: ${cantidadInicial}`, 'info');
                console.log('✅ Cantidad actualizada en input existente');
            } else {
                console.error('❌ No se encontró el input para actualizar');
            }
        } else {
            mostrarMensaje('Este artículo ya fue agregado al inventario', 'info');
        }
        return;
    }

    console.log('➕ Creando nuevo elemento para el artículo');
    const div = document.createElement('div');
    div.className = 'inventario-item';
        div.innerHTML = `
            <h4>${articulo.nombre}</h4>
            <div class="info-row">
                <span>Código: ${articulo.numero}</span>
                <span>Código de Barras: ${articulo.codigo_barras || '-'}</span>
                <span>Stock Actual: ${formatearNumero(articulo.stock_consolidado || 0)}</span>
            </div>
            <div class="stock-input">
                <label>Stock Físico:</label>
                <input type="number" min="0" step="0.01" class="stock-fisico" 
                       data-articulo="${articulo.numero}" value="${cantidadInicial}">
            </div>
        `;

    console.log('🔍 Buscando contenedor articulos-inventario');
    // Insertar al principio del contenedor para que aparezca arriba
    const contenedor = document.getElementById('articulos-inventario');
    if (!contenedor) {
        console.error('❌ ERROR CRÍTICO: No se encontró el contenedor articulos-inventario');
        mostrarMensaje('Error: No se pudo agregar el artículo al formulario', 'error');
        return;
    }
    
    console.log('✅ Contenedor encontrado, insertando elemento');
    contenedor.insertBefore(div, contenedor.firstChild);
    articulosInventario.set(articulo.numero, articulo);
    
    console.log('✅ Artículo agregado al Map. Total artículos:', articulosInventario.size);
    
    // Mostrar el botón "Mostrar Diferencias" si hay artículos
    if (articulosInventario.size > 0) {
        document.getElementById('btn-mostrar-diferencias').style.display = 'inline-block';
    }
    
    // Si viene del móvil, mostrar mensaje
    if (cantidadInicial > 0) {
        mostrarMensaje(`Artículo agregado desde móvil: ${articulo.nombre}`, 'info');
        console.log('✅ Mensaje de confirmación mostrado');
    }
    
    console.log('🎉 agregarArticuloAInventario completado exitosamente');
}

async function finalizarInventario() {
    if (articulosInventario.size === 0) {
        mostrarMensaje('No hay artículos para registrar', 'error');
        return;
    }

    console.log('🚀 [INVENTARIO-ARTICULOS] Iniciando finalización de inventario');
    console.log('📊 [INVENTARIO-ARTICULOS] Total artículos inventariados:', articulosInventario.size);
    console.log('👤 [INVENTARIO-ARTICULOS] Usuario seleccionado:', usuarioSeleccionado);

    // Construir array de artículos inventariados con la estructura requerida por el backend
    const articulosInventariados = [];
    const inputs = document.querySelectorAll('.stock-fisico');
    
    inputs.forEach(input => {
        const articuloNumero = input.dataset.articulo;
        const articulo = articulosInventario.get(articuloNumero);
        const stockContado = parseFloat(input.value) || 0;
        const stockSistema = articulo.stock_consolidado || 0;
        
        console.log(`📦 [ARTICULO] ${articuloNumero}: Sistema=${stockSistema}, Contado=${stockContado}`);
        
        articulosInventariados.push({
            articulo_numero: articuloNumero,
            stock_sistema: stockSistema,
            stock_contado: stockContado
        });
    });

    console.log('📋 [INVENTARIO-ARTICULOS] Total artículos a procesar:', articulosInventariados.length);

    try {
        const payload = {
            usuario_id: usuarioSeleccionado,
            articulos_inventariados: articulosInventariados
        };

        console.log('📤 [INVENTARIO-ARTICULOS] Enviando datos al backend:', payload);

        const response = await fetch('/api/produccion/inventario-articulos/finalizar', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify(payload)
        });

        if (!response.ok) {
            const errorData = await response.json();
            throw new Error(errorData.error || 'Error al finalizar inventario');
        }

        const resultado = await response.json();
        console.log('✅ [INVENTARIO-ARTICULOS] Respuesta del backend:', resultado);

        mostrarMensaje(`Inventario finalizado correctamente: ${resultado.articulos_registrados} artículos procesados, ${resultado.diferencias_encontradas} diferencias aplicadas`, 'info');
        cerrarModal();
        cargarArticulos(); // Recargar la tabla de artículos
    } catch (error) {
        console.error('❌ [INVENTARIO-ARTICULOS] Error al finalizar inventario:', error);
        mostrarMensaje(`Error al finalizar inventario: ${error.message}`, 'error');
    }
}

// Funciones para ajustes puntuales
function iniciarAjustesPuntuales() {
    mostrarModalAjustes();
}

function mostrarModalAjustes() {
    const modal = document.getElementById('modal-ajustes');
    modal.style.display = 'block';
    document.getElementById('paso-usuario-ajustes').style.display = 'block';
    document.getElementById('paso-ajuste').style.display = 'none';
    cargarUsuariosAjustes();
}

function activarModoSeleccion() {
    modoSeleccion = true;
    articulosSeleccionados.clear();
    document.querySelector('.tabla-articulos').classList.add('modo-seleccion');
    document.getElementById('btn-ajustes-puntuales').style.display = 'none';
    document.getElementById('btn-confirmar-seleccion').style.display = 'inline-block';
    actualizarTablaArticulos(articulosFiltrados.length > 0 ? articulosFiltrados : todosLosArticulos);
}

function cerrarModalAjustes(reiniciarTodo = true) {
    const modal = document.getElementById('modal-ajustes');
    modal.style.display = 'none';
    
    if (reiniciarTodo) {
        reiniciarAjustes();
    }
}

function reiniciarAjustes() {
    usuarioAjustes = null;
    articulosSeleccionados.clear();
    modoSeleccion = false;
    document.querySelector('.tabla-articulos').classList.remove('modo-seleccion');
    document.getElementById('select-usuario-ajustes').value = '';
    document.getElementById('btn-continuar-ajustes').disabled = true;
    document.getElementById('articulos-seleccionados').innerHTML = '';
    document.getElementById('btn-ajustes-puntuales').style.display = 'inline-block';
    document.getElementById('btn-confirmar-seleccion').style.display = 'none';
    actualizarTablaArticulos(articulosFiltrados.length > 0 ? articulosFiltrados : todosLosArticulos);
}

async function cargarUsuariosAjustes() {
    try {
        const response = await fetch('/api/usuarios?rol=3&activo=true');
        if (!response.ok) throw new Error('Error al cargar usuarios');
        
        const usuarios = await response.json();
        const select = document.getElementById('select-usuario-ajustes');
        select.innerHTML = '<option value="">-- Seleccionar usuario --</option>';
        
        usuarios.forEach(usuario => {
            const option = document.createElement('option');
            option.value = usuario.id;
            option.textContent = usuario.nombre_completo;
            select.appendChild(option);
        });
    } catch (error) {
        console.error('Error al cargar usuarios:', error);
        mostrarMensaje('No se pudieron cargar los usuarios');
    }
}

function mostrarPasoAjuste() {
    document.getElementById('paso-usuario-ajustes').style.display = 'none';
    document.getElementById('paso-ajuste').style.display = 'block';
    mostrarArticulosSeleccionados();
}

function mostrarArticulosSeleccionados() {
    const contenedor = document.getElementById('articulos-seleccionados');
    contenedor.innerHTML = '';

    articulosSeleccionados.forEach(articulo => {
        const div = document.createElement('div');
        div.className = 'ajuste-item';
        const stockActual = articulo.stock_consolidado || 0;
        
        div.innerHTML = `
            <h4>${articulo.nombre}</h4>
            <div class="info-row">
                <span>Código: ${articulo.numero}</span>
                <span>Código de Barras: ${articulo.codigo_barras || '-'}</span>
                <span>Stock Actual: ${stockActual}</span>
            </div>
            <div class="stock-input">
                <label>Stock Físico:</label>
                <input type="number" 
                       min="0" 
                       step="0.01" 
                       class="stock-nuevo" 
                       data-articulo="${articulo.numero}"
                       data-stock-actual="${stockActual}"
                       value="${stockActual}">
            </div>
        `;
        contenedor.appendChild(div);
    });

    // Agregar listeners para validación de inputs
    const inputs = contenedor.querySelectorAll('.stock-nuevo');
    inputs.forEach(input => {
        input.addEventListener('change', function() {
            const valor = parseInt(this.value) || 0;
            if (valor < 0) {
                this.value = 0;
                mostrarMensaje('El stock no puede ser negativo', 'error');
            }
        });
    });
}

async function finalizarAjustes() {
    console.log('🔧 [AJUSTE-MANUAL] ===== INICIANDO FINALIZACIÓN DE AJUSTES MANUALES =====');
    
    if (articulosSeleccionados.size === 0) {
        console.log('❌ [AJUSTE-MANUAL] No hay artículos seleccionados');
        mostrarMensaje('No hay artículos seleccionados para ajustar', 'error');
        return;
    }

    // Construir array de ajustes para el nuevo endpoint
    const ajustes = [];
    const inputs = document.querySelectorAll('.stock-nuevo');
    let hayAjustes = false;
    
    console.log(`🔧 [AJUSTE-MANUAL] Procesando ${inputs.length} inputs de stock`);
    
    inputs.forEach((input, index) => {
        const articuloNumero = input.dataset.articulo;
        const articulo = articulosSeleccionados.get(articuloNumero);
        
        console.log(`\n🔧 [AJUSTE-MANUAL] ===== PROCESANDO ARTÍCULO ${index + 1}/${inputs.length} =====`);
        console.log(`🔧 [AJUSTE-MANUAL] Artículo: ${articulo?.nombre || 'DESCONOCIDO'} (${articuloNumero})`);
        
        // Obtener valores
        const valorRawInput = input.value;
        console.log(`🔧 [AJUSTE-MANUAL] Valor RAW del input: "${valorRawInput}"`);
        
        const stockNuevoFloat = parseFloat(valorRawInput);
        const stockNuevo = isNaN(stockNuevoFloat) ? 0 : stockNuevoFloat;
        
        console.log(`🔧 [AJUSTE-MANUAL] Stock nuevo parseado: ${stockNuevo}`);
        
        const stockActual = articulo.stock_consolidado || 0;
        console.log(`🔧 [AJUSTE-MANUAL] Stock actual: ${stockActual}`);
        
        const diferencia = stockNuevo - stockActual;
        console.log(`🔧 [AJUSTE-MANUAL] Diferencia: ${diferencia}`);
        
        // Solo registrar si hay diferencia significativa
        const MARGEN_TOLERANCIA = 0.001;
        if (Math.abs(diferencia) > MARGEN_TOLERANCIA) {
            console.log(`✅ [AJUSTE-MANUAL] Ajuste necesario detectado: ${diferencia}`);
            hayAjustes = true;
            
            const ajusteData = {
                articulo_numero: articuloNumero,
                stock_nuevo: stockNuevo,
                observacion: `Ajuste manual desde interfaz de gestión`
            };
            
            console.log(`🔧 [AJUSTE-MANUAL] Datos del ajuste:`, JSON.stringify(ajusteData, null, 2));
            ajustes.push(ajusteData);
        } else {
            console.log(`➖ [AJUSTE-MANUAL] Sin cambios significativos para ${articuloNumero}`);
        }
    });

    console.log(`\n🔧 [AJUSTE-MANUAL] ===== RESUMEN =====`);
    console.log(`🔧 [AJUSTE-MANUAL] Total ajustes a procesar: ${ajustes.length}`);
    console.log(`🔧 [AJUSTE-MANUAL] Hay ajustes: ${hayAjustes}`);

    if (!hayAjustes) {
        console.log('ℹ️ [AJUSTE-MANUAL] No hay ajustes para registrar');
        mostrarMensaje('No hay cambios significativos para registrar', 'info');
        cerrarModalAjustes();
        return;
    }

    try {
        console.log(`🔧 [AJUSTE-MANUAL] ===== ENVIANDO AL NUEVO ENDPOINT =====`);
        
        const payload = {
            usuario_id: usuarioAjustes,
            ajustes: ajustes
        };
        
        console.log(`🔧 [AJUSTE-MANUAL] Payload completo:`, JSON.stringify(payload, null, 2));
        
        // ✅ NUEVO ENDPOINT con auditoría completa
        const response = await fetch('/api/produccion/articulos/ajustes-batch', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify(payload)
        });

        console.log(`🔧 [AJUSTE-MANUAL] Respuesta - Status: ${response.status}`);

        if (!response.ok) {
            const errorData = await response.json();
            console.log(`❌ [AJUSTE-MANUAL] Error del servidor:`, errorData);
            throw new Error(errorData.error || 'Error al registrar los ajustes');
        }

        const responseData = await response.json();
        console.log(`✅ [AJUSTE-MANUAL] Respuesta exitosa:`, responseData);

        // Mostrar resumen de resultados
        const { resultados } = responseData;
        if (resultados) {
            const mensaje = `Ajustes completados: ${resultados.exitosos.length} exitosos, ${resultados.fallidos.length} fallidos`;
            mostrarMensaje(mensaje, resultados.fallidos.length > 0 ? 'error' : 'info');
            
            if (resultados.fallidos.length > 0) {
                console.warn('⚠️ [AJUSTE-MANUAL] Ajustes fallidos:', resultados.fallidos);
            }
        } else {
            mostrarMensaje('Ajustes registrados correctamente', 'info');
        }

        cerrarModalAjustes();
        await cargarArticulos(); // Recargar artículos
        
        console.log(`🔧 [AJUSTE-MANUAL] ===== FINALIZACIÓN COMPLETADA =====`);
    } catch (error) {
        console.error('❌ [AJUSTE-MANUAL] Error al finalizar ajustes:', error);
        mostrarMensaje(error.message || 'Error al registrar los ajustes', 'error');
    }
}

/**
 * Compara el stock contado vs el stock del sistema
 */
async function compararStock() {
    console.log('🔍 [DIFERENCIAS] Iniciando comparación de stock...');
    
    if (articulosInventario.size === 0) {
        mostrarMensaje('No hay artículos contados para comparar', 'error');
        return;
    }

    try {
        // Obtener todos los artículos del sistema
        console.log('📊 [DIFERENCIAS] Obteniendo artículos del sistema...');
        const response = await fetch('/api/produccion/articulos');
        if (!response.ok) throw new Error('Error al obtener artículos del sistema');
        
        const articulosDelSistema = await response.json();
        console.log(`📊 [DIFERENCIAS] Artículos del sistema obtenidos: ${articulosDelSistema.length}`);
        
        // Generar lista de diferencias
        const diferencias = [];
        
        // Procesar artículos contados
        console.log('🔄 [DIFERENCIAS] Procesando artículos contados...');
        articulosInventario.forEach((articulo, numeroArticulo) => {
            const input = document.querySelector(`input[data-articulo="${numeroArticulo}"]`);
            const stockContado = parseInt(input?.value || 0);
            const stockSistema = articulo.stock_consolidado || 0;
            const diferencia = stockContado - stockSistema;
            
            console.log(`📝 [DIFERENCIAS] ${articulo.nombre}: Sistema=${stockSistema}, Contado=${stockContado}, Diferencia=${diferencia}`);
            
            diferencias.push({
                codigo: numeroArticulo,
                descripcion: articulo.nombre,
                stockSistema: stockSistema,
                stockContado: stockContado,
                diferencia: diferencia,
                estado: diferencia === 0 ? 'sin-diferencia' : 'con-diferencia',
                esContado: true
            });
        });
        
        // Procesar artículos no contados (solo los que tienen stock en el sistema)
        console.log('🔄 [DIFERENCIAS] Procesando artículos no contados...');
        articulosDelSistema.forEach(articulo => {
            if (!articulosInventario.has(articulo.numero)) {
                const stockSistema = articulo.stock_consolidado || 0;
                if (stockSistema !== 0) { // Solo mostrar artículos con stock diferente de 0
                    console.log(`📝 [DIFERENCIAS] No contado: ${articulo.nombre}, Stock Sistema=${stockSistema}`);
                    
                    diferencias.push({
                        codigo: articulo.numero,
                        descripcion: articulo.nombre,
                        stockSistema: stockSistema,
                        stockContado: 0,
                        diferencia: -stockSistema,
                        estado: 'no-contado',
                        esContado: false
                    });
                }
            }
        });
        
        console.log(`✅ [DIFERENCIAS] Comparación completada. Total diferencias: ${diferencias.length}`);
        
        // Ordenar diferencias según criterio de prioridad visual para el operario
        console.log('🎯 [DIFERENCIAS] Aplicando ordenamiento visual...');
        const diferenciasOrdenadas = diferencias.sort((a, b) => {
            // Determinar prioridad de cada artículo
            const getPrioridad = (item) => {
                const stockSistema = Number(item.stockSistema) || 0;
                const stockContado = Number(item.stockContado) || 0;
                const MARGEN_TOLERANCIA = 0.001;
                const esSinDiferencia = Math.abs(stockContado - stockSistema) <= MARGEN_TOLERANCIA;
                
                if (item.esContado) {
                    if (esSinDiferencia) {
                        return 1; // 🟩 Contados sin diferencia
                    } else {
                        return 2; // 🟥 Contados con diferencia
                    }
                } else {
                    if (Math.abs(stockSistema) <= MARGEN_TOLERANCIA && Math.abs(stockContado) <= MARGEN_TOLERANCIA) {
                        return 3; // 🟨 No contados sin diferencia (ambos cero)
                    } else {
                        return 4; // 🟥 No contados con diferencia
                    }
                }
            };
            
            const prioridadA = getPrioridad(a);
            const prioridadB = getPrioridad(b);
            
            // Ordenar por prioridad, y dentro de cada grupo por código de artículo
            if (prioridadA !== prioridadB) {
                return prioridadA - prioridadB;
            } else {
                return a.codigo.localeCompare(b.codigo);
            }
        });
        
        console.log(`🎯 [DIFERENCIAS] Ordenamiento aplicado. Mostrando ${diferenciasOrdenadas.length} diferencias ordenadas`);
        
        // Mostrar modal con diferencias ordenadas
        mostrarModalDiferencias(diferenciasOrdenadas);
        
    } catch (error) {
        console.error('❌ [DIFERENCIAS] Error al comparar stock:', error);
        mostrarMensaje('Error al comparar stock: ' + error.message, 'error');
    }
}

/**
 * Muestra el modal con las diferencias de stock
 */
function mostrarModalDiferencias(diferencias) {
    console.log('🎯 [DIFERENCIAS] Mostrando modal de diferencias...');
    
    const modal = document.getElementById('modal-diferencias');
    const tbody = document.getElementById('tabla-diferencias-body');
    
    // Limpiar tabla
    tbody.innerHTML = '';
    
    if (diferencias.length === 0) {
        tbody.innerHTML = '<tr><td colspan="6" class="mensaje-info">No hay diferencias de stock</td></tr>';
    } else {
        diferencias.forEach(diferencia => {
            const tr = document.createElement('tr');
            tr.dataset.codigo = diferencia.codigo;
            tr.dataset.esContado = diferencia.esContado;
            
            // Asegurar que los valores sean números para comparación correcta
            const stockSistema = Number(diferencia.stockSistema) || 0;
            const stockContado = Number(diferencia.stockContado) || 0;
            const diferenciaCalculada = stockContado - stockSistema;
            
            // Margen de tolerancia para comparaciones de punto flotante
            const MARGEN_TOLERANCIA = 0.001;
            const esSinDiferencia = Math.abs(diferenciaCalculada) <= MARGEN_TOLERANCIA;
            
            // Log detallado para debugging
            console.log(`🔍 [DIFERENCIAS] Procesando artículo: ${diferencia.codigo}`);
            console.log(`   - Stock Sistema: ${stockSistema} (tipo: ${typeof stockSistema})`);
            console.log(`   - Stock Contado: ${stockContado} (tipo: ${typeof stockContado})`);
            console.log(`   - Diferencia Calculada: ${diferenciaCalculada}`);
            console.log(`   - Es Contado: ${diferencia.esContado}`);
            console.log(`   - Es Sin Diferencia: ${esSinDiferencia}`);
            
            // Nueva lógica para asignar clase de fila según colores deseados
            let claseFila = '';
            if (diferencia.esContado) {
                if (esSinDiferencia) {
                    claseFila = 'sin-diferencia'; // Verde
                    console.log(`🟩 [DIFERENCIAS] Artículo contado sin diferencia: ${diferencia.codigo}`);
                } else {
                    claseFila = 'con-diferencia'; // Rojo
                    console.log(`🟥 [DIFERENCIAS] Artículo contado con diferencia: ${diferencia.codigo}`);
                }
            } else {
                // Para artículos no contados, verificar si ambos valores son cero
                if (Math.abs(stockSistema) <= MARGEN_TOLERANCIA && Math.abs(stockContado) <= MARGEN_TOLERANCIA) {
                    claseFila = 'sin-diferencia'; // Amarillo (neutral) - ambos son cero
                    console.log(`🟨 [DIFERENCIAS] Artículo no contado sin stock (ambos cero): ${diferencia.codigo}`);
                } else {
                    claseFila = 'con-diferencia'; // Rojo (diferencia real)
                    console.log(`🟥 [DIFERENCIAS] Artículo no contado con diferencia real: ${diferencia.codigo}`);
                }
            }
            tr.className = `diferencia-row ${claseFila}`;
            
            // Determinar clase de diferencia para celda
            let claseDiferencia = 'diferencia-cero';
            if (diferenciaCalculada > MARGEN_TOLERANCIA) claseDiferencia = 'diferencia-positiva';
            if (diferenciaCalculada < -MARGEN_TOLERANCIA) claseDiferencia = 'diferencia-negativa';
            
            // Determinar estado badge
            let estadoBadge = '';
            if (claseFila === 'sin-diferencia' && diferencia.esContado) {
                estadoBadge = '<span class="estado-badge estado-contado">Contado</span>';
            } else if (claseFila === 'sin-diferencia' && !diferencia.esContado) {
                estadoBadge = '<span class="estado-badge estado-no-contado">No Contado</span>';
            } else {
                estadoBadge = '<span class="estado-badge estado-diferencia">Diferencia</span>';
            }
            
            // Formatear diferencia para mostrar
            const diferenciaFormateada = Math.abs(diferenciaCalculada) <= MARGEN_TOLERANCIA ? 
                '0' : 
                (diferenciaCalculada > 0 ? '+' : '') + diferenciaCalculada.toFixed(2).replace(/\.?0+$/, '');
            
            tr.innerHTML = `
                <td>${diferencia.codigo}</td>
                <td>${diferencia.descripcion}</td>
                <td>${stockSistema}</td>
                <td>
                    <input type="number" 
                           class="stock-contado-input" 
                           value="${stockContado}" 
                           min="0" 
                           data-codigo="${diferencia.codigo}"
                           data-stock-sistema="${stockSistema}">
                </td>
                <td class="${claseDiferencia}">${diferenciaFormateada}</td>
                <td>${estadoBadge}</td>
            `;
            
            tbody.appendChild(tr);
            
            console.log(`✅ [DIFERENCIAS] Fila creada para ${diferencia.codigo} con clase: ${claseFila}`);
        });
        
        // Agregar eventos a los inputs
        const inputs = tbody.querySelectorAll('.stock-contado-input');
        inputs.forEach(input => {
            input.addEventListener('input', actualizarDiferencia);
        });
    }
    
    // Mostrar modal
    modal.style.display = 'block';
    console.log('✅ [DIFERENCIAS] Modal de diferencias mostrado');
}

/**
 * Actualiza la diferencia cuando se cambia el stock contado
 */
function actualizarDiferencia(event) {
    const input = event.target;
    
    // Asegurar que los valores sean números para comparación correcta
    const stockContado = Number(input.value) || 0;
    const stockSistema = Number(input.dataset.stockSistema) || 0;
    const diferencia = stockContado - stockSistema;
    
    // Margen de tolerancia para comparaciones de punto flotante
    const MARGEN_TOLERANCIA = 0.001;
    const esSinDiferencia = Math.abs(diferencia) <= MARGEN_TOLERANCIA;
    
    // Log detallado para debugging
    console.log(`🔄 [DIFERENCIAS] Actualizando diferencia para ${input.dataset.codigo}:`);
    console.log(`   - Stock Sistema: ${stockSistema} (tipo: ${typeof stockSistema})`);
    console.log(`   - Stock Contado: ${stockContado} (tipo: ${typeof stockContado})`);
    console.log(`   - Diferencia Calculada: ${diferencia}`);
    console.log(`   - Es Sin Diferencia: ${esSinDiferencia}`);
    
    // Actualizar celda de diferencia
    const tr = input.closest('tr');
    const celdaDiferencia = tr.querySelector('td:nth-child(5)');
    
    // Actualizar clase y contenido con margen de tolerancia
    celdaDiferencia.className = '';
    if (diferencia > MARGEN_TOLERANCIA) {
        celdaDiferencia.className = 'diferencia-positiva';
        celdaDiferencia.textContent = '+' + diferencia.toFixed(2).replace(/\.?0+$/, '');
    } else if (diferencia < -MARGEN_TOLERANCIA) {
        celdaDiferencia.className = 'diferencia-negativa';
        celdaDiferencia.textContent = diferencia.toFixed(2).replace(/\.?0+$/, '');
    } else {
        celdaDiferencia.className = 'diferencia-cero';
        celdaDiferencia.textContent = '0';
    }
    
    // Aplicar la misma lógica de colores robusta que en mostrarModalDiferencias
    const esContado = tr.dataset.esContado === 'true';
    let claseFila = '';
    
    if (esContado) {
        if (esSinDiferencia) {
            claseFila = 'sin-diferencia'; // Verde
            console.log(`🟩 [DIFERENCIAS] Artículo contado actualizado sin diferencia: ${input.dataset.codigo}`);
        } else {
            claseFila = 'con-diferencia'; // Rojo
            console.log(`🟥 [DIFERENCIAS] Artículo contado actualizado con diferencia: ${input.dataset.codigo}`);
        }
    } else {
        // Para artículos no contados, verificar si ambos valores son cero con tolerancia
        if (Math.abs(stockSistema) <= MARGEN_TOLERANCIA && Math.abs(stockContado) <= MARGEN_TOLERANCIA) {
            claseFila = 'sin-diferencia'; // Amarillo (neutral) - ambos son cero
            console.log(`🟨 [DIFERENCIAS] Artículo no contado actualizado sin stock (ambos cero): ${input.dataset.codigo}`);
        } else {
            claseFila = 'con-diferencia'; // Rojo (diferencia real)
            console.log(`🟥 [DIFERENCIAS] Artículo no contado actualizado con diferencia real: ${input.dataset.codigo}`);
        }
    }
    
    tr.className = `diferencia-row ${claseFila}`;
    
    console.log(`✅ [DIFERENCIAS] Actualizada diferencia para ${input.dataset.codigo}: ${diferencia} (clase: ${claseFila})`);
}

/**
 * Guarda las correcciones realizadas en el modal de diferencias
 */
async function guardarCorrecciones() {
    console.log('💾 [CORRECCIONES] Iniciando guardado de correcciones...');
    
    const inputs = document.querySelectorAll('.stock-contado-input');
    let articulosAgregados = 0;
    let articulosModificados = 0;
    
    inputs.forEach(input => {
        const codigo = input.dataset.codigo;
        const stockContado = parseInt(input.value) || 0;
        const tr = input.closest('tr');
        const esContado = tr.dataset.esContado === 'true';
        
        if (esContado) {
            // Artículo ya contado - actualizar si fue modificado
            const inputOriginal = document.querySelector(`input[data-articulo="${codigo}"]`);
            if (inputOriginal && parseInt(inputOriginal.value) !== stockContado) {
                inputOriginal.value = stockContado;
                articulosModificados++;
                console.log(`✏️ [CORRECCIONES] Modificado: ${codigo} -> ${stockContado}`);
            }
        } else {
            // Artículo no contado - agregar al inventario
            const articulo = todosLosArticulos.find(a => a.numero === codigo);
            if (articulo) {
                agregarArticuloAInventario(articulo, stockContado);
                articulosAgregados++;
                console.log(`➕ [CORRECCIONES] Agregado: ${codigo} -> ${stockContado}`);
            }
        }
    });
    
    // Mostrar el botón "Mostrar Diferencias" si hay artículos
    if (articulosInventario.size > 0) {
        document.getElementById('btn-mostrar-diferencias').style.display = 'inline-block';
    }
    
    // Cerrar modal
    document.getElementById('modal-diferencias').style.display = 'none';
    
    // Mostrar resumen
    const mensaje = `Correcciones aplicadas: ${articulosAgregados} artículos agregados, ${articulosModificados} artículos modificados`;
    mostrarMensaje(mensaje, 'info');
    
    console.log(`✅ [CORRECCIONES] Guardado completado: +${articulosAgregados} agregados, ~${articulosModificados} modificados`);
}

// Event Listeners
document.addEventListener('DOMContentLoaded', () => {
    console.log('Página de gestión de artículos cargada');
    cargarArticulos();

    // Botón para iniciar inventario
    document.getElementById('btn-iniciar-inventario').addEventListener('click', mostrarModal);

    // Botones para ajustes puntuales
    document.getElementById('btn-ajustes-puntuales').addEventListener('click', iniciarAjustesPuntuales);
    document.getElementById('btn-confirmar-seleccion').addEventListener('click', () => {
        if (articulosSeleccionados.size === 0) {
            mostrarMensaje('Debe seleccionar al menos un artículo', 'error');
            return;
        }
        document.getElementById('paso-ajuste').style.display = 'block';
        mostrarArticulosSeleccionados();
        document.getElementById('modal-ajustes').style.display = 'block';
    });

    // Cerrar modales
    document.getElementById('close-modal').addEventListener('click', cerrarModal);
    document.getElementById('close-modal-ajustes').addEventListener('click', () => cerrarModalAjustes(true));

    // Selects de usuario
    const selectUsuario = document.getElementById('select-usuario');
    const selectUsuarioAjustes = document.getElementById('select-usuario-ajustes');
    
    function actualizarSeleccionUsuario(select, variable, btnId) {
        const valor = select.value;
        if (variable === 'usuarioSeleccionado') {
            usuarioSeleccionado = valor;
        } else {
            usuarioAjustes = valor;
        }
        const btnContinuar = document.getElementById(btnId);
        btnContinuar.disabled = !valor;
    }
    
    // Eventos del select de inventario
    selectUsuario.addEventListener('change', () => actualizarSeleccionUsuario(selectUsuario, 'usuarioSeleccionado', 'btn-continuar-usuario'));
    selectUsuario.addEventListener('input', () => actualizarSeleccionUsuario(selectUsuario, 'usuarioSeleccionado', 'btn-continuar-usuario'));
    selectUsuario.addEventListener('keydown', (e) => setTimeout(() => actualizarSeleccionUsuario(selectUsuario, 'usuarioSeleccionado', 'btn-continuar-usuario'), 10));
    
    // Eventos del select de ajustes
    selectUsuarioAjustes.addEventListener('change', () => actualizarSeleccionUsuario(selectUsuarioAjustes, 'usuarioAjustes', 'btn-continuar-ajustes'));
    selectUsuarioAjustes.addEventListener('input', () => actualizarSeleccionUsuario(selectUsuarioAjustes, 'usuarioAjustes', 'btn-continuar-ajustes'));
    selectUsuarioAjustes.addEventListener('keydown', (e) => setTimeout(() => actualizarSeleccionUsuario(selectUsuarioAjustes, 'usuarioAjustes', 'btn-continuar-ajustes'), 10));

    // Botones continuar
    document.getElementById('btn-continuar-usuario').addEventListener('click', () => {
        if (usuarioSeleccionado) {
            mostrarPasoConteo();
        } else {
            mostrarMensaje('Por favor selecciona un usuario', 'error');
        }
    });

    document.getElementById('btn-continuar-ajustes').addEventListener('click', () => {
        if (usuarioAjustes) {
            cerrarModalAjustes(false);
            activarModoSeleccion();
        } else {
            mostrarMensaje('Por favor selecciona un usuario', 'error');
        }
    });

    // Input de código de barras y botones de inventario
    document.getElementById('input-codigo-barras').addEventListener('keypress', async (e) => {
        if (e.key === 'Enter') {
            const codigo = e.target.value.trim();
            if (!codigo) return;

            const articulo = await buscarArticuloPorCodigo(codigo);
            if (articulo) {
                agregarArticuloAInventario(articulo);
                e.target.value = '';
            }
        }
    });

    // Botones de finalizar y cancelar inventario
    document.getElementById('btn-finalizar-inventario').addEventListener('click', finalizarInventario);
    document.getElementById('btn-cancelar-inventario').addEventListener('click', cerrarModal);

    // Botones de finalizar y cancelar ajustes
    document.getElementById('btn-finalizar-ajustes').addEventListener('click', finalizarAjustes);
    document.getElementById('btn-cancelar-ajustes').addEventListener('click', cerrarModalAjustes);

    // Botones del modal de diferencias
    document.getElementById('btn-mostrar-diferencias').addEventListener('click', compararStock);
    document.getElementById('btn-guardar-correcciones').addEventListener('click', guardarCorrecciones);
    document.getElementById('btn-cerrar-diferencias').addEventListener('click', () => {
        document.getElementById('modal-diferencias').style.display = 'none';
    });
    document.getElementById('close-modal-diferencias').addEventListener('click', () => {
        document.getElementById('modal-diferencias').style.display = 'none';
    });

    // Checkbox seleccionar todos
    document.getElementById('seleccionar-todos').addEventListener('change', function() {
        const checkboxes = document.querySelectorAll('.checkbox-articulo');
        checkboxes.forEach(checkbox => {
            checkbox.checked = this.checked;
            const articuloNumero = checkbox.dataset.articulo;
            const articulo = todosLosArticulos.find(a => a.numero === articuloNumero);
            
            if (this.checked) {
                articulosSeleccionados.set(articuloNumero, articulo);
            } else {
                articulosSeleccionados.delete(articuloNumero);
            }
        });
    });

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
