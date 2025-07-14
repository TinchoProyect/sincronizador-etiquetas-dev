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
    console.log('🔄 [DEBUG] actualizarTablaArticulos - Iniciando actualización de tabla');
    console.log('🔄 [DEBUG] Cantidad de artículos recibidos:', articulos?.length || 0);
    
    const tbody = document.getElementById('tabla-articulos-body');
    if (!tbody) return;

    tbody.innerHTML = '';

    if (!articulos || articulos.length === 0) {
        const colspan = modoSeleccion ? 6 : 5;
        tbody.innerHTML = `<tr><td colspan="${colspan}" class="mensaje-info">No hay artículos registrados</td></tr>`;
        return;
    }

    articulos.forEach((articulo, index) => {
        const stockConsolidado = articulo.stock_consolidado || 0;
        console.log(`📊 [DEBUG] Artículo ${index + 1}: ${articulo.nombre} - Stock Consolidado: ${stockConsolidado}`);
        
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
            <td class="produccion-cell">
                <label class="switch">
                    <input type="checkbox" ${!articulo.no_producido_por_lambda ? 'checked' : ''} 
                           onchange="toggleProduccion('${articulo.numero}', this.checked)">
                    <span class="slider round"></span>
                </label>
            </td>
        `;
        tbody.appendChild(tr);
    });
    
    console.log('✅ [DEBUG] actualizarTablaArticulos - Tabla actualizada correctamente');

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
}

// Funciones de filtrado
function filtrarPorNombre(articulos, texto) {
    if (!texto) return articulos;
    const textoLower = texto.toLowerCase();
    return articulos.filter(articulo => 
        articulo.nombre.toLowerCase().includes(textoLower)
    );
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

function aplicarFiltros() {
    console.log('🔍 [DEBUG] aplicarFiltros - Iniciando aplicación de filtros');
    
    const textoFiltro = document.getElementById('filtro-nombre').value;
    const stockFiltro = document.getElementById('filtro-stock').value;
    const filtroProduccion = document.querySelector('input[name="filtroProduccion"]:checked').value;
    
    console.log('🔍 [DEBUG] Filtros actuales:');
    console.log('- Texto:', textoFiltro);
    console.log('- Stock:', stockFiltro);
    console.log('- Filtro producción:', filtroProduccion);
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
    
    console.log('✅ [DEBUG] Filtrado completado');
    console.log('✅ [DEBUG] Total artículos después de filtrar:', articulosFiltrados.length);
    
    // Actualizar la tabla con los resultados filtrados
    actualizarTablaArticulos(articulosFiltrados);
}

// Función para cargar los artículos
async function cargarArticulos() {
    try {
        console.log('Cargando artículos...');
        const response = await fetch('/api/produccion/articulos');
        
        if (!response.ok) {
            const errorData = await response.json();
            throw new Error(errorData.error || 'Error al obtener los artículos');
        }

        const articulos = await response.json();
        console.log('Artículos cargados:', articulos.length);
        
        // Almacenar todos los artículos globalmente
        todosLosArticulos = articulos;
        
        // Mostrar los artículos en la tabla
        actualizarTablaArticulos(articulos);

    } catch (error) {
        console.error('Error al cargar artículos:', error);
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
                <input type="number" min="0" step="1" class="stock-fisico" 
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

    const ajustes = [];
    const inputs = document.querySelectorAll('.stock-fisico');
    
    inputs.forEach(input => {
        const articuloNumero = input.dataset.articulo;
        const articulo = articulosInventario.get(articuloNumero);
        const stockFisico = parseInt(input.value) || 0;
        const ajuste = stockFisico - (articulo.stock_ventas || 0);
        
        if (ajuste !== 0) {
            ajustes.push({
                articulo_numero: articuloNumero,
                codigo_barras: articulo.codigo_barras,
                usuario_id: usuarioSeleccionado,
                tipo: 'registro de ajuste',
                kilos: ajuste,
                cantidad: ajuste // Usar cantidad para el ajuste real en unidades
            });
        }
    });

    if (ajustes.length === 0) {
        mostrarMensaje('No hay ajustes para registrar', 'info');
        cerrarModal();
        return;
    }

    try {
        const response = await fetch('/api/produccion/stock-ventas-movimientos/batch', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({ ajustes })
        });

        if (!response.ok) throw new Error('Error al registrar los ajustes');

        mostrarMensaje('Inventario registrado correctamente', 'info');
        cerrarModal();
        cargarArticulos(); // Recargar la tabla de artículos
    } catch (error) {
        console.error('Error al finalizar inventario:', error);
        mostrarMensaje('Error al registrar el inventario');
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
                       step="1" 
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
    if (articulosSeleccionados.size === 0) {
        mostrarMensaje('No hay artículos seleccionados para ajustar', 'error');
        return;
    }

    // Usar el mismo formato de ajustes que el inventario
    const ajustes = [];
    const inputs = document.querySelectorAll('.stock-nuevo');
    let hayAjustes = false;
    
    inputs.forEach(input => {
        const articuloNumero = input.dataset.articulo;
        const articulo = articulosSeleccionados.get(articuloNumero);
        const stockNuevo = parseInt(input.value) || 0;
        const stockActual = articulo.stock_consolidado || 0;
        const ajuste = stockNuevo - stockActual;
        
        // Solo registrar si hay diferencia, igual que en inventario
        if (ajuste !== 0) {
            hayAjustes = true;
            ajustes.push({
                articulo_numero: articuloNumero,
                codigo_barras: articulo.codigo_barras,
                usuario_id: usuarioAjustes,
                tipo: 'registro de ajuste', // Usar el mismo tipo que inventario
                kilos: ajuste,
                cantidad: ajuste // Mantener consistencia con inventario
            });
        }
    });

    if (!hayAjustes) {
        mostrarMensaje('No hay ajustes para registrar', 'info');
        cerrarModalAjustes();
        return;
    }

    try {
        // Usar el mismo endpoint y estructura que inventario
        const response = await fetch('/api/produccion/stock-ventas-movimientos/batch', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({ ajustes })
        });

        if (!response.ok) {
            const errorData = await response.json();
            throw new Error(errorData.error || 'Error al registrar los ajustes');
        }

        mostrarMensaje('Ajustes registrados correctamente', 'info');
        cerrarModalAjustes();
        await cargarArticulos(); // Recargar artículos después de ajustes
    } catch (error) {
        console.error('Error al finalizar ajustes:', error);
        mostrarMensaje(error.message || 'Error al registrar los ajustes');
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
    
    filtroNombre.addEventListener('input', aplicarFiltros);
    filtroStock.addEventListener('change', aplicarFiltros);
    filtrosProduccion.forEach(radio => {
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
