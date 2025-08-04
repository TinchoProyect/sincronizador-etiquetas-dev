const express = require('express');
const cors = require('cors');
const path = require('path');

console.log('🚀 [PRESUPUESTOS] Iniciando servidor del módulo de presupuestos...');

const app = express();
const PORT = process.env.PORT || 3003;

// Importar configuraciones y middleware
const { dbMiddleware } = require('./config/database');
const { requestLogger, errorHandler } = require('./middleware/auth');

// Importar rutas
const presupuestosRoutes = require('./routes/presupuestos');

console.log('🔍 [PRESUPUESTOS] Configurando middleware...');

// Configuración CORS para permitir comunicación con otros módulos del sistema
const corsOptions = {
    origin: [
        'http://localhost:3000',  // Servidor principal de etiquetas
        'http://localhost:3002',  // Servidor de producción
        'http://localhost:3003'   // Este mismo servidor (para desarrollo)
    ],
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
    credentials: true
};

app.use(cors(corsOptions));
console.log('✅ [PRESUPUESTOS] CORS configurado para orígenes:', corsOptions.origin);

// Middleware básico
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

// Middleware de logging personalizado
app.use(requestLogger);

// Middleware de base de datos
app.use(dbMiddleware);

// Configurar archivos estáticos
const staticPath = path.join(__dirname);
app.use(express.static(staticPath));
app.use('/pages', express.static(path.join(staticPath, 'pages')));
app.use('/js', express.static(path.join(staticPath, 'js')));
app.use('/css', express.static(path.join(staticPath, 'css')));

console.log('📁 [PRESUPUESTOS] Archivos estáticos configurados desde:', staticPath);

// Ruta raíz - redirigir a la página principal del módulo
app.get('/', (req, res) => {
    console.log('🔍 [PRESUPUESTOS] Acceso a ruta raíz - redirigiendo a página principal');
    res.redirect('/pages/presupuestos.html');
});

// Rutas API
app.use('/api/presupuestos', presupuestosRoutes);
console.log('✅ [PRESUPUESTOS] Rutas API montadas en /api/presupuestos');

// Ruta de health check general del servidor
app.get('/health', (req, res) => {
    console.log('🔍 [PRESUPUESTOS] Health check del servidor');
    
    res.json({
        success: true,
        service: 'presupuestos-server',
        status: 'running',
        port: PORT,
        timestamp: new Date().toISOString(),
        uptime: process.uptime(),
        memory: process.memoryUsage(),
        version: '1.0.0'
    });
});

// Middleware para rutas no encontradas
app.use('*', (req, res) => {
    console.log(`⚠️ [PRESUPUESTOS] Ruta no encontrada: ${req.method} ${req.originalUrl}`);
    
    res.status(404).json({
        success: false,
        error: 'Recurso no encontrado',
        path: req.originalUrl,
        method: req.method,
        service: 'presupuestos-server',
        timestamp: new Date().toISOString()
    });
});

// Middleware de manejo de errores (debe ir al final)
app.use(errorHandler);

// Iniciar servidor
const server = app.listen(PORT, () => {
    console.log('🎉 [PRESUPUESTOS] ================================');
    console.log('🎉 [PRESUPUESTOS] SERVIDOR INICIADO EXITOSAMENTE');
    console.log('🎉 [PRESUPUESTOS] ================================');
    console.log(`🌐 [PRESUPUESTOS] URL: http://localhost:${PORT}`);
    console.log(`📊 [PRESUPUESTOS] API: http://localhost:${PORT}/api/presupuestos`);
    console.log(`🏥 [PRESUPUESTOS] Health: http://localhost:${PORT}/health`);
    console.log(`📁 [PRESUPUESTOS] Archivos estáticos: ${staticPath}`);
    console.log('🎉 [PRESUPUESTOS] ================================');
});

// Manejo de errores del servidor
server.on('error', (error) => {
    if (error.code === 'EADDRINUSE') {
        console.error(`❌ [PRESUPUESTOS] Puerto ${PORT} ya está en uso`);
        console.error('❌ [PRESUPUESTOS] Verifique que no haya otro proceso usando este puerto');
    } else {
        console.error('❌ [PRESUPUESTOS] Error del servidor:', error);
    }
    process.exit(1);
});

// Manejo de cierre graceful
process.on('SIGTERM', () => {
    console.log('🔄 [PRESUPUESTOS] Recibida señal SIGTERM, cerrando servidor...');
    server.close(() => {
        console.log('✅ [PRESUPUESTOS] Servidor cerrado exitosamente');
        process.exit(0);
    });
});

process.on('SIGINT', () => {
    console.log('🔄 [PRESUPUESTOS] Recibida señal SIGINT, cerrando servidor...');
    server.close(() => {
        console.log('✅ [PRESUPUESTOS] Servidor cerrado exitosamente');
        process.exit(0);
    });
});

// Manejo de errores no capturados
process.on('uncaughtException', (error) => {
    console.error('❌ [PRESUPUESTOS] Error no capturado:', error);
    process.exit(1);
});

process.on('unhandledRejection', (reason, promise) => {
    console.error('❌ [PRESUPUESTOS] Promesa rechazada no manejada:', reason);
    console.error('❌ [PRESUPUESTOS] En promesa:', promise);
});

module.exports = app;
