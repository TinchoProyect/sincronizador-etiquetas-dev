const express = require('express');
const cors = require('cors');
const path = require('path');
const { createServer } = require('http');
const { Server } = require('socket.io');
const { createProxyMiddleware } = require('http-proxy-middleware');
const produccionRoutes = require('./routes/produccion');
const usuariosRoutes = require('../usuarios/rutas');


const app = express();
const httpServer = createServer(app);
const io = new Server(httpServer, {
    cors: {
        origin: "*",
        methods: ["GET", "POST"]
    }
});


// Almacén de sesiones de inventario activas
const inventarioSesiones = new Map();

// ✅ Middleware para interpretar JSON en los requests
// NOTA: El proxy debe ir ANTES del body parser para que funcione correctamente el stream
app.use('/api/presupuestos', createProxyMiddleware({
    target: 'http://localhost:3003/api/presupuestos',
    changeOrigin: true,
    logLevel: 'debug'
}));

// Proxy hacia el módulo de logística
app.use('/api/logistica', createProxyMiddleware({
    target: 'http://localhost:3005/api/logistica',
    changeOrigin: true,
    logLevel: 'debug'
}));

app.use(express.json());

//Temporizacion -Mari
const tiemposRouter = require('./routes/tiemposCarro');
app.use('/api/tiempos', tiemposRouter);
app.use('/api/produccion', produccionRoutes);

// Middleware para deshabilitar caché en archivos HTML y JS
app.use((req, res, next) => {
    if (req.url.endsWith('.html') || req.url.endsWith('.js') || req.url.endsWith('.css')) {
        res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, private');
        res.setHeader('Pragma', 'no-cache');
        res.setHeader('Expires', '0');
    }
    next();
});

// Configuración de archivos estáticos y rutas base
app.use(express.static(__dirname));
app.use('/pages', express.static(path.join(__dirname, 'pages')));
app.use('/js', express.static(path.join(__dirname, 'js')));
app.use('/css', express.static(path.join(__dirname, 'css')));


// Redirigir la raíz a la página principal de producción
app.get('/', (req, res) => {
    res.redirect('/pages/produccion.html');
});

// Endpoint para obtener la IP local del servidor
app.get('/api/config/network-ip', (req, res) => {
    const os = require('os');
    const interfaces = os.networkInterfaces();
    let networkIp = 'localhost';

    // Buscar una dirección IPv4 externa
    Object.keys(interfaces).forEach((ifname) => {
        interfaces[ifname].forEach((iface) => {
            // Saltar direcciones internas (127.0.0.1) y no-IPv4
            if ('IPv4' !== iface.family || iface.internal) {
                return;
            }
            networkIp = iface.address;
        });
    });

    res.json({ ip: networkIp });
});

// Ruta para la vista móvil de inventario
app.get('/inventario-movil', (req, res) => {
    res.redirect('/pages/inventario-movil.html');
});

// Middleware para logging detallado
app.use((req, res, next) => {
    console.log(`[${new Date().toISOString()}] ${req.method} ${req.originalUrl}`);
    next();
});

// ✅ Middleware para ajustar solo si es necesario (solo si no se rompe)
app.use('/api/produccion', produccionRoutes); // ← Registro completo sin manipular req.url

// Otras rutas de usuarios
app.use('/api', usuariosRoutes);

/**
 * CONFIGURACIÓN CORS — TOPOLOGÍA DE RED
 * Dominio externo oficial: lamda-logistica.tplinkdns.com (DDNS TP-Link)
 * Puerto de salida público: 3005 (Port Forwarding en router)
 * Host binding: 0.0.0.0 (NUNCA cambiar a localhost, bloquearía acceso externo)
 * 
 * NOTA: Este módulo usa cors() abierto porque recibe requests desde múltiples
 * orígenes dinámicos (inventario móvil, WebSocket, módulos internos).
 */
app.use(cors());

