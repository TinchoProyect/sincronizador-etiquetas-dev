// ===== VARIABLES GLOBALES =====
// Variables para el inventario y ajustes de ingredientes
let usuarioSeleccionado = null;
let usuarioAjustes = null;
let ingredientesInventario = new Map(); // Mapa para almacenar los ingredientes escaneados
let ingredientesSeleccionados = new Map(); // Mapa para almacenar los ingredientes seleccionados para ajuste
let socket = null;
let sessionId = null;
let modoSeleccion = false;

// Variables para filtrado
let todosLosIngredientes = []; // Array para almacenar todos los ingredientes cargados
let ingredientesFiltrados = []; // Array para almacenar los ingredientes filtrados

// Variables para sectores
let todosLosSectores = []; // Array para almacenar todos los sectores disponibles

// ===== FUNCIONES UTILITARIAS =====

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
    console.log(`📢 [MENSAJE] ${tipo.toUpperCase()}: ${mensaje}`);
    
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

// ===== FUNCIONES DE TABLA Y FILTRADO =====

// Función para actualizar la tabla con los ingredientes
function actualizarTablaIngredientes(ingredientes) {
    console.log('🔄 [DEBUG] actualizarTablaIngredientes - Iniciando actualización de tabla');
    console.log('🔄 [DEBUG] Cantidad de ingredientes recibidos:', ingredientes?.length || 0);
    console.log('🔄 [DEBUG] Modo selección activo:', modoSeleccion);
    
    const tbody = document.getElementById('tabla-ingredientes-body');
    if (!tbody) {
        console.error('❌ [DEBUG] No se encontró tbody con ID tabla-ingredientes-body');
        return;
    }

    tbody.innerHTML = '';

    if (!ingredientes || ingredientes.length === 0) {
        const colspan = modoSeleccion ? 6 : 5;
        tbody.innerHTML = `<tr><td colspan="${colspan}" class="mensaje-info">No hay ingredientes registrados</td></tr>`;
        return;
    }

    ingredientes.forEach((ingrediente, index) => {
        const stockActual = ingrediente.stock_actual || 0;
        console.log(`📊 [DEBUG] Ingrediente ${index + 1}: ${ingrediente.nombre} - Stock Actual: ${stockActual}`);
        
        const tr = document.createElement('tr');
        const checkboxHtml = modoSeleccion ? `
            <td class="checkbox-cell">
                <input type="checkbox" 
                       class="checkbox-ingrediente" 
                       data-ingrediente="${ingrediente.id}"
                       ${ingredientesSeleccionados.has(ingrediente.id.toString()) ? 'checked' : ''}>
            </td>` : '';
        
        tr.innerHTML = `
            ${checkboxHtml}
            <td>${ingrediente.id}</td>
            <td>${ingrediente.nombre}</td>
            <td>${ingrediente.codigo || '-'}</td>
            <td>${formatearNumero(stockActual)} ${ingrediente.unidad_medida || 'kg'}</td>
        `;
        tbody.appendChild(tr);
    });
    
    console.log('✅ [DEBUG] actualizarTablaIngredientes - Tabla actualizada correctamente');

    // Actualizar eventos de los checkboxes si estamos en modo selección
    if (modoSeleccion) {
        const checkboxes = tbody.querySelectorAll('.checkbox-ingrediente');
        checkboxes.forEach(checkbox => {
            checkbox.addEventListener('change', function() {
                const ingredienteId = this.dataset.ingrediente;
                const ingrediente = todosLosIngredientes.find(i => i.id.toString() === ingredienteId);
                
                if (this.checked) {
                    ingredientesSeleccionados.set(ingredienteId, ingrediente);
                } else {
                    ingredientesSeleccionados.delete(ingredienteId);
                }
            });
        });
    }
}

// Funciones de filtrado
function filtrarPorNombre(ingredientes, texto) {
    if (!texto) return ingredientes;
    const textoLower = texto.toLowerCase();
    return ingredientes.filter(ingrediente => 
        ingrediente.nombre.toLowerCase().includes(textoLower)
    );
}

function filtrarPorStock(ingredientes, condicion) {
    console.log('🔍 [DEBUG] filtrarPorStock - Iniciando filtrado');
    console.log('🔍 [DEBUG] Condición de filtro:', condicion);
    console.log('🔍 [DEBUG] Cantidad de ingredientes a filtrar:', ingredientes.length);
    
    // Umbral para considerar un valor como "prácticamente cero"
    const UMBRAL_CERO = 0.01;

    let resultado;
    switch (condicion) {
        case 'igual-cero':
            resultado = ingredientes.filter(ingrediente => {
                const stock = ingrediente.stock_actual || 0;
                const esIgualCero = Math.abs(stock) <= UMBRAL_CERO;
                if (esIgualCero) {
                    console.log(`📊 [DEBUG] Ingrediente con stock = 0: ${ingrediente.nombre} (${stock})`);
                }
                return esIgualCero;
            });
            break;
        case 'mayor-cero':
            resultado = ingredientes.filter(ingrediente => {
                const stock = ingrediente.stock_actual || 0;
                const esMayorCero = stock > UMBRAL_CERO;
                if (esMayorCero) {
                    console.log(`📊 [DEBUG] Ingrediente con stock > 0: ${ingrediente.nombre} (${stock})`);
                }
                return esMayorCero;
            });
            break;
        case 'menor-cero':
            resultado = ingredientes.filter(ingrediente => {
                const stock = ingrediente.stock_actual || 0;
                const esMenorCero = stock < -UMBRAL_CERO;
                if (esMenorCero) {
                    console.log(`📊 [DEBUG] Ingrediente con stock < 0: ${ingrediente.nombre} (${stock})`);
                }
                return esMenorCero;
            });
            break;
        default:
            resultado = ingredientes;
    }
    
    console.log('✅ [DEBUG] filtrarPorStock - Filtrado completado');
    console.log('✅ [DEBUG] Ingredientes después del filtro:', resultado.length);
    return resultado;
}

function aplicarFiltros() {
    console.log('🔍 [DEBUG] aplicarFiltros - Iniciando aplicación de filtros');
    
    const textoFiltro = document.getElementById('filtro-nombre')?.value || '';
    const stockFiltro = document.getElementById('filtro-stock')?.value || 'todos';
    
    console.log('🔍 [DEBUG] Filtros actuales:');
    console.log('- Texto:', textoFiltro);
    console.log('- Stock:', stockFiltro);
    console.log('- Total ingredientes antes de filtrar:', todosLosIngredientes.length);
    
    let ingredientesFiltrados = [...todosLosIngredientes];
    
    // Aplicar filtro de nombre
    if (textoFiltro) {
        console.log('📝 [DEBUG] Aplicando filtro por nombre:', textoFiltro);
        ingredientesFiltrados = filtrarPorNombre(ingredientesFiltrados, textoFiltro);
        console.log('📝 [DEBUG] Ingredientes después de filtrar por nombre:', ingredientesFiltrados.length);
    }
    
    // Aplicar filtro de stock
    if (stockFiltro !== 'todos') {
        console.log('📊 [DEBUG] Aplicando filtro por stock:', stockFiltro);
        ingredientesFiltrados = filtrarPorStock(ingredientesFiltrados, stockFiltro);
        console.log('📊 [DEBUG] Ingredientes después de filtrar por stock:', ingredientesFiltrados.length);
    }
    
    console.log('✅ [DEBUG] Filtrado completado');
    console.log('✅ [DEBUG] Total ingredientes después de filtrar:', ingredientesFiltrados.length);
    
    // Actualizar la tabla con los resultados filtrados
    actualizarTablaIngredientes(ingredientesFiltrados);
}

