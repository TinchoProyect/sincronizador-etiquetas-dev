/**
 * Inventario Móvil - JavaScript
 * 
 * Este archivo maneja la lógica de la vista móvil para inventario.
 * Se conecta con el formulario de inventario de la PC mediante WebSocket.
 * NO modifica directamente el stock, solo envía datos al formulario de PC.
 */

// Declaraciones de tipos para evitar errores de TypeScript/ESLint
/* global io, Html5Qrcode */

// Variables globales para el inventario móvil
let socket = null;
let sessionId = null;
let articuloActual = null;
let html5QrcodeScanner = null;
let conectado = false;

/**
 * Inicializa la aplicación móvil
 */
document.addEventListener('DOMContentLoaded', () => {
    console.log('📱 [MÓVIL] ===== INICIANDO APLICACIÓN MÓVIL =====');
    console.log('📱 [MÓVIL] Timestamp:', new Date().toISOString());
    console.log('📱 [MÓVIL] User Agent:', navigator.userAgent);
    
    // Obtener y validar sessionId de la URL
    const urlParams = new URLSearchParams(window.location.search);
    sessionId = urlParams.get('session');
    
    console.log('🔍 [MÓVIL] URL completa:', window.location.href);
    console.log('🔍 [MÓVIL] Search params:', window.location.search);
    console.log('🔍 [MÓVIL] Hash:', window.location.hash);
    console.log('🔍 [MÓVIL] Pathname:', window.location.pathname);
    console.log('🔍 [MÓVIL] Session ID extraído:', sessionId);
    
    // Validación detallada del sessionId
    if (!sessionId) {
        console.error('❌ [MÓVIL] ERROR: No se encontró sessionId en la URL');
        console.error('❌ [MÓVIL] URL params disponibles:', Array.from(urlParams.entries()));
        mostrarSinInventario('No se proporcionó un ID de sesión válido. Verifique el enlace QR.');
        return;
    }

    if (sessionId.trim() === '') {
        console.error('❌ [MÓVIL] ERROR: sessionId está vacío');
        mostrarSinInventario('El ID de sesión está vacío. Verifique el enlace QR.');
        return;
    }
    
    // Validar formato del sessionId
    if (!sessionId.startsWith('inv_')) {
        console.error('❌ [MÓVIL] ERROR: Formato de sessionId inválido');
        console.error('❌ [MÓVIL] sessionId recibido:', sessionId);
        console.error('❌ [MÓVIL] Formato esperado: inv_TIMESTAMP_RANDOM');
        mostrarSinInventario('ID de sesión inválido. Verifique el enlace QR.');
        return;
    }

    // Validación adicional del formato
    const sessionParts = sessionId.split('_');
    if (sessionParts.length !== 3) {
        console.error('❌ [MÓVIL] ERROR: sessionId no tiene el formato correcto');
        console.error('❌ [MÓVIL] Partes encontradas:', sessionParts);
        mostrarSinInventario('Formato de ID de sesión inválido. Verifique el enlace QR.');
        return;
    }
    
    console.log('✅ Session ID válido:', sessionId);
    
    // Inicializar WebSocket
    inicializarWebSocket();
    configurarEventListeners();
});

/**
 * Inicializa la conexión WebSocket
 */
