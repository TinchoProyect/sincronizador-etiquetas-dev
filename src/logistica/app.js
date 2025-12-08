require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');

console.log('[LOGISTICA] 🚀 Iniciando servidor del módulo de logística...');

const app = express();
const PORT = process.env.PORT_LOGISTICA || 3005;

// Importar configuraciones y middleware
const { dbMiddleware } = require('./config/database');

console.log('[LOGISTICA] Configurando middleware...');

/**
 * Configuración CORS
 * Permite comunicación con otros módulos del sistema y acceso desde app móvil vía Ngrok
 */
const corsOptions = {
    origin: function (origin, callback) {
        // Lista de orígenes permitidos
        const allowedOrigins = [
            'http://localhost:3000',  // Servidor principal de etiquetas
            'http://localhost:3002',  // Servidor de producción
            'http://localhost:3003',  // Servidor de presupuestos
            'http://localhost:3004',  // Servidor de facturación
            'http://localhost:3005',  // Este mismo servidor (para desarrollo)
        ];
        
        // Agregar URL de Ngrok si está configurada
        if (process.env.NGROK_URL) {
            allowedOrigins.push(process.env.NGROK_URL);
            console.log('[LOGISTICA] ✅ Ngrok URL agregada a CORS:', process.env.NGROK_URL);
        }
        
        // Agregar CORS_ORIGIN adicional si está configurada
        if (process.env.CORS_ORIGIN) {
            allowedOrigins.push(process.env.CORS_ORIGIN);
            console.log('[LOGISTICA] ✅ CORS_ORIGIN adicional agregado:', process.env.CORS_ORIGIN);
        }
        
        // En desarrollo, permitir cualquier origen si no hay origin (ej: Postman, curl)
        if (!origin || allowedOrigins.indexOf(origin) !== -1) {
            callback(null, true);
        } else {
            console.warn('[LOGISTICA] ⚠️ Origen no permitido:', origin);
            callback(new Error('No permitido por CORS'));
        }
    },
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
    credentials: true
};

app.use(cors(corsOptions));
console.log('[LOGISTICA] ✅ CORS configurado');

// Middleware básico
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Middleware de logging personalizado
app.use((req, res, next) => {
    const timestamp = new Date().toISOString();
    console.log(`[LOGISTICA] ${timestamp} - ${req.method} ${req.path}`);
    next();
});

// Middleware de base de datos
app.use(dbMiddleware);

// Configurar archivos estáticos
const staticPath = path.join(__dirname);
app.use(express.static(staticPath));
app.use('/pages', express.static(path.join(staticPath, 'pages')));
app.use('/js', express.static(path.join(staticPath, 'js')));
app.use('/css', express.static(path.join(staticPath, 'css')));

console.log('[LOGISTICA] 📁 Archivos estáticos configurados desde:', staticPath);

// Ruta raíz - redirigir al dashboard
app.get('/', (req, res) => {
    console.log('[LOGISTICA] Acceso a ruta raíz - redirigiendo a dashboard');
    res.redirect('/pages/dashboard.html');
});

// Rutas API
console.log('[LOGISTICA] Montando rutas API...');

// Rutas de Domicilios
app.use('/api/logistica/domicilios', require('./routes/domicilios'));
console.log('[LOGISTICA] ✅ Rutas de Domicilios montadas en /api/logistica/domicilios');

// Rutas de Rutas
app.use('/api/logistica/rutas', require('./routes/rutas'));
console.log('[LOGISTICA] ✅ Rutas de Rutas montadas en /api/logistica/rutas');

// Rutas de Configuración
app.use('/api/logistica/config', require('./routes/config'));
console.log('[LOGISTICA] ✅ Rutas de Configuración montadas en /api/logistica/config');

// Rutas de Presupuestos
app.use('/api/logistica/presupuestos', require('./routes/presupuestos'));
console.log('[LOGISTICA] ✅ Rutas de Presupuestos montadas en /api/logistica/presupuestos');

// Rutas de Diagnóstico (desarrollo)
app.use('/api/logistica/diagnostico', require('./routes/diagnostico-secuencia'));
console.log('[LOGISTICA] ✅ Rutas de Diagnóstico montadas en /api/logistica/diagnostico');

// Rutas pendientes de implementación
// app.use('/api/logistica/movil', require('./routes/movil'));

console.log('[LOGISTICA] ⚠️ Rutas de Móvil pendientes de implementación');