// ===== FUNCIONES DE CARGA DE DATOS =====

// Función para cargar los ingredientes
async function cargarIngredientes() {
    try {
        console.log('🔄 [CARGA] Cargando ingredientes...');
        const response = await fetch('/api/produccion/ingredientes');
        
        if (!response.ok) {
            const errorData = await response.json();
            throw new Error(errorData.error || 'Error al obtener los ingredientes');
        }

        const ingredientes = await response.json();
        console.log('✅ [CARGA] Ingredientes cargados:', ingredientes.length);
        
        // Almacenar todos los ingredientes globalmente
        todosLosIngredientes = ingredientes;
        
        // Mostrar los ingredientes en la tabla
        actualizarTablaIngredientes(ingredientes);

    } catch (error) {
        console.error('❌ [CARGA] Error al cargar ingredientes:', error);
        mostrarMensaje(error.message || 'No se pudieron cargar los ingredientes');
    }
}

async function cargarUsuarios() {
    try {
        console.log('🔄 [USUARIOS] Cargando usuarios...');
        
        const response = await fetch('/api/usuarios?rol=3&activo=true');
        if (!response.ok) throw new Error('Error al cargar usuarios');
        
        const usuarios = await response.json();
        const select = document.getElementById('select-usuario');
        if (select) {
            select.innerHTML = '<option value="">-- Seleccionar usuario --</option>';
            
            usuarios.forEach(usuario => {
                const option = document.createElement('option');
                option.value = usuario.id;
                option.textContent = usuario.nombre_completo;
                select.appendChild(option);
            });
        }
        
        console.log('✅ [USUARIOS] Usuarios cargados:', usuarios.length);
        
    } catch (error) {
        console.error('❌ [USUARIOS] Error al cargar usuarios:', error);
        mostrarMensaje('No se pudieron cargar los usuarios');
    }
}

async function cargarUsuariosAjustes() {
    try {
        console.log('🔄 [USUARIOS-AJUSTES] Cargando usuarios para ajustes...');
        
        const response = await fetch('/api/usuarios?rol=3&activo=true');
        if (!response.ok) throw new Error('Error al cargar usuarios');
        
        const usuarios = await response.json();
        const select = document.getElementById('select-usuario-ajustes');
        if (select) {
            select.innerHTML = '<option value="">-- Seleccionar usuario --</option>';
            
            usuarios.forEach(usuario => {
                const option = document.createElement('option');
                option.value = usuario.id;
                option.textContent = usuario.nombre_completo;
                select.appendChild(option);
            });
        }
        
        console.log('✅ [USUARIOS-AJUSTES] Usuarios cargados:', usuarios.length);
        
    } catch (error) {
        console.error('❌ [USUARIOS-AJUSTES] Error al cargar usuarios:', error);
        mostrarMensaje('No se pudieron cargar los usuarios');
    }
}

/**
 * Carga los sectores desde la API
 */
async function cargarSectores() {
    try {
        console.log('🔄 [SECTORES] ===== INICIANDO CARGA DE SECTORES =====');
        console.log('🔄 [SECTORES] Timestamp:', new Date().toISOString());
        console.log('🔄 [SECTORES] URL del endpoint:', '/api/produccion/sectores');
        console.log('🔄 [SECTORES] Realizando fetch...');
        
        const response = await fetch('/api/produccion/sectores');
        
        console.log('📡 [SECTORES] Respuesta recibida:');
        console.log('- Status:', response.status);
        console.log('- Status Text:', response.statusText);
        console.log('- OK:', response.ok);
        console.log('- Headers:', Object.fromEntries(response.headers.entries()));
        
        if (!response.ok) {
            console.error('❌ [SECTORES] Respuesta no exitosa del servidor');
            console.error('❌ [SECTORES] Status completo:', response.status, response.statusText);
            
            // Intentar leer el cuerpo del error
            let errorBody = 'No se pudo leer el cuerpo del error';
            try {
                errorBody = await response.text();
                console.error('❌ [SECTORES] Cuerpo del error:', errorBody);
            } catch (e) {
                console.error('❌ [SECTORES] Error al leer cuerpo del error:', e);
            }
            
            throw new Error(`Error HTTP ${response.status}: ${response.statusText} - ${errorBody}`);
        }
        
        console.log('✅ [SECTORES] Respuesta exitosa, parseando JSON...');
        const sectores = await response.json();
        
        console.log('🎉 [SECTORES] ===== SECTORES CARGADOS EXITOSAMENTE =====');
        console.log('📊 [SECTORES] Total de sectores recibidos:', sectores.length);
        console.log('📋 [SECTORES] Lista completa de sectores:');
        
        sectores.forEach((sector, index) => {
            console.log(`  ${index + 1}. ID: ${sector.id} | Nombre: "${sector.nombre}" | Descripción: "${sector.descripcion || 'Sin descripción'}"`);
        });
        
        // Almacenar sectores en variable global
        todosLosSectores = sectores;
        console.log('💾 [SECTORES] Sectores almacenados en variable global todosLosSectores');
        console.log('💾 [SECTORES] Verificación - todosLosSectores.length:', todosLosSectores.length);
        
        return sectores;
    } catch (error) {
        console.error('❌ [SECTORES] ===== ERROR AL CARGAR SECTORES =====');
        console.error('❌ [SECTORES] Tipo de error:', error.constructor.name);
        console.error('❌ [SECTORES] Mensaje de error:', error.message);
        console.error('❌ [SECTORES] Stack trace:', error.stack);
        
        // Información adicional para debugging
        console.error('🔍 [SECTORES] Información de debugging:');
        console.error('- URL intentada:', '/api/produccion/sectores');
        console.error('- Timestamp del error:', new Date().toISOString());
        console.error('- User Agent:', navigator.userAgent);
        console.error('- Location:', window.location.href);
        
        // Devolver array vacío en caso de error
        todosLosSectores = [];
        console.log('💾 [SECTORES] Variable global todosLosSectores reiniciada a array vacío');
        
        return [];
    }
}

// ===== FUNCIONES DE MODAL DE INVENTARIO =====