function inicializarWebSocket() {
    try {
        console.log('📱 [MÓVIL] ===== INICIANDO CONEXIÓN WEBSOCKET =====');
        console.log('📱 [MÓVIL] Timestamp:', new Date().toISOString());
        console.log('📱 [MÓVIL] Session ID a usar:', sessionId);
        console.log('📱 [MÓVIL] URL del servidor:', window.location.origin);
        
        // Inicializar socket con reconexión automática
        socket = io({
            reconnection: true,
            reconnectionAttempts: 5,
            reconnectionDelay: 1000
        });
        
        socket.on('connect', () => {
            console.log('✅ [MÓVIL] ===== WEBSOCKET CONECTADO =====');
            console.log('✅ [MÓVIL] Socket ID asignado:', socket.id);
            console.log('✅ [MÓVIL] Estado de conexión:', socket.connected);
            
            // Unirse a la sesión de inventario
            const datosUnion = { 
                sessionId,
                timestamp: Date.now(),
                userAgent: navigator.userAgent
            };
            
            console.log('📤 [MÓVIL] Enviando unirse_inventario:');
            console.log(JSON.stringify(datosUnion, null, 2));
            
            socket.emit('unirse_inventario', datosUnion);
        });

        socket.on('connect_error', (error) => {
            console.error('❌ [MÓVIL] Error de conexión WebSocket:', error);
            mostrarSinInventario('Error de conexión con el servidor');
        });
        
        socket.on('conexion_exitosa', (data) => {
            console.log('🎉 [MÓVIL] ===== CONEXIÓN EXITOSA =====');
            console.log('🎉 [MÓVIL] Timestamp:', new Date().toISOString());
            console.log('🎉 [MÓVIL] Datos completos:', JSON.stringify(data, null, 2));
            
            if (!data || !data.sessionId || !data.usuario) {
                console.error('❌ [MÓVIL] Datos de conexión incompletos');
                mostrarSinInventario('Error: Datos de conexión incompletos');
                return;
            }
            
            if (data.sessionId !== sessionId) {
                console.error('❌ [MÓVIL] Session ID no coincide');
                console.error('- Esperado:', sessionId);
                console.error('- Recibido:', data.sessionId);
                mostrarSinInventario('Error: ID de sesión no coincide');
                return;
            }
            
            conectado = true;
            mostrarFormularioCarga();
            
            // Mostrar el usuario que inició el inventario
            if (data.usuario && data.usuario.nombre) {
                console.log('👤 [MÓVIL] Usuario del inventario:', data.usuario.nombre);
                mostrarUsuarioActivo(`Inventario iniciado por: ${data.usuario.nombre}`);
            } else {
                console.error('❌ [MÓVIL] No hay información de usuario en la respuesta');
                mostrarSinInventario('Error: No hay información de usuario');
                return;
            }
            
            console.log('✅ [MÓVIL] Formulario de carga mostrado y listo');
        });
        
        socket.on('error_conexion', (data) => {
            console.error('❌ [MÓVIL] ERROR DE CONEXIÓN');
            console.error('❌ [MÓVIL] Mensaje:', data.mensaje);
            console.error('❌ [MÓVIL] Datos completos:', data);
            mostrarSinInventario(data.mensaje || 'Error al conectar con la sesión');
        });
        
        socket.on('pc_desconectada', () => {
            console.log('⚠️ [MÓVIL] PC DESCONECTADA');
            console.log('⚠️ [MÓVIL] Estado anterior conectado:', conectado);
            conectado = false;
            mostrarSinInventario('La PC se ha desconectado. El inventario ha finalizado.');
        });

        socket.on('inventario_finalizado', (data) => {
            console.log('🏁 [MÓVIL] INVENTARIO FINALIZADO');
            console.log('🏁 [MÓVIL] Datos de finalización:', data);
            conectado = false;
            mostrarSinInventario(data.mensaje || 'El inventario ha finalizado');
        });

        socket.on('articulo_confirmado', (data) => {
            console.log('✅ [MÓVIL] ARTÍCULO CONFIRMADO');
            console.log('✅ [MÓVIL] Datos de confirmación:', data);
            mostrarMensaje(`${data.articulo} registrado: ${data.cantidad}`, 'info');
        });
        
        socket.on('disconnect', () => {
            console.log('❌ [MÓVIL] DESCONECTADO DE WEBSOCKET');
            console.log('❌ [MÓVIL] Session ID era:', sessionId);
            console.log('❌ [MÓVIL] Socket ID era:', socket.id);
            conectado = false;
            mostrarSinInventario('Conexión perdida con el servidor');
        });
        
        // Agregar listener para errores generales
        socket.on('error', (error) => {
            console.error('❌ [MÓVIL] Error en WebSocket:', error);
        });
        
        // Agregar listener para eventos no manejados
        socket.onAny((eventName, ...args) => {
            if (!['connect', 'conexion_exitosa', 'error_conexion', 'pc_desconectada', 
                'inventario_finalizado', 'articulo_confirmado', 'disconnect'].includes(eventName)) {
                console.log('🔔 [MÓVIL] Evento WebSocket no manejado:', eventName, args);
            }
        });
        
    } catch (error) {
        console.error('Error al inicializar WebSocket:', error);
        mostrarSinInventario('Error al conectar con el servidor');
    }
}

