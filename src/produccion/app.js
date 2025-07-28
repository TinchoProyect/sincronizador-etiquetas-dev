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

    // Detectar tipo de inventario por sessionId y manejar de forma unificada
    function detectarTipoInventario(sessionId) {
        return sessionId && sessionId.startsWith('inv_ing_') ? 'ingredientes' : 'articulos';
    }

    // PC inicia una sesión de inventario (UNIFICADO para artículos e ingredientes)
    socket.on('iniciar_inventario', (data) => {
        const sessionId = data.sessionId;
        const usuario = data.usuario || null;
        const sectores = data.sectores || null; // Para ingredientes
        const tipoInventario = detectarTipoInventario(sessionId);
        
        console.log(`🚀 [WS] ===== NUEVA SESIÓN DE INVENTARIO (${tipoInventario.toUpperCase()}) =====`);
        console.log('🆔 [WS] Session ID:', sessionId);
        console.log('👤 [WS] Usuario:', usuario);
        console.log('🏷️ [WS] Sectores:', sectores);
        console.log('🔌 [WS] Socket PC:', socket.id);
        
        // Verificar si ya existe la sesión
        if (inventarioSesiones.has(sessionId)) {
            console.log('⚠️ [WS] Sesión existente, actualizando datos...');
            const sesionExistente = inventarioSesiones.get(sessionId);
            sesionExistente.pcSocketId = socket.id;
            sesionExistente.usuario = usuario;
            if (tipoInventario === 'ingredientes') {
                sesionExistente.sectores = sectores;
                sesionExistente.tipo = 'ingredientes';
            }
        } else {
            console.log('✨ [WS] Creando nueva sesión...');
            const sesionData = {
                pcSocketId: socket.id,
                usuario: usuario,
                items: new Map(),
                fechaInicio: new Date(),
                estado: 'activa'
            };
            
            // Agregar datos específicos para ingredientes
            if (tipoInventario === 'ingredientes') {
                sesionData.sectores = sectores;
                sesionData.tipo = 'ingredientes';
            }
            
            inventarioSesiones.set(sessionId, sesionData);
        }
        
        // Emitir respuesta unificada con datos específicos según el tipo
        const respuesta = { sessionId, usuario };
        if (tipoInventario === 'ingredientes') {
            respuesta.sectores = sectores;
        }
        
        socket.emit('inventario_iniciado', respuesta);
        console.log(`✅ [WS] Sesión de ${tipoInventario} iniciada exitosamente`);
        console.log('📊 [WS] Total sesiones activas:', inventarioSesiones.size);
    });

    // Móvil se une a una sesión (UNIFICADO)
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
            console.log('- Tipo:', session.tipo || 'articulos');
            console.log('- Sectores:', session.sectores);
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
        
        // Confirmar conexión al móvil con datos específicos según el tipo
        const respuestaConexion = { 
            sessionId, 
            usuario: session.usuario 
        };
        
        // Para ingredientes, incluir información de sectores
        if (session.tipo === 'ingredientes' && session.sectores) {
            respuestaConexion.sectores = session.sectores;
        }
        
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