function mostrarModal() {
    console.log('🔄 [MODAL] Mostrando modal de inventario');
    
    const modal = document.getElementById('modal-inventario');
    if (modal) {
        modal.style.display = 'block';
        
        const pasoUsuario = document.getElementById('paso-usuario');
        const pasoConteo = document.getElementById('paso-conteo');
        
        if (pasoUsuario) pasoUsuario.style.display = 'block';
        if (pasoConteo) pasoConteo.style.display = 'none';
        
        cargarUsuarios();
    }
}

function cerrarModal() {
    console.log('🔄 [MODAL] Cerrando modal de inventario');
    
    const modal = document.getElementById('modal-inventario');
    if (modal) {
        modal.style.display = 'none';
    }
    reiniciarInventario();
}

function reiniciarInventario() {
    console.log('🧹 [INVENTARIO] Reiniciando inventario...');
    
    usuarioSeleccionado = null;
    ingredientesInventario.clear();
    
    const selectUsuario = document.getElementById('select-usuario');
    const inputCodigo = document.getElementById('input-codigo-barras');
    const contenedorIngredientes = document.getElementById('ingredientes-inventario');
    const btnContinuar = document.getElementById('btn-continuar-usuario');
    
    if (selectUsuario) selectUsuario.value = '';
    if (inputCodigo) inputCodigo.value = '';
    if (contenedorIngredientes) contenedorIngredientes.innerHTML = '';
    if (btnContinuar) btnContinuar.disabled = true;
    
    // Cerrar conexión WebSocket si existe
    if (socket) {
        console.log('🧹 [INVENTARIO] Cerrando conexión WebSocket');
        socket.emit('finalizar_inventario', { sessionId });
        socket.disconnect();
        socket = null;
    }
    sessionId = null;
    sessionStorage.removeItem('usuarioInventario');
    
    console.log('✅ [INVENTARIO] Inventario reiniciado completamente');
}

/**
 * Muestra el paso de selección de sectores
 */
async function mostrarPasoSectores() {
    console.log('🏢 [SECTORES] Mostrando paso de selección de sectores');
    
    // Ocultar paso de usuario y mostrar paso de sectores
    const pasoUsuario = document.getElementById('paso-usuario');
    const pasoSectores = document.getElementById('paso-sectores');
    
    if (pasoUsuario) pasoUsuario.style.display = 'none';
    if (pasoSectores) pasoSectores.style.display = 'block';
    
    try {
        // Cargar sectores desde backend
        console.log('🔄 [SECTORES] Cargando sectores desde API...');
        await cargarSectores();
        
        // Mostrar checkboxes de sectores
        console.log('🔄 [SECTORES] Llamando a mostrarCheckboxesSectores...');
        mostrarCheckboxesSectores();
        
        console.log('✅ [SECTORES] Paso de sectores mostrado correctamente');
    } catch (error) {
        console.error('❌ [SECTORES] Error al mostrar paso de sectores:', error);
        mostrarMensaje('Error al cargar sectores: ' + error.message, 'error');
    }
}

/**
 * Muestra los checkboxes de sectores en el contenedor correspondiente
 */
function mostrarCheckboxesSectores() {
    console.log('🔄 [SECTORES] mostrarCheckboxesSectores llamada');
    console.log(`📊 [SECTORES] Sectores disponibles para mostrar: ${todosLosSectores.length}`);
    
    const contenedor = document.getElementById('sectores-checkboxes');
    if (!contenedor) {
        console.error('❌ [SECTORES] No se encontró el contenedor #sectores-checkboxes');
        return;
    }
    
    // Limpiar contenedor
    contenedor.innerHTML = '';
    
    if (todosLosSectores.length === 0) {
        console.log('⚠️ [SECTORES] No hay sectores para mostrar');
        contenedor.innerHTML = '<p style="color: #666; font-style: italic;">No hay sectores disponibles</p>';
        return;
    }
    
    console.log('✅ [SECTORES] Renderizando sectores:', todosLosSectores.map(s => s.nombre));
    
    // Crear checkboxes para cada sector
    todosLosSectores.forEach(sector => {
        const checkboxDiv = document.createElement('div');
        checkboxDiv.className = 'sector-checkbox-item';
        checkboxDiv.style.cssText = 'margin-bottom: 8px; display: flex; align-items: center;';
        
        const checkbox = document.createElement('input');
        checkbox.type = 'checkbox';
        checkbox.id = `sector-${sector.id}`;
        checkbox.className = 'sector-checkbox';
        checkbox.setAttribute('data-sector-id', sector.id);
        checkbox.style.cssText = 'margin-right: 8px;';
        
        const label = document.createElement('label');
        label.htmlFor = `sector-${sector.id}`;
        label.textContent = sector.nombre;
        label.style.cssText = 'cursor: pointer; user-select: none;';
        
        // Agregar descripción si existe
        if (sector.descripcion && sector.descripcion.trim() !== '') {
            const descripcion = document.createElement('small');
            descripcion.textContent = ` (${sector.descripcion})`;
            descripcion.style.cssText = 'color: #666; margin-left: 4px;';
            label.appendChild(descripcion);
        }
        
        checkboxDiv.appendChild(checkbox);
        checkboxDiv.appendChild(label);
        contenedor.appendChild(checkboxDiv);
        
        console.log(`📋 [SECTORES] Checkbox creado: ${sector.nombre} (ID: ${sector.id})`);
    });
    
    // Agregar event listener para el checkbox "Todos los sectores"
    const checkboxTodos = document.getElementById('todos-sectores');
    if (checkboxTodos) {
        checkboxTodos.addEventListener('change', function() {
            const sectoresCheckboxes = document.querySelectorAll('.sector-checkbox');
            
            if (this.checked) {
                console.log('🔄 [SECTORES] "Todos los sectores" marcado - deshabilitando sectores individuales');
                // Deshabilitar y desmarcar todos los sectores individuales
                sectoresCheckboxes.forEach(checkbox => {
                    checkbox.disabled = true;
                    checkbox.checked = false;
                });
            } else {
                console.log('🔄 [SECTORES] "Todos los sectores" desmarcado - habilitando sectores individuales');
                // Habilitar todos los sectores individuales
                sectoresCheckboxes.forEach(checkbox => {
                    checkbox.disabled = false;
                });
            }
        });
        
        console.log('✅ [SECTORES] Event listener agregado para "Todos los sectores"');
    } else {
        console.warn('⚠️ [SECTORES] No se encontró el checkbox "Todos los sectores"');
    }
    
    console.log(`✅ [SECTORES] ${todosLosSectores.length} checkboxes de sectores renderizados correctamente`);
}