/**
 * Muestra el formulario de carga
 */
function mostrarFormularioCarga() {
    document.getElementById('sin-inventario').style.display = 'none';
    document.getElementById('form-carga').style.display = 'block';
}

/**
 * Muestra el mensaje de sin inventario
 */
function mostrarSinInventario(mensaje = 'No hay un inventario activo en este momento') {
    document.getElementById('form-carga').style.display = 'none';
    const sinInventarioDiv = document.getElementById('sin-inventario');
    sinInventarioDiv.innerHTML = `
        ${mensaje}
        <br>
        Debe iniciar el inventario desde una PC.
    `;
    sinInventarioDiv.style.display = 'block';
}

/**
 * Muestra el usuario activo en el header
 */
function mostrarUsuarioActivo(texto) {
    const usuarioDiv = document.getElementById('usuario-activo');
    usuarioDiv.textContent = texto;
    usuarioDiv.style.display = 'block';
}

/**
 * Configura los event listeners
 */
function configurarEventListeners() {
    const codigoInput = document.getElementById('codigo-barras');
    const cantidadInput = document.getElementById('cantidad');
    const btnCargar = document.getElementById('btn-cargar');
    const btnEscanear = document.getElementById('btn-escanear');
    const btnCerrarScanner = document.getElementById('btn-cerrar-scanner');

    // Event listener para el código de barras
    codigoInput.addEventListener('input', manejarCodigoBarras);
    codigoInput.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') {
            e.preventDefault();
            buscarArticulo();
        }
    });

    // Event listener para la cantidad
    cantidadInput.addEventListener('input', validarFormulario);
    cantidadInput.addEventListener('keypress', (e) => {
        if (e.key === 'Enter' && !btnCargar.disabled) {
            e.preventDefault();
            enviarArticuloAPC();
        }
    });

    // Event listener para el botón cargar
    btnCargar.addEventListener('click', enviarArticuloAPC);

    // Event listener para el botón de escanear
    btnEscanear.addEventListener('click', abrirEscaner);

    // Event listener para cerrar el escáner
    btnCerrarScanner.addEventListener('click', cerrarEscaner);
}

/**
 * Maneja el input del código de barras
 */
function manejarCodigoBarras() {
    const codigo = document.getElementById('codigo-barras').value.trim();
    
    if (codigo.length >= 3) {
        buscarArticulo();
    } else {
        ocultarInfoArticulo();
        validarFormulario();
    }
}

/**
 * Busca un artículo por código de barras
 */
async function buscarArticulo() {
    const codigo = document.getElementById('codigo-barras').value.trim();
    
    if (!codigo) {
        ocultarInfoArticulo();
        return;
    }

    try {
        const response = await fetch(`/api/produccion/articulos/buscar?codigo_barras=${codigo}`);
        
        if (!response.ok) {
            throw new Error('Artículo no encontrado');
        }

        const articulo = await response.json();
        articuloActual = articulo;
        mostrarInfoArticulo(articulo);
        
        // Enfocar el input de cantidad
        document.getElementById('cantidad').focus();
        
    } catch (error) {
        console.error('Error al buscar artículo:', error);
        articuloActual = null;
        ocultarInfoArticulo();
        mostrarMensajeError('Artículo no encontrado');
    }
    
    validarFormulario();
}

