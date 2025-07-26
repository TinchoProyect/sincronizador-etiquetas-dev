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

    // PC inicia una sesión de inventario
    socket.on('iniciar_inventario', (data) => {
        const sessionId = data.sessionId;
        const usuario = data.usuario || null;
        
        console.log('🚀 [WS] ===== NUEVA SESIÓN DE INVENTARIO =====');
        console.log('🆔 [WS] Session ID:', sessionId);
        console.log('👤 [WS] Usuario:', usuario);
        console.log('🔌 [WS] Socket PC:', socket.id);
        
        // Verificar si ya existe la sesión
        if (inventarioSesiones.has(sessionId)) {
            console.log('⚠️ [WS] Sesión existente, actualizando datos...');
            const sesionExistente = inventarioSesiones.get(sessionId);
            sesionExistente.pcSocketId = socket.id;
            sesionExistente.usuario = usuario;
        } else {
            console.log('✨ [WS] Creando nueva sesión...');
            inventarioSesiones.set(sessionId, {
                pcSocketId: socket.id,
                usuario: usuario,
                items: new Map(),
                fechaInicio: new Date(),
                estado: 'activa'
            });
        }
        
        socket.emit('inventario_iniciado', { sessionId, usuario });
        console.log('✅ [WS] Sesión iniciada exitosamente');
        console.log('📊 [WS] Total sesiones activas:', inventarioSesiones.size);
    });

    // Móvil se une a una sesión
    socket.on('unirse_inventario', (data) => {
        const sessionId = data.sessionId;
        console.log('📱 [WS] ===== MÓVIL INTENTANDO UNIRSE =====');
        console.log('🆔 [WS] Session ID solicitado:', sessionId);
        console.log('🔌 [WS] Socket Móvil:', socket.id);
        console.log('📊 [WS] Sesiones activas:', Array.from(inventarioSesiones.keys()));
        console.log('🔍 [WS] Datos completos recibidos del móvil:', JSON.stringify(data, null, 2));
        
        const session = inventarioSesiones.get(sessionId);
        
        if (session) {
            console.log('✅ [WS] Datos de la sesión encontrada:');
            console.log('- Usuario:', session.usuario);
            console.log('- Estado:', session.estado);
            console.log('- Fecha inicio:', session.fechaInicio);
            console.log('- PC Socket:', session.pcSocketId);
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
        console.log('👤 [WS] Usuario de la sesión:', session.usuario);
        
        // Registrar el móvil en la sesión
        session.mobileSocketId = socket.id;
        
        // Confirmar conexión al móvil
        socket.emit('conexion_exitosa', { 
            sessionId, 
            usuario: session.usuario 
        });
        
        // Notificar a la PC
        io.to(session.pcSocketId).emit('movil_conectado', {
            mensaje: 'Dispositivo móvil conectado',
            socketId: socket.id
        });
        
        console.log('🎉 [WS] Móvil conectado exitosamente a la sesión');
    });

    // Móvil envía un artículo escaneado
    socket.on('articulo_escaneado', (data) => {
        const { sessionId, articulo, cantidad } = data;
        console.log('📦 [WS] ===== NUEVO ARTÍCULO ESCANEADO =====');
        console.log('🆔 [WS] Session ID:', sessionId);
        console.log('📝 [WS] Artículo:', articulo?.nombre);
        console.log('🔢 [WS] Cantidad:', cantidad);
        
        const session = inventarioSesiones.get(sessionId);
        
        if (!session) {
            console.error('❌ [WS] Error: Sesión no encontrada para artículo');
            socket.emit('error_conexion', { mensaje: 'Sesión no válida' });
            return;
        }
        
        if (session.estado !== 'activa') {
            console.error('❌ [WS] Error: Sesión no activa para artículo');
            socket.emit('error_conexion', { mensaje: 'La sesión no está activa' });
            return;
        }
        
        // Guardar en la sesión
        const key = articulo.numero;
        session.items.set(key, { 
            articulo, 
            cantidad, 
            timestamp: new Date() 
        });
        
        console.log('📤 [WS] Enviando artículo a PC...');
        // Enviar a la PC
        io.to(session.pcSocketId).emit('nuevo_articulo', { 
            sessionId,
            articulo, 
            cantidad,
            timestamp: new Date()
        });
        
        // Confirmar al móvil
        socket.emit('articulo_confirmado', {
            articulo: articulo.nombre,
            cantidad
        });
        
        console.log('✅ [WS] Artículo procesado exitosamente');
        console.log('📊 [WS] Total artículos en sesión:', session.items.size);
    });

    // PC finaliza inventario
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

    // ===== EVENTOS PARA INVENTARIO DE INGREDIENTES =====
    
    // PC inicia una sesión de inventario de ingredientes
    socket.on('iniciar_inventario_ingredientes', (data) => {
        const { sessionId, usuario, sectores } = data;
        
        console.log('🧪 [WS] ===== NUEVA SESIÓN DE INVENTARIO DE INGREDIENTES =====');
        console.log('🆔 [WS] Session ID:', sessionId);
        console.log('👤 [WS] Usuario:', usuario);
        console.log('🏷️ [WS] Sectores:', sectores);
        console.log('🔌 [WS] Socket PC:', socket.id);
        
        // Unir socket al sessionId para comunicación grupal
        socket.join(sessionId);
        
        // Verificar si ya existe la sesión
        if (inventarioSesiones.has(sessionId)) {
            console.log('⚠️ [WS] Sesión de ingredientes existente, actualizando datos...');
            const sesionExistente = inventarioSesiones.get(sessionId);
            sesionExistente.pcSocketId = socket.id;
            sesionExistente.usuario = usuario;
            sesionExistente.sectores = sectores;
            sesionExistente.tipo = 'ingredientes';
        } else {
            console.log('✨ [WS] Creando nueva sesión de ingredientes...');
            inventarioSesiones.set(sessionId, {
                pcSocketId: socket.id,
                usuario: usuario,
                sectores: sectores,
                items: new Map(),
                fechaInicio: new Date(),
                estado: 'activa',
                tipo: 'ingredientes'
            });
        }
        
        // Emitir confirmación al socket origen
        socket.emit('inventario_ingredientes_iniciado', { 
            sessionId, 
            usuario, 
            sectores 
        });
        
        console.log('✅ [WS] Sesión de inventario de ingredientes iniciada exitosamente');
        console.log('📊 [WS] Total sesiones activas:', inventarioSesiones.size);
    });

    // Móvil envía un ingrediente escaneado
    socket.on('escanear_ingrediente_movil', (data) => {
        const { sessionId, ingrediente, cantidad } = data;
        
        console.log('📱 [WS] ===== INGREDIENTE ESCANEADO DESDE MÓVIL =====');
        console.log('🆔 [WS] Session ID:', sessionId);
        console.log('🧪 [WS] Ingrediente:', ingrediente?.nombre || 'Sin nombre');
        console.log('🔢 [WS] Cantidad:', cantidad);
        
        const session = inventarioSesiones.get(sessionId);
        
        if (!session) {
            console.error('❌ [WS] Error: Sesión de ingredientes no encontrada');
            socket.emit('error_conexion', { mensaje: 'Sesión no válida' });
            return;
        }
        
        if (session.estado !== 'activa') {
            console.error('❌ [WS] Error: Sesión de ingredientes no activa');
            socket.emit('error_conexion', { mensaje: 'La sesión no está activa' });
            return;
        }
        
        if (session.tipo !== 'ingredientes') {
            console.error('❌ [WS] Error: Sesión no es de tipo ingredientes');
            socket.emit('error_conexion', { mensaje: 'Tipo de sesión incorrecto' });
            return;
        }
        
        // Guardar en la sesión
        const key = ingrediente.id || ingrediente.codigo;
        session.items.set(key, { 
            ingrediente, 
            cantidad, 
            timestamp: new Date() 
        });
        
        console.log('📤 [WS] Enviando ingrediente a grupo de sesión...');
        
        // Enviar evento al grupo del sessionId (PC y otros dispositivos conectados)
        io.to(sessionId).emit('nuevo_ingrediente', { 
            sessionId,
            ingrediente, 
            cantidad,
            timestamp: new Date()
        });
        
        // Confirmar al móvil
        socket.emit('ingrediente_confirmado', {
            ingrediente: ingrediente.nombre,
            cantidad
        });
        
        console.log('✅ [WS] Ingrediente procesado exitosamente');
        console.log('📊 [WS] Total ingredientes en sesión:', session.items.size);
    });

    // Limpiar cuando se desconectan
    socket.on('disconnect', () => {
        console.log('👋 [WS] ===== CLIENTE DESCONECTADO =====');
        console.log('🔌 [WS] Socket ID:', socket.id);
        
        // Limpiar sesiones donde este socket era parte
        for (const [sessionId, session] of inventarioSesiones.entries()) {
            if (session.pcSocketId === socket.id) {
                console.log('💻 [WS] PC desconectada de sesión:', sessionId);
                // Si se desconecta la PC, notificar al móvil
                if (session.mobileSocketId) {
                    console.log('📱 [WS] Notificando al móvil sobre desconexión de PC');
                    io.to(session.mobileSocketId).emit('pc_desconectada');
                }
                // Marcar sesión como finalizada
                session.estado = 'finalizada';
                // Eliminar después de un breve delay
                setTimeout(() => {
                    inventarioSesiones.delete(sessionId);
                    console.log('🗑️ [WS] Sesión eliminada:', sessionId);
                }, 5000);
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