function mostrarPasoConteo() {
    console.log('🔄 [CONTEO] Mostrando paso de conteo');
    
    const pasoSectores = document.getElementById('paso-sectores');
    const pasoConteo = document.getElementById('paso-conteo');
    
    if (pasoSectores) pasoSectores.style.display = 'none';
    if (pasoConteo) pasoConteo.style.display = 'block';
    
    // PRIMERO: Guardar el usuario seleccionado en la sesión
    const selectUsuario = document.getElementById('select-usuario');
    if (selectUsuario && selectUsuario.selectedIndex > 0) {
        const usuarioNombre = selectUsuario.options[selectUsuario.selectedIndex].text;
        sessionStorage.setItem('usuarioInventario', JSON.stringify({
            id: usuarioSeleccionado,
            nombre: usuarioNombre
        }));
    }
    
    // MOSTRAR INFORMACIÓN DE SECTORES SELECCIONADOS
    mostrarInfoSectoresInventario();
    
    // DESPUÉS: Inicializar WebSocket para ingredientes
    inicializarWebSocketIngredientes();
    
    const inputCodigo = document.getElementById('input-codigo-barras');
    if (inputCodigo) {
        inputCodigo.focus();
    }
}

/**
 * Muestra la información de sectores seleccionados en el paso de conteo
 */
function mostrarInfoSectoresInventario() {
    console.log('🏢 [INFO-SECTORES] ===== MOSTRANDO INFORMACIÓN DE SECTORES =====');
    
    const sectoresInfo = sessionStorage.getItem('sectoresInventario');
    const sectoresTextoElement = document.getElementById('sectores-inventario-texto');
    
    if (!sectoresTextoElement) {
        console.error('❌ [INFO-SECTORES] No se encontró elemento sectores-inventario-texto');
        return;
    }
    
    console.log('🏢 [INFO-SECTORES] Sectores en sessionStorage:', sectoresInfo);
    
    if (sectoresInfo === 'TODOS') {
        console.log('🏢 [INFO-SECTORES] Mostrando: Todos los sectores');
        sectoresTextoElement.innerHTML = '📦 <strong>Todos los sectores</strong> - Inventario completo de ingredientes';
    } else {
        try {
            const sectoresSeleccionados = JSON.parse(sectoresInfo || '[]');
            console.log('🏢 [INFO-SECTORES] Sectores específicos:', sectoresSeleccionados);
            
            if (sectoresSeleccionados.length === 0) {
                console.log('🏢 [INFO-SECTORES] No hay sectores específicos seleccionados');
                sectoresTextoElement.innerHTML = '⚠️ <strong>Sin sectores específicos</strong> - Revise la configuración';
            } else {
                // Buscar nombres de sectores
                const nombresSectores = sectoresSeleccionados.map(sectorId => {
                    const sector = todosLosSectores.find(s => s.id === sectorId);
                    return sector ? sector.nombre : `Sector ${sectorId}`;
                });
                
                console.log('🏢 [INFO-SECTORES] Nombres de sectores:', nombresSectores);
                
                const textoSectores = nombresSectores.join(', ');
                sectoresTextoElement.innerHTML = `🏢 <strong>Sectores seleccionados:</strong> ${textoSectores}`;
            }
        } catch (e) {
            console.error('❌ [INFO-SECTORES] Error al parsear sectores:', e);
            sectoresTextoElement.innerHTML = '❌ <strong>Error</strong> - No se pudo cargar información de sectores';
        }
    }
    
    console.log('✅ [INFO-SECTORES] Información de sectores mostrada correctamente');
}

// ===== FUNCIONES DE WEBSOCKET =====

/**
 * Inicializa la conexión WebSocket para inventario de ingredientes
 */