/**
 * Muestra la información del artículo encontrado
 */
function mostrarInfoArticulo(articulo) {
    const infoDiv = document.getElementById('info-articulo');
    const nombreElement = document.getElementById('nombre-articulo');
    const codigoElement = document.getElementById('codigo-articulo');
    const stockElement = document.getElementById('stock-actual');

    nombreElement.textContent = articulo.nombre;
    codigoElement.textContent = `Código: ${articulo.numero}`;
    stockElement.textContent = `Stock actual: ${articulo.stock_consolidado || 0}`;

    infoDiv.style.display = 'block';
}

/**
 * Oculta la información del artículo
 */
function ocultarInfoArticulo() {
    document.getElementById('info-articulo').style.display = 'none';
    articuloActual = null;
}

/**
 * Valida el formulario y habilita/deshabilita el botón cargar
 */
function validarFormulario() {
    const btnCargar = document.getElementById('btn-cargar');
    const cantidad = document.getElementById('cantidad').value;
    
    const esValido = articuloActual && 
                     cantidad && 
                     !isNaN(cantidad) && 
                     parseInt(cantidad) >= 0 &&
                     conectado;

    btnCargar.disabled = !esValido;
}

/**
 * Envía el artículo a la PC mediante WebSocket
 */
function enviarArticuloAPC() {
    console.log('🚀 [MÓVIL] Iniciando envío de artículo a PC...');
    console.log('🔍 [MÓVIL] Estado de conexión:', conectado);
    console.log('🔍 [MÓVIL] Socket ID actual:', socket?.id);
    console.log('🔍 [MÓVIL] Session ID actual:', sessionId);
    
    if (!articuloActual || !conectado) {
        console.error('❌ [MÓVIL] Error de validación:');
        console.error('- Artículo actual:', articuloActual ? '✅' : '❌');
        console.error('- Conectado:', conectado ? '✅' : '❌');
        mostrarMensajeError('No hay conexión con la PC o falta información del artículo');
        return;
    }

    const cantidad = parseInt(document.getElementById('cantidad').value);
    console.log('📦 [MÓVIL] Cantidad a enviar:', cantidad);
    
    if (isNaN(cantidad) || cantidad < 0) {
        console.error('❌ [MÓVIL] Cantidad inválida:', cantidad);
        mostrarMensajeError('La cantidad debe ser un número válido');
        return;
    }

    try {
        // Preparar datos para envío
        const datosEnvio = {
            sessionId: sessionId,
            articulo: articuloActual,
            cantidad: cantidad
        };
        
        console.log('📤 [MÓVIL] ===== ENVIANDO ARTÍCULO =====');
        console.log('📤 [MÓVIL] Datos completos:', JSON.stringify(datosEnvio, null, 2));
        console.log('📤 [MÓVIL] Socket conectado:', socket.connected);
        
        // Enviar artículo a la PC mediante WebSocket
        socket.emit('articulo_escaneado', datosEnvio);
        console.log('✅ [MÓVIL] Evento articulo_escaneado emitido');

        // Mostrar confirmación
        mostrarConfirmacion();
        console.log('✅ [MÓVIL] Confirmación mostrada al usuario');
        
        // Limpiar formulario
        limpiarFormulario();
        console.log('✅ [MÓVIL] Formulario limpiado');
        
        console.log('🎉 [MÓVIL] ===== ENVÍO COMPLETADO =====');
        
    } catch (error) {
        console.error('❌ [MÓVIL] Error al enviar artículo a PC:', error);
        console.error('❌ [MÓVIL] Stack:', error.stack);
        mostrarMensajeError('Error al enviar el artículo a la PC');
    }
}

/**
 * Muestra el mensaje de confirmación
 */
function mostrarConfirmacion() {
    const confirmacionDiv = document.getElementById('confirmacion');
    confirmacionDiv.style.display = 'block';
    
    // Ocultar después de 2 segundos
    setTimeout(() => {
        confirmacionDiv.style.display = 'none';
    }, 2000);
}