// Ruta de health check
app.get('/health', (req, res) => {
    console.log('[LOGISTICA] Health check del servidor');
    
    res.json({
        success: true,
        service: 'logistica-server',
        status: 'running',
        port: PORT,
        timestamp: new Date().toISOString(),
        uptime: process.uptime(),
        memory: process.memoryUsage(),
        version: '1.0.0',
        database: {
            name: process.env.DB_NAME || 'etiquetas',
            host: process.env.DB_HOST || 'localhost'
        },
        features: {
            domicilios: true,   // ✅ Implementado
            rutas: true,        // ✅ Implementado
            movil: false,       // Pendiente
            tracking: false,    // Pendiente
            optimizacion: false // Pendiente
        },
        google_maps: {
            api_key_configured: !!process.env.GOOGLE_MAPS_API_KEY
        },
        ngrok: {
            url_configured: !!process.env.NGROK_URL,
            url: process.env.NGROK_URL || 'No configurada'
        }
    });
});

// Middleware para rutas no encontradas
app.use('*', (req, res) => {
    console.log(`[LOGISTICA] ⚠️ Ruta no encontrada: ${req.method} ${req.originalUrl}`);
    
    res.status(404).json({
        success: false,
        error: 'Recurso no encontrado',
        path: req.originalUrl,
        method: req.method,
        service: 'logistica-server',
        timestamp: new Date().toISOString()
    });
});

// Middleware de manejo de errores (debe ir al final)
app.use((err, req, res, next) => {
    console.error('[LOGISTICA] ❌ Error no manejado:', err.message);
    console.error('[LOGISTICA] ❌ Stack:', err.stack);
    
    res.status(err.status || 500).json({
        success: false,
        error: err.message || 'Error interno del servidor',
        service: 'logistica-server',
        timestamp: new Date().toISOString()
    });
});

// Iniciar servidor
const server = app.listen(PORT, () => {
    console.log('[LOGISTICA] 🎉 ================================');
    console.log('[LOGISTICA] 🎉 SERVIDOR INICIADO EXITOSAMENTE');
    console.log('[LOGISTICA] 🎉 ================================');
    console.log(`[LOGISTICA] 🌐 URL: http://localhost:${PORT}`);
    console.log(`[LOGISTICA] 🏥 Health: http://localhost:${PORT}/health`);
    console.log(`[LOGISTICA] 📁 Archivos estáticos: ${staticPath}`);
    console.log('[LOGISTICA] 📊 Base de datos:', process.env.DB_NAME || 'etiquetas');
    console.log('[LOGISTICA] 🌍 Entorno:', process.env.NODE_ENV || 'production');
    
    if (process.env.NGROK_URL) {
        console.log('[LOGISTICA] 🌐 Ngrok URL:', process.env.NGROK_URL);
    } else {
        console.log('[LOGISTICA] ⚠️ Ngrok URL no configurada (variable NGROK_URL)');
    }
    
    console.log('[LOGISTICA] 🎉 ================================');
});

// Manejo de errores del servidor
server.on('error', (error) => {
    if (error.code === 'EADDRINUSE') {
        console.error(`[LOGISTICA] ❌ Puerto ${PORT} ya está en uso`);
        console.error('[LOGISTICA] ❌ Verifique que no haya otro proceso usando este puerto');
    } else {
        console.error('[LOGISTICA] ❌ Error del servidor:', error);
    }
    process.exit(1);
});

// Manejo de cierre graceful
process.on('SIGTERM', () => {
    console.log('[LOGISTICA] 🔄 Recibida señal SIGTERM, cerrando servidor...');
    server.close(() => {
        console.log('[LOGISTICA] ✅ Servidor cerrado exitosamente');
        process.exit(0);
    });
});

process.on('SIGINT', () => {
    console.log('[LOGISTICA] 🔄 Recibida señal SIGINT, cerrando servidor...');
    server.close(() => {
        console.log('[LOGISTICA] ✅ Servidor cerrado exitosamente');
        process.exit(0);
    });
});

// Manejo de errores no capturados
process.on('uncaughtException', (error) => {
    console.error('[LOGISTICA] ❌ Error no capturado:', error);
    process.exit(1);
});

process.on('unhandledRejection', (reason, promise) => {
    console.error('[LOGISTICA] ❌ Promesa rechazada no manejada:', reason);
    console.error('[LOGISTICA] ❌ En promesa:', promise);
});

module.exports = app;