function inicializarWebSocketIngredientes() {
    try {
        console.log('🚀 [WEBSOCKET] ===== INICIANDO WEBSOCKET PARA INVENTARIO DE INGREDIENTES =====');
        console.log('📅 [WEBSOCKET] Timestamp:', new Date().toISOString());
        
        // Verificar si io está disponible
        if (typeof io === 'undefined') {
            console.error('❌ [WEBSOCKET] Socket.IO no está disponible');
            mostrarMensaje('Error: Socket.IO no está cargado', 'error');
            return;
        }
        
        // Conectar a WebSocket con opciones de reconexión
        socket = io({
            reconnection: true,
            reconnectionAttempts: 5,
            reconnectionDelay: 1000
        });
        
        // Generar ID de sesión único con timestamp para debugging
        const timestamp = Date.now();
        const random = Math.random().toString(36).substr(2, 9);
        sessionId = `inv_ing_${timestamp}_${random}`;
        
        console.log('🆔 [WEBSOCKET] ===== GENERACIÓN DE SESSION ID =====');
        console.log('- Timestamp:', timestamp);
        console.log('- Random:', random);
        console.log('- Session ID completo:', sessionId);
        
        socket.on('connect', () => {
            console.log('✅ [WEBSOCKET] Conectado a WebSocket con socket ID:', socket.id);
            
            // Obtener información del usuario y sectores
            const usuarioInfo = JSON.parse(sessionStorage.getItem('usuarioInventario') || '{}');
            const sectoresInfo = sessionStorage.getItem('sectoresInventario');
            
            let sectores;
            if (sectoresInfo === 'TODOS') {
                sectores = 'TODOS';
            } else {
                try {
                    sectores = JSON.parse(sectoresInfo || '[]');
                } catch (e) {
                    console.error('❌ [WEBSOCKET] Error al parsear sectores:', e);
                    sectores = [];
                }
            }
            
            console.log('👤 [WEBSOCKET] Información del usuario para sesión:', usuarioInfo);
            console.log('🏢 [WEBSOCKET] Sectores seleccionados:', sectores);
            
            // Iniciar sesión de inventario de ingredientes
            const datosInicioSesion = { 
                sessionId,
                usuario: usuarioInfo,
                sectores: sectores
            };
            console.log('📤 [WEBSOCKET] Enviando iniciar_inventario (UNIFICADO) con datos:', datosInicioSesion);
            socket.emit('iniciar_inventario', datosInicioSesion);
        });
        
        socket.on('inventario_iniciado', (data) => {
            console.log('🎉 [WEBSOCKET] SESIÓN DE INVENTARIO INICIADA EXITOSAMENTE (UNIFICADO)');
            console.log('🎉 [WEBSOCKET] Datos recibidos del servidor:', data);
            console.log('🎉 [WEBSOCKET] Session ID confirmado:', data.sessionId);
            console.log('🎉 [WEBSOCKET] Sectores recibidos:', data.sectores);
            
            // Generar código QR con el ID de sesión
            generarCodigoQR(sessionId);
            
            mostrarMensaje('Sesión de inventario de ingredientes iniciada correctamente', 'info');
        });
        
        socket.on('movil_conectado', (data) => {
            console.log('📱 [WEBSOCKET] DISPOSITIVO MÓVIL CONECTADO');
            console.log('📱 [WEBSOCKET] Datos del móvil:', data);
            mostrarMensaje('Dispositivo móvil conectado', 'info');
        });
        
        socket.on('movil_desconectado', (data) => {
            console.log('📱 [WEBSOCKET] DISPOSITIVO MÓVIL DESCONECTADO');
            console.log('📱 [WEBSOCKET] Datos:', data);
            mostrarMensaje('Dispositivo móvil desconectado', 'info');
        });
        
        socket.on('nuevo_articulo', (data) => {
            console.log('🔥 [WEBSOCKET] ===== EVENTO nuevo_articulo RECIBIDO (UNIFICADO) =====');
            console.log('🔥 [WEBSOCKET] Datos completos recibidos:', JSON.stringify(data, null, 2));
            console.log('🔥 [WEBSOCKET] Session ID del evento:', data.sessionId);
            console.log('🔥 [WEBSOCKET] Session ID actual de PC:', sessionId);
            
            // Detectar si es ingrediente o artículo
            const ingrediente = data.ingrediente;
            const articulo = data.articulo;
            const item = ingrediente || articulo;
            const tipoItem = ingrediente ? 'ingrediente' : 'artículo';
            
            console.log('🔥 [WEBSOCKET] Estructura del item:', item);
            console.log('🔥 [WEBSOCKET] Tipo detectado:', tipoItem);
            console.log('🔥 [WEBSOCKET] Cantidad recibida:', data.cantidad);
            
            // Verificar que el sessionId coincida
            if (data.sessionId !== sessionId) {
                console.error('❌ [WEBSOCKET] ERROR: Session ID no coincide');
                console.error('❌ [WEBSOCKET] Esperado:', sessionId);
                console.error('❌ [WEBSOCKET] Recibido:', data.sessionId);
                mostrarMensaje('Error: Sesión no válida', 'error');
                return;
            }
            
            const cantidad = data.cantidad;
            
            if (!item) {
                console.error(`❌ [WEBSOCKET] ERROR: No se recibió información del ${tipoItem}`);
                mostrarMensaje(`Error: Datos del ${tipoItem} incompletos`, 'error');
                return;
            }
            
            // Solo procesar si es ingrediente (este archivo maneja ingredientes)
            if (!ingrediente) {
                console.log('ℹ️ [WEBSOCKET] Item recibido no es ingrediente, ignorando en este contexto');
                return;
            }
            
            console.log('🔍 [WEBSOCKET] Buscando ingrediente existente con ID:', ingrediente.id);
            
            // Si el ingrediente ya existe, actualizar cantidad
            const existingInput = document.querySelector(`input[data-ingrediente="${ingrediente.id}"]`);
            if (existingInput) {
                console.log('✅ [WEBSOCKET] Ingrediente existente encontrado, actualizando cantidad');
                console.log('✅ [WEBSOCKET] Input encontrado:', existingInput);
                existingInput.value = cantidad;
                mostrarMensaje(`Cantidad actualizada para ${ingrediente.nombre}: ${cantidad}`, 'info');
            } else {
                console.log('➕ [WEBSOCKET] Ingrediente nuevo, agregando al inventario');
                console.log('➕ [WEBSOCKET] Llamando a agregarIngredienteAInventario...');
                // Agregar nuevo ingrediente
                agregarIngredienteAInventario(ingrediente, cantidad);
                mostrarMensaje(`Ingrediente agregado desde móvil: ${ingrediente.nombre}`, 'info');
            }
            
            console.log('🔥 [WEBSOCKET] ===== FIN PROCESAMIENTO nuevo_articulo (INGREDIENTE) =====');
        });
        
        socket.on('disconnect', () => {
            console.log('❌ [WEBSOCKET] Desconectado de WebSocket');
            console.log('❌ [WEBSOCKET] Session ID era:', sessionId);
        });
        
        // Agregar listener para errores generales
        socket.on('error', (error) => {
            console.error('❌ [WEBSOCKET] Error en WebSocket:', error);
        });
        
        // Agregar listener para eventos no manejados
        socket.onAny((eventName, ...args) => {
            if (!['connect', 'inventario_ingredientes_iniciado', 'movil_conectado', 'movil_desconectado', 'nuevo_ingrediente', 'disconnect'].includes(eventName)) {
                console.log('🔔 [WEBSOCKET] Evento WebSocket no manejado:', eventName, args);
            }
        });
        
    } catch (error) {
        console.error('❌ [WEBSOCKET] Error al inicializar WebSocket:', error);
        mostrarMensaje('Error al conectar con el servidor', 'error');
    }
}

/**
 * Espera a que la librería QRCode esté disponible
 */
function esperarLibreriaQR() {
    return new Promise((resolve) => {
        console.log('⏳ [QR] Verificando disponibilidad de librería QRCode...');
        
        if (typeof QRCode !== 'undefined') {
            console.log('✅ [QR] Librería QRCode ya está disponible');
            resolve();
        } else {
            console.log('🔄 [QR] Librería QRCode no disponible, esperando...');
            let intentos = 0;
            const maxIntentos = 50; // 5 segundos máximo (50 * 100ms)
            
            const interval = setInterval(() => {
                intentos++;
                console.log(`🔄 [QR] Intento ${intentos}/${maxIntentos} - Verificando QRCode...`);
                
                if (typeof QRCode !== 'undefined') {
                    console.log('✅ [QR] Librería QRCode cargada exitosamente');
                    clearInterval(interval);
                    resolve();
                } else if (intentos >= maxIntentos) {
                    console.error('❌ [QR] Timeout: Librería QRCode no se cargó después de 5 segundos');
                    clearInterval(interval);
                    resolve(); // Resolver de todos modos para continuar con el flujo
                }
            }, 100); // Verificar cada 100ms
        }
    });
}

/**
 * Genera el código QR para acceso móvil al inventario
 */
