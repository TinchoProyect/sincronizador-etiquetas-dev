/**
 * Inventario Móvil - JavaScript
 * 
 * Este archivo maneja la lógica de la vista móvil para inventario.
 * Se conecta con el formulario de inventario de la PC mediante WebSocket.
 * NO modifica directamente el stock, solo envía datos al formulario de PC.
 */

// Declaraciones de tipos para evitar errores de TypeScript/ESLint
/* global io */

// Variables globales para el inventario móvil
let socket = null;
let sessionId = null;
let articuloActual = null;
let conectado = false;
let codeReader = null;

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

    // VALIDACIÓN SIMPLIFICADA Y ROBUSTA - Compatible con ambos formatos
    console.log('🔍 [MÓVIL] Session ID recibido:', sessionId);
    
    // Validar que tenga el formato correcto para ingredientes o artículos
    const esIngredientes = sessionId.startsWith('inv_ing_');
    const esArticulos = sessionId.startsWith('inv_') && !sessionId.startsWith('inv_ing_');
    
    console.log('🔍 [MÓVIL] Es ingredientes:', esIngredientes);
    console.log('🔍 [MÓVIL] Es artículos:', esArticulos);
    
    // Validación básica - solo verificar que sea uno de los dos tipos válidos
    if (!esIngredientes && !esArticulos) {
        console.error('❌ [MÓVIL] ERROR: sessionId no es de inventario válido');
        console.error('❌ [MÓVIL] sessionId recibido:', sessionId);
        mostrarSinInventario('Tipo de inventario no reconocido. Verifique el enlace QR.');
        return;
    }
    
    console.log('✅ [MÓVIL] Validación exitosa - Tipo detectado:', esIngredientes ? 'INGREDIENTES' : 'ARTÍCULOS');
    
    console.log('✅ [MÓVIL] Tipo de inventario detectado:', esIngredientes ? 'INGREDIENTES' : 'ARTÍCULOS');
    
    console.log('✅ Session ID válido:', sessionId);
    
    // Inicializar WebSocket
    inicializarWebSocket();
    configurarEventListeners();
    
    // Cargar la librería @zxing/browser de forma dinámica
    cargarLibreriaZXing();
});

/**
 * Carga la librería @zxing/browser de forma dinámica
 */
