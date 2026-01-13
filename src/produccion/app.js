const express = require('express');
const cors = require('cors');
const path = require('path');
const { createServer } = require('http');
const { Server } = require('socket.io');
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

// Middleware
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
            usuario: session.usuario // Enviar objeto completo {id, nombre}
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

        // Confirmar al móvil usando evento unificado
        socket.emit('articulo_confirmado', {
            [tipoInventario === 'ingredientes' ? 'ingrediente' : 'articulo']: item.nombre,
            cantidad
        });

        console.log(`✅ [WS] ${tipoInventario.slice(0, -1)} procesado exitosamente`);
        console.log(`📊 [WS] Total items en sesión:`, session.items.size);
    });

    // PC finaliza inventario (UNIFICADO)
    socket.on('finalizar_inventario', (data) => {
        const sessionId = data.sessionId;
        console.log('🏁 [WS] ===== FINALIZANDO INVENTARIO =====');
        console.log('🆔 [WS] Session ID:', sessionId);

        const session = inventarioSesiones.get(sessionId);

        if (!session) {
            console.log('⚠️ [WS] No se encontró la sesión a finalizar');
            return;
        }

        // Marcar sesión como finalizada
        session.estado = 'finalizada';

        // Notificar al móvil si está conectado
        if (session.mobileSocketId) {
            console.log('📱 [WS] Notificando al móvil...');
            io.to(session.mobileSocketId).emit('inventario_finalizado', {
                mensaje: 'El inventario ha sido finalizado desde la PC'
            });
        }

        // Mantener la sesión por un tiempo antes de eliminarla
        setTimeout(() => {
            if (inventarioSesiones.has(sessionId)) {
                inventarioSesiones.delete(sessionId);
                console.log('🗑️ [WS] Sesión eliminada:', sessionId);
                console.log('📊 [WS] Sesiones restantes:', inventarioSesiones.size);
            }
        }, 5000); // Mantener por 5 segundos para asegurar que lleguen las notificaciones

        console.log('✅ [WS] Inventario finalizado correctamente');
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

httpServer.listen(PORT, () => {
    console.log(`Servidor de producción corriendo en puerto ${PORT}`);
});