async function generarCodigoQR() {
    try {
        console.log('🔗 [QR] ===== GENERANDO CÓDIGO QR =====');
        console.log('🔗 [QR] Timestamp:', new Date().toISOString());
        console.log('🔗 [QR] Session ID actual:', sessionId);
        console.log('🔗 [QR] Tipo de sessionId:', typeof sessionId);
        console.log('🔗 [QR] Longitud sessionId:', sessionId?.length);
        
        // ESPERAR A QUE LA LIBRERÍA QR ESTÉ DISPONIBLE
        await esperarLibreriaQR();
        
        // Validar sessionId antes de generar QR
        if (!sessionId) {
            console.error('❌ [QR] ERROR: sessionId es null/undefined');
            mostrarMensaje('Error: No hay ID de sesión válido', 'error');
            return;
        }
        
        if (!sessionId.startsWith('inv_ing_')) {
            console.error('❌ [QR] ERROR: sessionId no tiene formato válido:', sessionId);
            mostrarMensaje('Error: Formato de sesión inválido', 'error');
            return;
        }
        
        // Usar la URL de Cloudflare para acceso externo
        const baseUrl = 'https://inventario.lamdaser.com';
        // Mantener la ruta original a /pages/inventario-movil.html (reutilizar la misma página móvil)
        const urlMovil = `${baseUrl}/pages/inventario-movil.html?session=${encodeURIComponent(sessionId)}`;
        
        console.log('🔗 [QR] URL base (Cloudflare):', baseUrl);
        console.log('🔗 [QR] URL generada para el QR:', urlMovil);
        console.log('🔗 [QR] Session ID en URL:', sessionId);
        console.log('🔗 [QR] Verificando formato URL...');
        
        // Verificar que la URL se construyó correctamente
        try {
            const testUrl = new URL(urlMovil);
            const testSessionId = testUrl.searchParams.get('session');
            console.log('🔗 [QR] URL parseada correctamente');
            console.log('🔗 [QR] Session ID extraído de URL de prueba:', testSessionId);
            
            if (testSessionId !== sessionId) {
                console.error('❌ [QR] ERROR: Session ID no coincide en URL');
                console.error('❌ [QR] Original:', sessionId);
                console.error('❌ [QR] Extraído:', testSessionId);
                mostrarMensaje('Error: Problema al generar URL', 'error');
                return;
            }
        } catch (urlError) {
            console.error('❌ [QR] ERROR: URL malformada:', urlError);
            mostrarMensaje('Error: URL inválida generada', 'error');
            return;
        }
        
        // Mostrar la URL en texto para debugging
        const urlMovilElement = document.getElementById('url-movil');
        if (urlMovilElement) {
            urlMovilElement.textContent = urlMovil;
        }
        
        // Verificar si la librería QRCode está disponible (después de esperar)
        if (typeof QRCode === 'undefined') {
            console.error('❌ [QR] La librería QRCode no está cargada después de esperar');
            mostrarMensaje('Error: Librería QR no disponible después de esperar', 'error');
            return;
        }
        
        // Verificar si el contenedor existe
        const qrContainer = document.getElementById('qr-canvas');
        if (!qrContainer) {
            console.error('❌ [QR] Contenedor qr-canvas no encontrado');
            mostrarMensaje('Error: Contenedor QR no encontrado', 'error');
            return;
        }
        
        // Limpiar contenido anterior
        qrContainer.innerHTML = '';
        
        console.log('🔗 [QR] Contenedor encontrado:', qrContainer);
        console.log('🔗 [QR] QRCode disponible:', typeof QRCode);
        
        // Generar el código QR usando la API de qrcodejs
        const qrcode = new QRCode(qrContainer, {
            text: urlMovil,
            width: 200,
            height: 200,
            colorDark: '#000000',
            colorLight: '#FFFFFF',
            correctLevel: QRCode.CorrectLevel.M
        });
        
        console.log('✅ [QR] Código QR generado correctamente');
        
    } catch (error) {
        console.error('❌ [QR] Error en generarCodigoQR:', error);
        mostrarMensaje('Error al generar código QR: ' + error.message, 'error');
    }
}

// ===== FUNCIONES DE INVENTARIO =====

async function buscarIngredientePorCodigo(codigoBarras) {
    try {
        console.log('🔍 [BUSQUEDA] Buscando ingrediente por código:', codigoBarras);
        
        const response = await fetch(`/api/produccion/ingredientes/buscar?codigo=${codigoBarras}`);
        if (!response.ok) throw new Error('Ingrediente no encontrado');
        
        const ingrediente = await response.json();
        console.log('✅ [BUSQUEDA] Ingrediente encontrado:', ingrediente.nombre);
        
        return ingrediente;
    } catch (error) {
        console.error('❌ [BUSQUEDA] Error al buscar ingrediente:', error);
        mostrarMensaje('Ingrediente no encontrado');
        return null;
    }
}

