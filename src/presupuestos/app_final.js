const express = require('express');
const cors = require('cors');
const path = require('path');

console.log('[PRESUPUESTOS-BACK] 🚀 Iniciando servidor del módulo de presupuestos CON LOGS COMPLETOS...');

const app = express();
const PORT = process.env.PORT || 3003;

// Importar configuraciones y middleware
const { dbMiddleware } = require('./config/database');
const { requestLogger, errorHandler } = require('./middleware/auth');

// Importar rutas CON LOGS DE DEPURACIÓN COMPLETOS
const presupuestosRoutes = require('./routes/presupuestos_final_with_logs');

console.log('[PRESUPUESTOS-BACK] Configurando middleware...');

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
console.log('[PRESUPUESTOS-BACK] ✅ CORS configurado para orígenes:', corsOptions.origin);

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

console.log('[PRESUPUESTOS-BACK] 📁 Archivos estáticos configurados desde:', staticPath);

// Ruta raíz - redirigir a la página principal del módulo
app.get('/', (req, res) => {
    console.log('[PRESUPUESTOS-BACK] Acceso a ruta raíz - redirigiendo a página principal');
    res.redirect('/pages/presupuestos.html');
});

// Rutas API CON LOGS DE DEPURACIÓN COMPLETOS
app.use('/api/presupuestos', presupuestosRoutes);
console.log('[PRESUPUESTOS-BACK] ✅ Rutas API CON LOGS COMPLETOS montadas en /api/presupuestos');

// Ruta de health check general del servidor
app.get('/health', (req, res) => {
    console.log('[PRESUPUESTOS-BACK] Health check del servidor');
    
    res.json({
        success: true,
        service: 'presupuestos-server-final-with-logs',
        status: 'running',
        port: PORT,
        timestamp: new Date().toISOString(),
        uptime: process.uptime(),
        memory: process.memoryUsage(),
        version: '1.2.0-final-with-logs',
        features: {
            logs_detallados: true,
            google_sheets_debug: true,
            controladores_con_logs: true,
            rutas_con_logs: true
        }
    });
});

// Middleware para rutas no encontradas
app.use('*', (req, res) => {
    console.log(`[PRESUPUESTOS-BACK] ⚠️ Ruta no encontrada: ${req.method} ${req.originalUrl}`);
    
    res.status(404).json({
        success: false,
        error: 'Recurso no encontrado',
        path: req.originalUrl,
        method: req.method,
        service: 'presupuestos-server-final-with-logs',
        timestamp: new Date().toISOString()
    });
});

// Middleware de manejo de errores (debe ir al final)
app.use(errorHandler);

// Iniciar servidor
const server = app.listen(PORT, () => {
    console.log('[PRESUPUESTOS-BACK] 🎉 ================================');
    console.log('[PRESUPUESTOS-BACK] 🎉 SERVIDOR CON LOGS COMPLETOS INICIADO EXITOSAMENTE');
    console.log('[PRESUPUESTOS-BACK] 🎉 ================================');
    console.log(`[PRESUPUESTOS-BACK] 🌐 URL: http://localhost:${PORT}`);
    console.log(`[PRESUPUESTOS-BACK] 📊 API: http://localhost:${PORT}/api/presupuestos`);
    console.log(`[PRESUPUESTOS-BACK] 🏥 Health: http://localhost:${PORT}/health`);
    console.log(`[PRESUPUESTOS-BACK] 📁 Archivos estáticos: ${staticPath}`);
    console.log('[PRESUPUESTOS-BACK] 🔍 LOGS DE DEPURACIÓN COMPLETOS ACTIVADOS');
            console.log('[PRESUPUESTOS-BACK] 📋 Archivo objetivo: PresupuestosCopia');
    console.log('[PRESUPUESTOS-BACK] 🆔 ID esperado: 1r7VEnEArREqAGZiDxQCW4A0XIKb8qaxHXD0TlVhfuf8');
    console.log('[PRESUPUESTOS-BACK] 📂 Controladores: presupuestos_complete_with_logs.js + gsheets_with_logs.js');
    console.log('[PRESUPUESTOS-BACK] 🛣️ Rutas: presupuestos_final_with_logs.js');
    console.log('[PRESUPUESTOS-BACK] 🔧 Servicios: sync_complete_with_logs.js + auth_with_logs.js + client_with_logs.js');
    console.log('[PRESUPUESTOS-BACK] 🎉 ================================');
});

// Manejo de errores del servidor
server.on('error', (error) => {
    if (error.code === 'EADDRINUSE') {
        console.error(`[PRESUPUESTOS-BACK] ❌ Puerto ${PORT} ya está en uso`);
        console.error('[PRESUPUESTOS-BACK] ❌ Verifique que no haya otro proceso usando este puerto');
    } else {
        console.error('[PRESUPUESTOS-BACK] ❌ Error del servidor:', error);
    }
    process.exit(1);
});

// Manejo de cierre graceful
process.on('SIGTERM', () => {
    console.log('[PRESUPUESTOS-BACK] 🔄 Recibida señal SIGTERM, cerrando servidor...');
    server.close(() => {
        console.log('[PRESUPUESTOS-BACK] ✅ Servidor cerrado exitosamente');
        process.exit(0);
    });
});

process.on('SIGINT', () => {
    console.log('[PRESUPUESTOS-BACK] 🔄 Recibida señal SIGINT, cerrando servidor...');
    server.close(() => {
        console.log('[PRESUPUESTOS-BACK] ✅ Servidor cerrado exitosamente');
        process.exit(0);
    });
});

// Manejo de errores no capturados
process.on('uncaughtException', (error) => {
    console.error('[PRESUPUESTOS-BACK] ❌ Error no capturado:', error);
    process.exit(1);
});

process.on('unhandledRejection', (reason, promise) => {
    console.error('[PRESUPUESTOS-BACK] ❌ Promesa rechazada no manejada:', reason);
    console.error('[PRESUPUESTOS-BACK] ❌ En promesa:', promise);
});

module.exports = app;