/**
 * Limpia el formulario después de enviar un artículo
 */
function limpiarFormulario() {
    document.getElementById('codigo-barras').value = '';
    document.getElementById('cantidad').value = '';
    ocultarInfoArticulo();
    validarFormulario();
    
    // Enfocar nuevamente el código de barras
    document.getElementById('codigo-barras').focus();
}

/**
 * Abre el escáner de códigos de barras
 */
function abrirEscaner() {
    const modal = document.getElementById('modal-scanner');
    modal.style.display = 'block';
    
    // Verificar si la librería está disponible
    if (typeof Html5Qrcode === 'undefined') {
        mostrarMensajeError('Error: Librería de escaneo no disponible');
        cerrarEscaner();
        return;
    }

    try {
        // Configurar el escáner
        html5QrcodeScanner = new Html5Qrcode("reader");
        
        // Configuración del escáner
        const config = {
            fps: 10,
            qrbox: { width: 250, height: 250 },
            aspectRatio: 1.0
        };

        // Iniciar el escáner
        html5QrcodeScanner.start(
            { facingMode: "environment" }, // Cámara trasera
            config,
            onScanSuccess,
            onScanFailure
        ).catch(err => {
            console.error('Error al iniciar escáner:', err);
            mostrarMensajeError('No se pudo acceder a la cámara');
            cerrarEscaner();
        });

    } catch (error) {
        console.error('Error al configurar escáner:', error);
        mostrarMensajeError('Error al configurar el escáner');
        cerrarEscaner();
    }
}

/**
 * Cierra el escáner de códigos de barras
 */
function cerrarEscaner() {
    const modal = document.getElementById('modal-scanner');
    modal.style.display = 'none';
    
    if (html5QrcodeScanner) {
        html5QrcodeScanner.stop().then(() => {
            html5QrcodeScanner.clear();
            html5QrcodeScanner = null;
        }).catch(err => {
            console.error('Error al detener escáner:', err);
            html5QrcodeScanner = null;
        });
    }
}

/**
 * Callback cuando se escanea exitosamente un código
 */
function onScanSuccess(decodedText, decodedResult) {
    console.log('Código escaneado:', decodedText);
    
    // Cerrar el escáner
    cerrarEscaner();
    
    // Colocar el código en el input
    document.getElementById('codigo-barras').value = decodedText;
    
    // Buscar el artículo automáticamente
    buscarArticulo();
}

/**
 * Callback cuando falla el escaneo (se ejecuta continuamente)
 */
function onScanFailure(error) {
    // No hacer nada, es normal que falle mientras busca códigos
    // console.log('Escaneando...', error);
}

/**
 * Muestra un mensaje temporal (error o info)
 */
function mostrarMensaje(mensaje, tipo = 'error') {
    // Crear elemento de mensaje si no existe
    let mensajeDiv = document.querySelector('.mensaje-temporal');
    
    if (!mensajeDiv) {
        mensajeDiv = document.createElement('div');
        mensajeDiv.className = 'mensaje-temporal';
        mensajeDiv.style.cssText = `
            position: fixed;
            top: 20px;
            left: 50%;
            transform: translateX(-50%);
            color: white;
            padding: 10px 20px;
            border-radius: 4px;
            z-index: 1001;
            font-size: 14px;
        `;
        document.body.appendChild(mensajeDiv);
    }
    
    // Cambiar color según el tipo
    mensajeDiv.style.backgroundColor = tipo === 'error' ? '#dc3545' : '#28a745';
    mensajeDiv.textContent = mensaje;
    mensajeDiv.style.display = 'block';
    
    // Ocultar después de 3 segundos
    setTimeout(() => {
        if (mensajeDiv.parentNode) {
            mensajeDiv.style.display = 'none';
        }
    }, 3000);
}

/**
 * Muestra un mensaje de error temporal
 */
function mostrarMensajeError(mensaje) {
    mostrarMensaje(mensaje, 'error');
}