function agregarIngredienteAInventario(ingrediente, cantidadInicial = 0) {
    console.log('🚀 [INVENTARIO] EJECUTANDO agregarIngredienteAInventario');
    console.log('🚀 [INVENTARIO] Ingrediente recibido:', ingrediente);
    console.log('🚀 [INVENTARIO] Cantidad inicial:', cantidadInicial);
    console.log('🚀 [INVENTARIO] Ingredientes en inventario actual:', ingredientesInventario.size);
    
    // ===== VALIDACIÓN DE SECTORES =====
    console.log('🔒 [VALIDACIÓN] ===== INICIANDO VALIDACIÓN DE SECTORES =====');
    
    // Obtener sectores seleccionados del sessionStorage
    const sectoresInfo = sessionStorage.getItem('sectoresInventario');
    console.log('🔒 [VALIDACIÓN] Sectores en sessionStorage:', sectoresInfo);
    
    if (sectoresInfo !== 'TODOS') {
        console.log('🔒 [VALIDACIÓN] No es "TODOS" - validando sectores específicos');
        
        let sectoresSeleccionados;
        try {
            sectoresSeleccionados = JSON.parse(sectoresInfo || '[]');
            console.log('🔒 [VALIDACIÓN] Sectores seleccionados parseados:', sectoresSeleccionados);
        } catch (e) {
            console.error('❌ [VALIDACIÓN] Error al parsear sectores:', e);
            sectoresSeleccionados = [];
        }
        
        // Verificar si el ingrediente tiene sector asignado
        const ingredienteSectorId = ingrediente.sector_id;
        console.log('🔒 [VALIDACIÓN] Sector del ingrediente:', ingredienteSectorId);
        console.log('🔒 [VALIDACIÓN] Tipo de sector del ingrediente:', typeof ingredienteSectorId);
        
        // Si hay sectores específicos seleccionados, validar
        if (sectoresSeleccionados.length > 0) {
            console.log('🔒 [VALIDACIÓN] Hay sectores específicos seleccionados, validando...');
            
            // Verificar si el ingrediente pertenece a alguno de los sectores seleccionados
            const perteneceASectorSeleccionado = ingredienteSectorId && 
                sectoresSeleccionados.includes(parseInt(ingredienteSectorId));
            
            console.log('🔒 [VALIDACIÓN] ¿Pertenece a sector seleccionado?:', perteneceASectorSeleccionado);
            console.log('🔒 [VALIDACIÓN] Sectores seleccionados incluyen', ingredienteSectorId, '?:', 
                sectoresSeleccionados.includes(parseInt(ingredienteSectorId)));
            
            if (!perteneceASectorSeleccionado) {
                console.log('❌ [VALIDACIÓN] INGREDIENTE RECHAZADO - No pertenece al sector seleccionado');
                
                // Buscar el nombre del sector del ingrediente para el mensaje
                let nombreSectorIngrediente = 'Sin sector asignado';
                if (ingredienteSectorId) {
                    const sectorIngrediente = todosLosSectores.find(s => s.id === parseInt(ingredienteSectorId));
                    if (sectorIngrediente) {
                        nombreSectorIngrediente = sectorIngrediente.nombre;
                    }
                }
                
                // Buscar nombres de sectores seleccionados para el mensaje
                const nombresSectoresSeleccionados = sectoresSeleccionados.map(sectorId => {
                    const sector = todosLosSectores.find(s => s.id === sectorId);
                    return sector ? sector.nombre : `Sector ${sectorId}`;
                }).join(', ');
                
                console.log('🔒 [VALIDACIÓN] Sector del ingrediente:', nombreSectorIngrediente);
                console.log('🔒 [VALIDACIÓN] Sectores permitidos:', nombresSectoresSeleccionados);
                
                // Mostrar mensaje de advertencia VISIBLE al usuario
                const mensajeCorto = `⚠️ Este ingrediente no pertenece al sector seleccionado y no puede ser inventariado.`;
                const mensajeDetallado = `INGREDIENTE RECHAZADO:\n\n` +
                    `• Ingrediente: ${ingrediente.nombre}\n` +
                    `• Sector del ingrediente: ${nombreSectorIngrediente}\n` +
                    `• Sectores permitidos: ${nombresSectoresSeleccionados}\n\n` +
                    `Este ingrediente no puede ser agregado al inventario.`;
                
                // Mostrar mensaje en el modal (más visible)
                mostrarMensaje(mensajeCorto, 'error');
                
                // TAMBIÉN mostrar alert para máxima visibilidad
                alert(mensajeDetallado);
                
                console.log('❌ [VALIDACIÓN] Ingrediente rechazado - función terminada');
                console.log('❌ [VALIDACIÓN] Mensaje mostrado al usuario:', mensajeDetallado);
                return; // ← SALIR SIN AGREGAR EL INGREDIENTE
            }
        }
    }
    
    console.log('✅ [VALIDACIÓN] Ingrediente aprobado - continuando con agregado');
    console.log('🔒 [VALIDACIÓN] ===== FIN VALIDACIÓN DE SECTORES =====');
    
    // ===== LÓGICA ORIGINAL (solo si pasa la validación) =====
    
    if (ingredientesInventario.has(ingrediente.id.toString())) {
        console.log('⚠️ [INVENTARIO] Ingrediente ya existe en inventario');
        // Si el ingrediente ya existe, actualizar la cantidad si viene del móvil
        if (cantidadInicial > 0) {
            const input = document.querySelector(`input[data-ingrediente="${ingrediente.id}"]`);
            if (input) {
                input.value = cantidadInicial;
                mostrarMensaje(`Cantidad actualizada para ${ingrediente.nombre}: ${cantidadInicial}`, 'info');
                console.log('✅ [INVENTARIO] Cantidad actualizada en input existente');
            } else {
                console.error('❌ [INVENTARIO] No se encontró el input para actualizar');
            }
        } else {
            mostrarMensaje('Este ingrediente ya fue agregado al inventario', 'info');
        }
        return;
    }

    console.log('➕ [INVENTARIO] Creando nuevo elemento para el ingrediente');
    const div = document.createElement('div');
    div.className = 'inventario-item';
    div.innerHTML = `
        <h4>${ingrediente.nombre}</h4>
        <div class="info-row">
            <span>ID: ${ingrediente.id}</span>
            <span>Código: ${ingrediente.codigo || '-'}</span>
            <span>Stock Actual: ${formatearNumero(ingrediente.stock_actual || 0)} ${ingrediente.unidad_medida || 'kg'}</span>
        </div>
        <div class="stock-input">
            <label>Stock Físico (${ingrediente.unidad_medida || 'kg'}):</label>
            <input type="number" min="0" step="0.01" class="stock-fisico" 
                   data-ingrediente="${ingrediente.id}" value="${cantidadInicial}">
        </div>
    `;

    console.log('🔍 [INVENTARIO] Buscando contenedor ingredientes-inventario');
    // Insertar al principio del contenedor para que aparezca arriba
    const contenedor = document.getElementById('ingredientes-inventario');
    if (!contenedor) {
        console.error('❌ [INVENTARIO] ERROR CRÍTICO: No se encontró el contenedor ingredientes-inventario');
        mostrarMensaje('Error: No se pudo agregar el ingrediente al formulario', 'error');
        return;
    }
    
    console.log('✅ [INVENTARIO] Contenedor encontrado, insertando elemento');
    contenedor.insertBefore(div, contenedor.firstChild);
    ingredientesInventario.set(ingrediente.id.toString(), ingrediente);
    
    console.log('✅ [INVENTARIO] Ingrediente agregado al Map. Total ingredientes:', ingredientesInventario.size);
    
    // Mostrar el botón "Mostrar Diferencias" si hay ingredientes
    const btnMostrarDiferencias = document.getElementById('btn-mostrar-diferencias');
    if (btnMostrarDiferencias && ingredientesInventario.size > 0) {
        btnMostrarDiferencias.style.display = 'inline-block';
    }
    
    // Si viene del móvil, mostrar mensaje
    if (cantidadInicial > 0) {
        mostrarMensaje(`Ingrediente agregado desde móvil: ${ingrediente.nombre}`, 'info');
        console.log('✅ [INVENTARIO] Mensaje de confirmación mostrado');
    }
    
    console.log('🎉 [INVENTARIO] agregarIngredienteAInventario completado exitosamente');
}

// ===== EVENT LISTENERS =====

document.addEventListener('DOMContentLoaded', () => {
    console.log('📱 [INIT] Página de gestión de ingredientes cargada');
    cargarIngredientes();

    // Botón para iniciar inventario
    const btnIniciarInventario = document.getElementById('btn-iniciar-inventario');
    if (btnIniciarInventario) {
        btnIniciarInventario.addEventListener('click', mostrarModal);
    }

    // Cerrar modales
    const closeModal = document.getElementById('close-modal');
    if (closeModal) {
        closeModal.addEventListener('click', cerrarModal);
    }

    // Selects de usuario
    const selectUsuario = document.getElementById('select-usuario');
    
    function actualizarSeleccionUsuario() {
        const valor = selectUsuario?.value || '';
        usuarioSeleccionado = valor;
        const btnContinuar = document.getElementById('btn-continuar-usuario');
        if (btnContinuar) {
            btnContinuar.disabled = !valor;
        }
    }
    
    // Eventos del select de inventario
    if (selectUsuario) {
        selectUsuario.addEventListener('change', actualizarSeleccionUsuario);
        selectUsuario.addEventListener('input', actualizarSeleccionUsuario);
        selectUsuario.addEventListener('keydown', (e) => setTimeout(actualizarSeleccionUsuario, 10));
    }

    // Botones continuar
    const btnContinuarUsuario = document.getElementById('btn-continuar-usuario');
    if (btnContinuarUsuario) {
        btnContinuarUsuario.addEventListener('click', () => {
            if (usuarioSeleccionado) {
                mostrarPasoSectores();
            } else {
                mostrarMensaje('Por favor selecciona un usuario', 'error');
            }
        });
    }

    // Botones del paso de sectores
    const btnVolverUsuario = document.getElementById('btn-volver-usuario');
    if (btnVolverUsuario) {
        btnVolverUsuario.addEventListener('click', () => {
            const pasoSectores = document.getElementById('paso-sectores');
            const pasoUsuario = document.getElementById('paso-usuario');
            if (pasoSectores) pasoSectores.style.display = 'none';
            if (pasoUsuario) pasoUsuario.style.display = 'block';
        });
    }

    const btnContinuarSectores = document.getElementById('btn-continuar-sectores');
    if (btnContinuarSectores) {
        btnContinuarSectores.addEventListener('click', () => {
            console.log('🏢 [SECTORES] Botón continuar sectores presionado');
            
            // Verificar si "Todos los sectores" está marcado
            const checkboxTodos = document.getElementById('todos-sectores');
            
            if (checkboxTodos && checkboxTodos.checked) {
                console.log('🏢 [SECTORES] "Todos los sectores" seleccionado');
                sessionStorage.setItem('sectoresInventario', 'TODOS');
                console.log('✅ [SECTORES] Guardado en sessionStorage: TODOS');
            } else {
                // Obtener sectores individuales seleccionados
                const sectoresCheckboxes = document.querySelectorAll('.sector-checkbox:checked');
                const sectoresSeleccionados = [];
                
                sectoresCheckboxes.forEach(checkbox => {
                    const sectorId = checkbox.getAttribute('data-sector-id');
                    if (sectorId) {
                        sectoresSeleccionados.push(parseInt(sectorId));
                        console.log(`📋 [SECTORES] Sector seleccionado: ID ${sectorId}`);
                    }
                });
                
                console.log('🏢 [SECTORES] Sectores individuales seleccionados:', sectoresSeleccionados);
                sessionStorage.setItem('sectoresInventario', JSON.stringify(sectoresSeleccionados));
                console.log('✅ [SECTORES] Guardado en sessionStorage:', JSON.stringify(sectoresSeleccionados));
            }
            
            // Continuar al paso de conteo
            mostrarPasoConteo();
        });
    }

    // Input de código de barras
    const inputCodigoBarras = document.getElementById('input-codigo-barras');
    if (inputCodigoBarras) {
        inputCodigoBarras.addEventListener('keypress', async (e) => {
            if (e.key === 'Enter') {
                const codigo = e.target.value.trim();
                if (!codigo) return;

                const ingrediente = await buscarIngredientePorCodigo(codigo);
                if (ingrediente) {
                    agregarIngredienteAInventario(ingrediente);
                    e.target.value = '';
                }
            }
        });
    }

    // Filtros
    const filtroNombre = document.getElementById('filtro-nombre');
    const filtroStock = document.getElementById('filtro-stock');
    
    if (filtroNombre) {
        filtroNombre.addEventListener('input', aplicarFiltros);
    }
    if (filtroStock) {
        filtroStock.addEventListener('change', aplicarFiltros);
    }

    // Botón finalizar inventario
    const btnFinalizarInventario = document.getElementById('btn-finalizar-inventario');
    if (btnFinalizarInventario) {
        btnFinalizarInventario.addEventListener('click', async () => {
            await finalizarInventarioManual();
        });
    }
});