async function cargarLibreriaZXing() {
    try {
        console.log('📱 [MÓVIL] Cargando librería @zxing/browser...');
        
        // Verificar si ya está cargada
        if (window.ZXing) {
            console.log('📱 [MÓVIL] Librería @zxing/browser ya está disponible');
            return;
        }
        
        // Cargar desde CDN
        const script = document.createElement('script');
        script.src = 'https://unpkg.com/@zxing/browser@latest/umd/index.min.js';
        script.onload = () => {
            console.log('✅ [MÓVIL] Librería @zxing/browser cargada exitosamente');
        };
        script.onerror = () => {
            console.error('❌ [MÓVIL] Error al cargar librería @zxing/browser');
        };
        document.head.appendChild(script);
        
    } catch (error) {
        console.error('❌ [MÓVIL] Error al cargar librería @zxing/browser:', error);
    }
}

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
            
            // MOSTRAR INFORMACIÓN DE SECTORES SI ES INVENTARIO DE INGREDIENTES
            if (esSessionDeIngredientes() && data.sectores) {
                console.log('🏢 [MÓVIL] Mostrando información de sectores para ingredientes');
                mostrarInfoSectoresMovil(data.sectores);
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

        socket.on('ingrediente_confirmado', (data) => {
            console.log('✅ [MÓVIL] INGREDIENTE CONFIRMADO');
            console.log('✅ [MÓVIL] Datos de confirmación:', data);
            mostrarMensaje(`${data.ingrediente} registrado: ${data.cantidad}`, 'info');
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
 * Busca un artículo o ingrediente por código de barras
 */
async function buscarArticulo() {
    const codigo = document.getElementById('codigo-barras').value.trim();
    
    if (!codigo) {
        ocultarInfoArticulo();
        return;
    }

    try {
        const esIngredientes = esSessionDeIngredientes();
        const tipoItem = esIngredientes ? 'ingrediente' : 'artículo';
        
        // Determinar endpoint según el tipo de inventario
        let endpoint;
        if (esIngredientes) {
            endpoint = `/api/produccion/ingredientes/buscar?codigo=${codigo}`;
        } else {
            endpoint = `/api/produccion/articulos/buscar?codigo_barras=${codigo}`;
        }
        
        console.log(`🔍 [MÓVIL] Buscando ${tipoItem} con código:`, codigo);
        console.log(`🔍 [MÓVIL] Endpoint:`, endpoint);
        
        const response = await fetch(endpoint);
        
        if (!response.ok) {
            throw new Error(`${tipoItem} no encontrado`);
        }

        const item = await response.json();
        articuloActual = item;
        mostrarInfoArticulo(item);
        
        console.log(`✅ [MÓVIL] ${tipoItem} encontrado:`, item.nombre);
        
        // Enfocar el input de cantidad
        document.getElementById('cantidad').focus();
        
    } catch (error) {
        const esIngredientes = esSessionDeIngredientes();
        const tipoItem = esIngredientes ? 'Ingrediente' : 'Artículo';
        
        console.error(`Error al buscar ${tipoItem.toLowerCase()}:`, error);
        articuloActual = null;
        ocultarInfoArticulo();
        mostrarMensajeError(`${tipoItem} no encontrado`);
    }
    
    validarFormulario();
}

/**
 * Muestra la información del artículo/ingrediente encontrado
 */
function mostrarInfoArticulo(item) {
    const infoDiv = document.getElementById('info-articulo');
    const nombreElement = document.getElementById('nombre-articulo');
    const codigoElement = document.getElementById('codigo-articulo');
    const stockElement = document.getElementById('stock-actual');

    const esIngredientes = esSessionDeIngredientes();
    
    nombreElement.textContent = item.nombre;
    
    if (esIngredientes) {
        // Para ingredientes
        codigoElement.textContent = `Código: ${item.codigo || item.id}`;
        stockElement.textContent = `Stock actual: ${item.stock_actual || 0} ${item.unidad_medida || 'kg'}`;
    } else {
        // Para artículos
        codigoElement.textContent = `Código: ${item.numero}`;
        stockElement.textContent = `Stock actual: ${item.stock_consolidado || 0}`;
    }

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
 * Detecta si la sesión es de ingredientes o artículos
 */
function esSessionDeIngredientes() {
    return sessionId && sessionId.startsWith('inv_ing_');
}

/**
 * Envía el artículo o ingrediente a la PC mediante WebSocket
 */
function enviarArticuloAPC() {
    const esIngredientes = esSessionDeIngredientes();
    const tipoItem = esIngredientes ? 'ingrediente' : 'artículo';
    const emoji = esIngredientes ? '🧪' : '📦';
    
    console.log(`🚀 [MÓVIL] Iniciando envío de ${tipoItem} a PC...`);
    console.log('🔍 [MÓVIL] Estado de conexión:', conectado);
    console.log('🔍 [MÓVIL] Socket ID actual:', socket?.id);
    console.log('🔍 [MÓVIL] Session ID actual:', sessionId);
    console.log('🔍 [MÓVIL] Tipo de sesión:', esIngredientes ? 'INGREDIENTES' : 'ARTÍCULOS');
    
    if (!articuloActual || !conectado) {
        console.error('❌ [MÓVIL] Error de validación:');
        console.error(`- ${tipoItem} actual:`, articuloActual ? '✅' : '❌');
        console.error('- Conectado:', conectado ? '✅' : '❌');
        mostrarMensajeError(`No hay conexión con la PC o falta información del ${tipoItem}`);
        return;
    }

    const cantidad = parseFloat(document.getElementById('cantidad').value);
    console.log(`${emoji} [MÓVIL] Cantidad a enviar:`, cantidad);
    
    if (isNaN(cantidad) || cantidad < 0) {
        console.error('❌ [MÓVIL] Cantidad inválida:', cantidad);
        mostrarMensajeError('La cantidad debe ser un número válido');
        return;
    }

    try {
        // Preparar datos para envío según el tipo de sesión
        const datosEnvio = {
            sessionId: sessionId,
            cantidad: cantidad
        };
        
        // Usar evento unificado 'articulo_escaneado' para ambos tipos
        const evento = 'articulo_escaneado';
        
        if (esIngredientes) {
            console.log('🧪 [MÓVIL] Escaneando ingrediente desde móvil...');
            datosEnvio.ingrediente = articuloActual;
        } else {
            console.log('📦 [MÓVIL] Escaneando artículo desde móvil...');
            datosEnvio.articulo = articuloActual;
        }
        
        console.log(`📤 [MÓVIL] ===== ENVIANDO ${tipoItem.toUpperCase()} =====`);
        console.log('📤 [MÓVIL] Evento a emitir:', evento);
        console.log('📤 [MÓVIL] Datos completos:', JSON.stringify(datosEnvio, null, 2));
        console.log('📤 [MÓVIL] Socket conectado:', socket.connected);
        
        // Enviar según el tipo de sesión
        socket.emit(evento, datosEnvio);
        console.log(`✅ [MÓVIL] Evento ${evento} emitido`);

        // Mostrar confirmación
        mostrarConfirmacion();
        console.log('✅ [MÓVIL] Confirmación mostrada al usuario');
        
        // Limpiar formulario
        limpiarFormulario();
        console.log('✅ [MÓVIL] Formulario limpiado');
        
        console.log(`🎉 [MÓVIL] ===== ENVÍO DE ${tipoItem.toUpperCase()} COMPLETADO =====`);
        
    } catch (error) {
        console.error(`❌ [MÓVIL] Error al enviar ${tipoItem} a PC:`, error);
        console.error('❌ [MÓVIL] Stack:', error.stack);
        mostrarMensajeError(`Error al enviar el ${tipoItem} a la PC`);
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
 * Abre el escáner de códigos de barras usando @zxing/browser
 */
function abrirEscaner() {
    console.log('📱 [MÓVIL] ===== INICIANDO ESCÁNER @ZXING/BROWSER =====');
    
    const modal = document.getElementById('modal-scanner');
    modal.style.display = 'block';

    // Verificar si la librería ZXing está disponible
    if (!window.ZXing) {
        console.error('❌ [MÓVIL] Librería @zxing/browser no está disponible');
        mostrarMensajeError('Error: Librería de escaneo no disponible');
        cerrarEscaner();
        return;
    }

    try {
        // Crear instancia del lector si no existe
        if (!codeReader) {
            codeReader = new window.ZXing.BrowserMultiFormatReader();
            console.log('📱 [MÓVIL] Instancia de BrowserMultiFormatReader creada');
        }

        console.log('📱 [MÓVIL] Configurando formatos de códigos de barra 1D...');
        
        // Configurar hints para códigos de barra 1D
        const hints = new Map();
        const formats = [
            window.ZXing.BarcodeFormat.EAN_13,
            window.ZXing.BarcodeFormat.EAN_8,
            window.ZXing.BarcodeFormat.UPC_A,
            window.ZXing.BarcodeFormat.UPC_E,
            window.ZXing.BarcodeFormat.CODE_39,
            window.ZXing.BarcodeFormat.CODE_128,
            window.ZXing.BarcodeFormat.ITF,
            window.ZXing.BarcodeFormat.CODABAR
        ];
        
        hints.set(window.ZXing.DecodeHintType.POSSIBLE_FORMATS, formats);
        hints.set(window.ZXing.DecodeHintType.TRY_HARDER, true);
        
        console.log('📱 [MÓVIL] Formatos configurados:', formats.length);
        console.log('📱 [MÓVIL] Obteniendo dispositivos de video...');

        // Obtener dispositivos de video disponibles
        codeReader.listVideoInputDevices()
            .then(videoInputDevices => {
                console.log('📱 [MÓVIL] Dispositivos de video encontrados:', videoInputDevices.length);
                
                if (videoInputDevices.length === 0) {
                    console.error('❌ [MÓVIL] No se encontraron cámaras disponibles');
                    mostrarMensajeError('No se encontraron cámaras disponibles');
                    cerrarEscaner();
                    return;
                }

                // Buscar cámara trasera preferentemente
                let selectedDeviceId = videoInputDevices[0].deviceId;
                for (const device of videoInputDevices) {
                    if (device.label.toLowerCase().includes('back') || 
                        device.label.toLowerCase().includes('rear') ||
                        device.label.toLowerCase().includes('environment')) {
                        selectedDeviceId = device.deviceId;
                        break;
                    }
                }

                const selectedDevice = videoInputDevices.find(d => d.deviceId === selectedDeviceId);
                console.log('📱 [MÓVIL] Cámara seleccionada:', selectedDevice?.label || selectedDeviceId);

                // Iniciar decodificación desde video
                console.log('📱 [MÓVIL] Iniciando decodificación desde video...');
                
                codeReader.decodeFromVideoDevice(
                    selectedDeviceId,
                    'reader',
                    (result, err) => {
                        if (result) {
                            console.log('🎉 [MÓVIL] ===== CÓDIGO ESCANEADO EXITOSAMENTE =====');
                            console.log('🎉 [MÓVIL] Código:', result.getText());
                            console.log('🎉 [MÓVIL] Formato:', result.getBarcodeFormat());
                            console.log('🎉 [MÓVIL] Timestamp:', new Date().toISOString());
                            
                            // Cerrar escáner
                            cerrarEscaner();
                            
                            // Colocar código en input y buscar artículo
                            document.getElementById('codigo-barras').value = result.getText();
                            buscarArticulo();
                            
                            // Mostrar mensaje de éxito
                            mostrarMensaje(`Código escaneado: ${result.getText()}`, 'info');
                        }
                        
                        if (err && !(err instanceof window.ZXing.NotFoundException)) {
                            console.error('❌ [MÓVIL] Error en escaneo:', err);
                            // No mostrar error por NotFoundException ya que es normal durante el escaneo
                            if (!(err instanceof window.ZXing.ChecksumException) && 
                                !(err instanceof window.ZXing.FormatException)) {
                                mostrarMensajeError('Error al escanear el código');
                            }
                        }
                    },
                    hints
                );
                
                console.log('✅ [MÓVIL] Escáner iniciado correctamente');
                
            })
            .catch(err => {
                console.error('❌ [MÓVIL] Error al listar dispositivos de video:', err);
                mostrarMensajeError('No se pudo acceder a la cámara');
                cerrarEscaner();
            });

    } catch (error) {
        console.error('❌ [MÓVIL] Error al configurar escáner:', error);
        mostrarMensajeError('Error al configurar el escáner');
        cerrarEscaner();
    }
}

/**
 * Cierra el escáner de códigos de barras
 */
function cerrarEscaner() {
    console.log('📱 [MÓVIL] ===== CERRANDO ESCÁNER =====');
    
    const modal = document.getElementById('modal-scanner');
    modal.style.display = 'none';

    if (codeReader) {
        try {
            console.log('📱 [MÓVIL] Deteniendo lector de códigos...');
            codeReader.reset();
            console.log('✅ [MÓVIL] Lector detenido correctamente');
        } catch (error) {
            console.error('❌ [MÓVIL] Error al detener lector:', error);
        }
    }
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

/**
 * Muestra la información de sectores en la aplicación móvil
 */
function mostrarInfoSectoresMovil(sectores) {
    console.log('🏢 [MÓVIL-SECTORES] ===== MOSTRANDO INFORMACIÓN DE SECTORES =====');
    console.log('🏢 [MÓVIL-SECTORES] Sectores recibidos:', sectores);
    
    const infoSectoresDiv = document.getElementById('info-sectores-movil');
    const sectoresTextoElement = document.getElementById('sectores-movil-texto');
    
    if (!infoSectoresDiv || !sectoresTextoElement) {
        console.error('❌ [MÓVIL-SECTORES] No se encontraron elementos de sectores en el DOM');
        return;
    }
    
    // Mostrar el contenedor de sectores
    infoSectoresDiv.style.display = 'block';
    
    if (sectores === 'TODOS') {
        console.log('🏢 [MÓVIL-SECTORES] Mostrando: Todos los sectores');
        sectoresTextoElement.innerHTML = '📦 <strong>Todos los sectores</strong>';
    } else if (Array.isArray(sectores)) {
        console.log('🏢 [MÓVIL-SECTORES] Sectores específicos:', sectores);
        
        if (sectores.length === 0) {
            console.log('🏢 [MÓVIL-SECTORES] No hay sectores específicos');
            sectoresTextoElement.innerHTML = '⚠️ <strong>Sin sectores específicos</strong>';
        } else {
            // Para el móvil, mostrar solo los IDs ya que no tenemos los nombres
            // En una implementación completa, se podrían enviar los nombres desde el servidor
            const textoSectores = sectores.map(id => `Sector ${id}`).join(', ');
            sectoresTextoElement.innerHTML = `🏢 <strong>Sectores:</strong> ${textoSectores}`;
        }
    } else {
        console.error('❌ [MÓVIL-SECTORES] Formato de sectores no reconocido:', sectores);
        sectoresTextoElement.innerHTML = '❌ <strong>Error</strong> - Formato de sectores inválido';
    }
    
    console.log('✅ [MÓVIL-SECTORES] Información de sectores mostrada correctamente');
}