// Manejo de errores global
app.use((err, req, res, next) => {
    console.error('Error:', err.message);
    console.error('Stack:', err.stack);
    res.status(500).json({
        error: 'Error interno del servidor',
        message: err.message,
        stack: process.env.NODE_ENV === 'development' ? err.stack : undefined
    });
});

// Configuración de WebSocket
io.on('connection', (socket) => {
    console.log('🔌 [WS] Cliente conectado - Socket ID:', socket.id);
    console.log('📊 [WS] Sesiones activas:', inventarioSesiones.size);

    // Detectar tipo de inventario por sessionId y manejar de forma unificada
    function detectarTipoInventario(sessionId) {
        return sessionId && sessionId.startsWith('inv_ing_') ? 'ingredientes' : 'articulos';
    }

    // PC inicia una sesión de inventario (UNIFICADO para artículos e ingredientes)
    socket.on('iniciar_inventario', (data) => {
        const tiempoInicio = Date.now();
        const sessionId = data.sessionId;
        const usuario = data.usuario || null; // Ahora es un objeto {id, nombre}
        const sectores = data.sectores || null; // Para ingredientes
        const tipoInventario = detectarTipoInventario(sessionId);

        console.log(`🚀 [WS] ===== NUEVA SESIÓN DE INVENTARIO (${tipoInventario.toUpperCase()}) =====`);
        console.log('🆔 [WS] Session ID:', sessionId);
        console.log('👤 [WS] Usuario recibido:', JSON.stringify(usuario));
        console.log('🏷️ [WS] Sectores:', sectores);
        console.log('🔌 [WS] Socket PC:', socket.id);
        console.log('⏱️ [WS] Timestamp inicio:', new Date(tiempoInicio).toISOString());

        // Verificar si ya existe la sesión
        if (inventarioSesiones.has(sessionId)) {
            console.log('⚠️ [WS] Sesión existente, actualizando datos...');
            const sesionExistente = inventarioSesiones.get(sessionId);
            sesionExistente.pcSocketId = socket.id;
            sesionExistente.usuario = usuario; // Guardar objeto completo
            sesionExistente.timestampActualizacion = tiempoInicio;
            if (tipoInventario === 'ingredientes') {
                sesionExistente.sectores = sectores;
                sesionExistente.tipo = 'ingredientes';
            }
        } else {
            console.log('✨ [WS] Creando nueva sesión...');
            const sesionData = {
                pcSocketId: socket.id,
                usuario: usuario, // Guardar objeto completo {id, nombre}
                items: new Map(),
                fechaInicio: new Date(),
                timestampCreacion: tiempoInicio,
                estado: 'activa'
            };

            // Agregar datos específicos para ingredientes
            if (tipoInventario === 'ingredientes') {
                sesionData.sectores = sectores;
                sesionData.ingredientes = data.ingredientes || []; // Guardar lista maestra
                sesionData.tipo = 'ingredientes';
            }

            inventarioSesiones.set(sessionId, sesionData);
        }

        const tiempoGuardado = Date.now() - tiempoInicio;
        console.log(`⏱️ [WS] Sesión guardada en ${tiempoGuardado}ms`);

        // CORRECCIÓN CRÍTICA: Usar setImmediate para asegurar que la sesión 
        // esté completamente persistida antes de notificar a la PC
        setImmediate(() => {
            // Emitir respuesta unificada con datos específicos según el tipo
            const respuesta = { sessionId, usuario }; // Enviar objeto usuario completo
            if (tipoInventario === 'ingredientes') {
                respuesta.sectores = sectores;
            }

            socket.emit('inventario_iniciado', respuesta);

            const tiempoTotal = Date.now() - tiempoInicio;
            console.log(`✅ [WS] Sesión de ${tipoInventario} iniciada exitosamente en ${tiempoTotal}ms`);
            console.log('📊 [WS] Total sesiones activas:', inventarioSesiones.size);
        });
    });

    // Móvil se une a una sesión (UNIFICADO)
    socket.on('unirse_inventario', (data) => {
        const tiempoUnion = Date.now();
        const sessionId = data.sessionId;
        const intentoNumero = data.intento || 1;

        console.log('📱 [WS] ===== MÓVIL INTENTANDO UNIRSE =====');
        console.log('🆔 [WS] Session ID solicitado:', sessionId);
        console.log('🔌 [WS] Socket Móvil:', socket.id);
        console.log('🔢 [WS] Intento número:', intentoNumero);
        console.log('⏱️ [WS] Timestamp unión:', new Date(tiempoUnion).toISOString());
        console.log('📊 [WS] Sesiones activas:', Array.from(inventarioSesiones.keys()));
        console.log('🔍 [WS] Datos completos recibidos del móvil:', JSON.stringify(data, null, 2));

        const session = inventarioSesiones.get(sessionId);

        if (session) {
            const tiempoDesdeCreacion = tiempoUnion - (session.timestampCreacion || tiempoUnion);
            console.log('✅ [WS] Datos de la sesión encontrada:');
            console.log('- Usuario:', session.usuario);
            console.log('- Estado:', session.estado);
            console.log('- Fecha inicio:', session.fechaInicio);
            console.log('- PC Socket:', session.pcSocketId);
            console.log('- Tipo:', session.tipo || 'articulos');
            console.log('- Sectores:', session.sectores);
            console.log(`⏱️ [WS] Tiempo desde creación de sesión: ${tiempoDesdeCreacion}ms`);

            // ADVERTENCIA: Detectar posibles race conditions
            if (tiempoDesdeCreacion < 100) {
                console.warn(`⚠️ [WS] ADVERTENCIA: Unión muy rápida (${tiempoDesdeCreacion}ms) - Posible race condition evitada`);
            }
        }

        if (!session) {
            console.error('❌ [WS] Error: Sesión no encontrada');
            console.log('🔍 [WS] Sesiones disponibles:', Array.from(inventarioSesiones.keys()));
            socket.emit('error_conexion', {
                mensaje: 'Sesión no encontrada o expirada',
                sessionId: sessionId
            });
            return;
        }

        if (session.estado !== 'activa') {
            console.error('❌ [WS] Error: Sesión no está activa');
            socket.emit('error_conexion', {
                mensaje: 'La sesión ya no está activa',
                sessionId: sessionId
            });
            return;
        }

        console.log('✅ [WS] Sesión encontrada y válida');
        console.log('👤 [WS] Usuario de la sesión:', JSON.stringify(session.usuario));

        // Registrar el móvil en la sesión
        session.mobileSocketId = socket.id;

        // CORRECCIÓN: Confirmar conexión al móvil con objeto usuario completo
        const respuestaConexion = {
            sessionId,
            usuario: session.usuario, // Enviar objeto completo {id, nombre}
            sectores: session.sectores, // Enviar sectores también
            ingredientes: session.ingredientes // Enviar Lista Maestra para auditoría
        };

        // Para ingredientes, incluir información de sectores
        if (session.tipo === 'ingredientes' && session.sectores) {
            respuestaConexion.sectores = session.sectores;
            console.log('🏢 [WS] Incluyendo sectores en respuesta:', session.sectores);
        }

        console.log('📤 [WS] Enviando conexion_exitosa con datos:', JSON.stringify(respuestaConexion));
        socket.emit('conexion_exitosa', respuestaConexion);

        // Notificar a la PC
        io.to(session.pcSocketId).emit('movil_conectado', {
            mensaje: 'Dispositivo móvil conectado',
            socketId: socket.id
        });

        console.log('🎉 [WS] Móvil conectado exitosamente a la sesión');
    });

    // Móvil envía un item escaneado (UNIFICADO para artículos e ingredientes)
    socket.on('articulo_escaneado', (data) => {
        const { sessionId, articulo, ingrediente, cantidad } = data;
        const item = articulo || ingrediente; // Puede ser artículo o ingrediente
        const tipoInventario = detectarTipoInventario(sessionId);

        console.log(`📦 [WS] ===== NUEVO ${tipoInventario.toUpperCase().slice(0, -1)} ESCANEADO =====`);
        console.log('🆔 [WS] Session ID:', sessionId);
        console.log('📝 [WS] Item:', item?.nombre);
        console.log('🔢 [WS] Cantidad:', cantidad);
        console.log('🏷️ [WS] Tipo detectado:', tipoInventario);

        const session = inventarioSesiones.get(sessionId);

        if (!session) {
            console.error(`❌ [WS] Error: Sesión no encontrada para ${tipoInventario.slice(0, -1)}`);
            socket.emit('error_conexion', { mensaje: 'Sesión no válida' });
            return;
        }

        if (session.estado !== 'activa') {
            console.error(`❌ [WS] Error: Sesión no activa para ${tipoInventario.slice(0, -1)}`);
            socket.emit('error_conexion', { mensaje: 'La sesión no está activa' });
            return;
        }

        // Guardar en la sesión con clave apropiada según el tipo
        const key = tipoInventario === 'ingredientes' ?
            (item.id || item.codigo) :
            item.numero;

        session.items.set(key, {
            [tipoInventario === 'ingredientes' ? 'ingrediente' : 'articulo']: item,
            cantidad,
            timestamp: new Date()
        });

        console.log(`📤 [WS] Enviando ${tipoInventario.slice(0, -1)} a PC...`);

        // Enviar a la PC usando evento unificado
        io.to(session.pcSocketId).emit('nuevo_articulo', {
            sessionId,
            [tipoInventario === 'ingredientes' ? 'ingrediente' : 'articulo']: item,
            cantidad,
            timestamp: new Date()
        });

        // NUEVO: Enviar también al Móvil (Mirroring)
        if (session.mobileSocketId) {
            io.to(session.mobileSocketId).emit('nuevo_articulo', {
                sessionId,
                [tipoInventario === 'ingredientes' ? 'ingrediente' : 'articulo']: item,
                cantidad,
                timestamp: new Date()
            });
        }

        // Confirmar al emisor (PC o Móvil)
        socket.emit('articulo_confirmado', {
            [tipoInventario === 'ingredientes' ? 'ingrediente' : 'articulo']: item.nombre,
            cantidad
        });

        console.log(`✅ [WS] ${tipoInventario.slice(0, -1)} procesado exitosamente`);
        console.log(`📊 [WS] Total items en sesión:`, session.items.size);
        console.log(`✅ [WS] ${tipoInventario.slice(0, -1)} procesado exitosamente`);
        console.log(`📊 [WS] Total items en sesión:`, session.items.size);
    });

    // Relay de datos de inventario (PC -> Móvil)
    socket.on('sincronizar_datos_inventario', (data) => {
        const { sessionId, ingredientes } = data;
        const session = inventarioSesiones.get(sessionId);

        if (session && session.mobileSocketId) {
            console.log(`📦 [WS] Sincronizando ${ingredientes.length} ingredientes con móvil...`);
            io.to(session.mobileSocketId).emit('datos_inventario', { ingredientes });
        }
    });

    // Relay de solicitud de impresión (Móvil -> PC)
    socket.on('solicitar_impresion', (data) => {
        const { sessionId, ingredientes } = data; // Legacy support
        // ...
    });

    // ✅ FIX: Listener específico para impresión de etiquetas de ingredientes
    // ✅ FIX: Listener específico para impresión de etiquetas de ingredientes
    // ✅ FIX: Listener específico para impresión de etiquetas de ingredientes
    socket.on('imprimir_etiqueta_ingrediente', async (data) => {
        const { sessionId, ingrediente } = data; // Ahora esperamos el objeto ingrediente completo
        const session = inventarioSesiones.get(sessionId);

        // TRAZA NIVEL 2: Recepción
        console.log(`TRAZA-SERVER: Orden de impresión recibida del cliente [${socket.id}] para [${ingrediente?.id}]`);
        console.log(`🖨️ [WS] Solicitud de impresión para: ${ingrediente?.nombre || 'Desconocido'}`);

        // NO Relay a PC (Centralizamos la impresión en el Servidor para soportar Móvil y evitar duplicados)
        // Si la PC necesita feedback, escuchará 'print_status'

        if (ingrediente) {
            try {
                // Usar módulo HTTP nativo para máxima compatibilidad (Node < 18 fallback)
                const http = require('http');
                const postData = JSON.stringify({
                    ingredienteId: ingrediente.id,
                    nombre: ingrediente.nombre,
                    codigo: ingrediente.codigo,
                    sector: ingrediente.sector_letra || ingrediente.sector_id || ''
                });

                // TRAZA NIVEL 3: Puente
                console.log(`TRAZA-SERVER: Enviando orden final al puerto 3000 con los datos: ${postData}`);

                const options = {
                    hostname: 'localhost',
                    port: 3000,
                    path: '/api/etiquetas/ingrediente',
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'Content-Length': Buffer.byteLength(postData)
                    }
                };

                const req = http.request(options, (res) => {
                    let responseData = '';
                    res.on('data', (chunk) => { responseData += chunk; });
                    res.on('end', () => {
                        if (res.statusCode >= 200 && res.statusCode < 300) {
                            console.log("✅ [IMP] Orden enviada a localhost:3000 con éxito.");
                            socket.emit('print_status', { success: true, msg: 'Imprimiendo...' });
                        } else {
                            console.error(`TRAZA-SERVER-ERROR: Servicio de impresión respondió con error: Status ${res.statusCode} - ${responseData}`);
                            console.error(`❌ [IMP] Error del servicio (Status: ${res.statusCode}): ${responseData}`);
                            socket.emit('print_status', { success: false, msg: 'Error en servicio de impresión' });
                        }
                    });
                });

                req.on('error', (e) => {
                    console.error(`TRAZA-SERVER-ERROR: Error de conexión con puerto 3000: ${e.message}`);
                    console.error(`❌ [IMP] Error de conexión con localhost:3000: ${e.message}`);
                    socket.emit('print_status', { success: false, msg: 'Error: Servicio de impresión no disponible' });
                });

                // Write data to request body
                req.write(postData);
                req.end();

            } catch (err) {
                console.error("TRAZA-SERVER-ERROR: Excepción crítica server-side:", err.message);
                console.error("❌ [IMP] Excepción crítica al intentar imprimir:", err.message);
                socket.emit('print_status', { success: false, msg: 'Error interno de impresión' });
            }
        } else {
            console.warn("⚠️ [IMP] Datos de ingrediente inválidos/faltantes");
            socket.emit('print_status', { success: false, msg: 'Datos inválidos' });
        }
    });

    // NUEVO: Listener para impresión de sector (Relay a puerto 3000)
    socket.on('imprimir_etiqueta_sector', async (data) => {
        console.log(`🖨️ [WS] Imprimir etiqueta SECTOR: ${data.sector}`);
        try {
            // Enviamos al endpoint genérico de impresión de texto o específico si existe
            // Asumo /api/etiquetas/sector o similar. Si no, ajustar a /texto
            await fetch('http://localhost:3000/api/etiquetas/sector', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ sector: data.sector })
            });
            console.log("✅ [IMP] Orden imprimir sector enviada");
        } catch (e) {
            console.error("❌ [IMP] Error al imprimir sector:", e.message);
        }
    });

    // PC finaliza inventario (UNIFICADO)
    socket.on('finalizar_inventario', (data) => {
        const sessionId = data.sessionId;
        console.log('🏁 [WS] ===== FINALIZANDO INVENTARIO (Desde Móvil) =====');
        console.log('🆔 [WS] Session ID:', sessionId);

        const session = inventarioSesiones.get(sessionId);

        if (!session) {
            console.log('⚠️ [WS] No se encontró la sesión a finalizar');
            return;
        }

        // RELAY CRÍTICO: Ordenar a la PC que ejecute el cierre
        if (session.pcSocketId) {
            console.log('💻 [WS] Enviando solicitud_cierre_remoto a PC...');
            io.to(session.pcSocketId).emit('solicitud_cierre_remoto', { sessionId });
        }

        // Marcar sesión como finalizada
        session.estado = 'finalizada';

        // Notificar al móvil
        if (session.mobileSocketId) {
            io.to(session.mobileSocketId).emit('inventario_finalizado', {
                mensaje: 'Procesando cierre de inventario...'
            });
        }

        // Limpieza diferida
        setTimeout(() => {
            if (inventarioSesiones.has(sessionId)) {
                inventarioSesiones.delete(sessionId);
            }
        }, 5000);
    });

    // NUEVO: Cancelar inventario (Sin guardar nada)
    socket.on('cancelar_inventario', (data) => {
        const sessionId = data.sessionId;
        console.log('⛔ [WS] ===== CANCELANDO INVENTARIO =====');
        console.log('🆔 [WS] Session ID:', sessionId);

        const session = inventarioSesiones.get(sessionId);
        if (!session) return;

        // Notificar a ambos
        if (session.pcSocketId) io.to(session.pcSocketId).emit('inventario_cancelado');
        if (session.mobileSocketId) io.to(session.mobileSocketId).emit('inventario_cancelado');

        // Limpiar sesión inmediatamente
        inventarioSesiones.delete(sessionId);
        console.log('🗑️ [WS] Sesión eliminada por cancelación');
    });

    // Limpiar cuando se desconectan
    socket.on('disconnect', () => {
        const tiempoDesconexion = Date.now();
        console.log('👋 [WS] ===== CLIENTE DESCONECTADO =====');
        console.log('🔌 [WS] Socket ID:', socket.id);
        console.log('⏱️ [WS] Timestamp desconexión:', new Date(tiempoDesconexion).toISOString());

        // Limpiar sesiones donde este socket era parte
        for (const [sessionId, session] of inventarioSesiones.entries()) {
            if (session.pcSocketId === socket.id) {
                console.log('💻 [WS] PC desconectada de sesión:', sessionId);

                // CORRECCIÓN: No eliminar inmediatamente, dar tiempo para reconexión
                session.estado = 'esperando_reconexion';
                session.timestampDesconexion = tiempoDesconexion;

                // Si se desconecta la PC, notificar al móvil pero NO cerrar sesión aún
                if (session.mobileSocketId) {
                    console.log('📱 [WS] Notificando al móvil sobre desconexión temporal de PC');
                    io.to(session.mobileSocketId).emit('pc_desconectada_temporal', {
                        mensaje: 'PC desconectada temporalmente. Esperando reconexión...'
                    });
                }

                // CORRECCIÓN: Aumentar timeout de 5s a 60s para permitir reconexiones
                setTimeout(() => {
                    const sesionActual = inventarioSesiones.get(sessionId);
                    // Solo eliminar si sigue en estado de espera (no se reconectó)
                    if (sesionActual && sesionActual.estado === 'esperando_reconexion') {
                        console.log('🗑️ [WS] Sesión eliminada por timeout (60s sin reconexión):', sessionId);
                        inventarioSesiones.delete(sessionId);

                        // Notificar al móvil que la sesión expiró definitivamente
                        if (sesionActual.mobileSocketId) {
                            io.to(sesionActual.mobileSocketId).emit('sesion_expirada', {
                                mensaje: 'La sesión ha expirado. La PC no se reconectó.'
                            });
                        }
                    } else if (sesionActual) {
                        console.log('✅ [WS] Sesión se reconectó exitosamente, no se eliminó:', sessionId);
                    }
                }, 60000); // 60 segundos en lugar de 5

            } else if (session.mobileSocketId === socket.id) {
                console.log('📱 [WS] Móvil desconectado de sesión:', sessionId);
                // Si se desconecta el móvil, notificar a la PC
                io.to(session.pcSocketId).emit('movil_desconectado');
                delete session.mobileSocketId;
            }
        }

        console.log('📊 [WS] Sesiones activas restantes:', inventarioSesiones.size);
    });
});

// Puerto
const PORT = process.env.PORT || 3002;

httpServer.listen(PORT, '0.0.0.0', () => {
    console.log(`Servidor de producción corriendo en puerto ${PORT}`);
});