// ===== FUNCIÓN PARA FINALIZAR INVENTARIO MANUAL =====

/**
 * Finaliza el inventario manual aplicando los ajustes de stock
 */
async function finalizarInventarioManual() {
    try {
        console.log('🏁 [FINALIZAR] ===== INICIANDO FINALIZACIÓN DE INVENTARIO MANUAL =====');
        console.log('🏁 [FINALIZAR] Session ID:', sessionId);
        console.log('🏁 [FINALIZAR] Ingredientes en inventario:', ingredientesInventario.size);
        
        // Validar que hay una sesión activa
        if (!sessionId) {
            console.error('❌ [FINALIZAR] ERROR: No hay sesión activa');
            mostrarMensaje('Error: No hay una sesión de inventario activa', 'error');
            return;
        }
        
        // Obtener información del usuario
        const usuarioInfo = JSON.parse(sessionStorage.getItem('usuarioInventario') || '{}');
        if (!usuarioInfo.id) {
            console.error('❌ [FINALIZAR] ERROR: No hay información de usuario');
            mostrarMensaje('Error: No hay información de usuario válida', 'error');
            return;
        }
        
        // Recopilar ingredientes contados desde el DOM con información completa
        const ingredientesContados = [];
        const inputs = document.querySelectorAll('.stock-fisico');
        
        console.log('🔍 [FINALIZAR] Inputs de stock físico encontrados:', inputs.length);
        
        inputs.forEach((input, index) => {
            const ingredienteId = input.dataset.ingrediente;
            const stockContado = parseFloat(input.value) || 0;
            
            console.log(`📊 [FINALIZAR] Input ${index + 1}: ID=${ingredienteId}, Stock=${stockContado}`);
            
            if (ingredienteId && stockContado >= 0) {
                // Buscar información completa del ingrediente
                const ingredienteInfo = ingredientesInventario.get(ingredienteId);
                if (ingredienteInfo) {
                    ingredientesContados.push({
                        ingrediente_id: parseInt(ingredienteId),
                        nombre: ingredienteInfo.nombre,
                        stock_actual: parseFloat(ingredienteInfo.stock_actual) || 0,
                        stock_contado: stockContado
                    });
                }
            }
        });
        
        console.log('📋 [FINALIZAR] Ingredientes contados para enviar:', ingredientesContados);
        console.log('📋 [FINALIZAR] Total ingredientes a procesar:', ingredientesContados.length);
        
        if (ingredientesContados.length === 0) {
            console.warn('⚠️ [FINALIZAR] No hay ingredientes contados');
            mostrarMensaje('No hay ingredientes contados para procesar', 'error');
            return;
        }
        
        // Mostrar mensaje de procesamiento
        mostrarMensaje('Procesando inventario...', 'info');
        
        // Aplicar ajustes via API con el formato correcto
        console.log('📤 [FINALIZAR] Enviando request a API...');
        console.log('📤 [FINALIZAR] URL:', `/api/produccion/inventario-ingredientes/${sessionId}/aplicar`);
        
        const response = await fetch(`/api/produccion/inventario-ingredientes/${sessionId}/aplicar`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                ingredientes_contados: ingredientesContados,
                usuario_id: usuarioInfo.id
            })
        });
        
        console.log('📡 [FINALIZAR] Respuesta recibida:');
        console.log('- Status:', response.status);
        console.log('- Status Text:', response.statusText);
        console.log('- OK:', response.ok);
        
        if (!response.ok) {
            const errorData = await response.json().catch(() => ({ error: 'Error desconocido' }));
            console.error('❌ [FINALIZAR] Error en respuesta:', errorData);
            throw new Error(errorData.error || `Error HTTP ${response.status}`);
        }
        
        const resultado = await response.json();
        console.log('✅ [FINALIZAR] Resultado exitoso:', resultado);
        
        // Mostrar mensaje de éxito
        mostrarMensaje('Inventario finalizado correctamente. Los ajustes han sido aplicados.', 'info');
        
        // Cerrar modal después de un breve delay
        setTimeout(() => {
            cerrarModal();
            // Recargar la tabla de ingredientes para mostrar los nuevos stocks
            cargarIngredientes();
        }, 2000);
        
        console.log('🎉 [FINALIZAR] ===== INVENTARIO FINALIZADO EXITOSAMENTE =====');
        
    } catch (error) {
        console.error('❌ [FINALIZAR] Error al finalizar inventario:', error);
        console.error('❌ [FINALIZAR] Stack trace:', error.stack);
        mostrarMensaje('Error al finalizar inventario: ' + error.message, 'error');
    }
}
