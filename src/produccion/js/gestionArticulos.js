// Variables globales para el inventario
let usuarioSeleccionado = null;
let articulosInventario = new Map(); // Mapa para almacenar los artículos escaneados
let socket = null;
let sessionId = null;

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
    if (!tbody) return;

    tbody.innerHTML = '';

    if (!articulos || articulos.length === 0) {
        tbody.innerHTML = '<tr><td colspan="4" class="mensaje-info">No hay artículos registrados</td></tr>';
        return;
    }

    articulos.forEach(articulo => {
        const tr = document.createElement('tr');
        tr.innerHTML = `
            <td>${articulo.numero}</td>
            <td>${articulo.nombre}</td>
            <td>${articulo.codigo_barras || '-'}</td>
            <td>${articulo.stock_ventas || 0}</td>
        `;
        tbody.appendChild(tr);
    });
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
            <span>Stock Actual: ${articulo.stock_consolidado || 0}</span>
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
        const ajuste = stockFisico - (articulo.stock_consolidado || 0);
        
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

// Event Listeners
document.addEventListener('DOMContentLoaded', () => {
    console.log('Página de gestión de artículos cargada');
    cargarArticulos();

    // Botón para iniciar inventario
    document.getElementById('btn-iniciar-inventario').addEventListener('click', mostrarModal);

    // Cerrar modal
    document.getElementById('close-modal').addEventListener('click', cerrarModal);

    // Select de usuario con múltiples eventos
    const selectUsuario = document.getElementById('select-usuario');
    
    function actualizarSeleccionUsuario() {
        const valor = selectUsuario.value;
        console.log('🔄 Actualizando selección de usuario:', valor);
        usuarioSeleccionado = valor;
        const btnContinuar = document.getElementById('btn-continuar-usuario');
        btnContinuar.disabled = !usuarioSeleccionado;
        console.log('🔄 Botón continuar habilitado:', !btnContinuar.disabled);
    }
    
    // Eventos del select
    selectUsuario.addEventListener('change', function(e) {
        console.log('🔄 Evento change del select usuario disparado');
        console.log('🔄 Valor seleccionado:', e.target.value);
        actualizarSeleccionUsuario();
    });
    
    selectUsuario.addEventListener('input', function(e) {
        console.log('🔄 Evento input del select usuario disparado');
        console.log('🔄 Valor seleccionado:', e.target.value);
        actualizarSeleccionUsuario();
    });
    
    // Evento para detectar cambios con teclado
    selectUsuario.addEventListener('keydown', function(e) {
        console.log('⌨️ Tecla presionada en select:', e.key);
        setTimeout(() => {
            actualizarSeleccionUsuario();
        }, 10);
    });

    // Botón continuar después de seleccionar usuario
    document.getElementById('btn-continuar-usuario').addEventListener('click', function() {
        console.log('🚀 Botón continuar clickeado');
        console.log('🚀 Usuario seleccionado actual:', usuarioSeleccionado);
        console.log('🚀 Valor del select:', selectUsuario.value);
        
        // Verificación adicional
        if (!usuarioSeleccionado) {
            const valorSelect = selectUsuario.value;
            if (valorSelect) {
                console.log('🔧 Corrigiendo usuario seleccionado:', valorSelect);
                usuarioSeleccionado = valorSelect;
            }
        }
        
        if (usuarioSeleccionado) {
            console.log('✅ Procediendo a mostrar paso de conteo');
            mostrarPasoConteo();
        } else {
            console.log('❌ No hay usuario seleccionado');
            mostrarMensaje('Por favor selecciona un usuario', 'error');
        }
    });

    // Input de código de barras
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

    // Botones de finalizar y cancelar
    document.getElementById('btn-finalizar-inventario').addEventListener('click', finalizarInventario);
    document.getElementById('btn-cancelar-inventario').addEventListener('click', cerrarModal);
});
