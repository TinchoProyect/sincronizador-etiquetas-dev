require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const { createProxyMiddleware } = require('http-proxy-middleware');

console.log('[LOGISTICA] 🚀 Iniciando servidor del módulo de logística...');

const app = express();
const PORT = process.env.PORT_LOGISTICA || 3005;

// Importar configuraciones y middleware
const { dbMiddleware } = require('./config/database');

console.log('[LOGISTICA] Configurando middleware...');

/**
 * ==========================================
 * CONFIGURACIÓN CORS — TOPOLOGÍA DE RED
 * ==========================================
 * 
 * INFRAESTRUCTURA:
 *   - El sistema LAMDA está desplegado detrás de un router TP-Link con DDNS habilitado.
 *   - Dominio externo oficial: lamda-logistica.tplinkdns.com
 *   - Puerto de salida público (Port Forwarding): 3005 -> IP local del host
 *   - El host (app.listen) DEBE mantenerse siempre en '0.0.0.0' para aceptar
 *     tráfico de todas las interfaces de red (LAN, Wi-Fi, WAN vía Port Forwarding).
 *     NUNCA regresar a 'localhost' o '127.0.0.1', ya que bloquearía el acceso externo.
 * 
 * ORÍGENES PERMITIDOS:
 *   - localhost:30XX  → Comunicación inter-módulos en el mismo host
 *   - 127.0.0.1:30XX  → Alias loopback para módulos locales
 *   - lamda-logistica.tplinkdns.com:3005 → Acceso externo vía DDNS (HTTP y HTTPS)
 *   - lamda-logistica.tplinkdns.com (sin puerto) → Fallback si el router redirige al 80
 * ==========================================
 */
const allowedOrigins = [
    // --- Módulos locales (inter-proceso en el mismo servidor) ---
    'http://localhost:3000',
    'http://localhost:3002',
    'http://localhost:3003',
    'http://localhost:3004',
    'http://localhost:3005',
    'http://127.0.0.1:3000',
    'http://127.0.0.1:3002',
    'http://127.0.0.1:3003',
    'http://127.0.0.1:3004',
    'http://127.0.0.1:3005',
    // --- Acceso por IP local (dispositivos móviles en la misma red LAN) ---
    'http://192.168.1.178:3000',
    'http://192.168.1.178:3002',
    'http://192.168.1.178:3003',
    'http://192.168.1.178:3004',
    'http://192.168.1.178:3005',
    // --- Acceso externo vía DDNS (router TP-Link con Port Forwarding) ---
    'http://lamda-logistica.tplinkdns.com:3005',
    'https://lamda-logistica.tplinkdns.com:3005',
    'http://lamda-logistica.tplinkdns.com'
];

const corsOptions = {
    origin: function (origin, callback) {
        // Permitir requests sin origin (ej. apps móviles nativas, Postman, curl)
        if (!origin || allowedOrigins.includes(origin)) {
            callback(null, true);
        } else {
            console.warn(`[CORS] Origen denegado: ${origin}`);
            callback(new Error('CORS: origen no permitido'));
        }
    },
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
    credentials: true
};

app.use(cors(corsOptions));
console.log('[LOGISTICA] ✅ CORS configurado');

// CUIDADO: El Middleware json() debe ir DESPUÉS de los Proxys
// para evitar el Falso Silencioso en Peticiones POST donde el Proxy
// se queda infinito esperando un Body Stream que ya fue consumido.
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

// ==========================================
// 🛡️ REVERSE PROXIES (Microservicios)
// ==========================================
console.log('[LOGISTICA] 🔗 Inicializando Reverse Proxies para Integraciones Cruzadas...');

// Proxy para la interfaz de Usuario (HTML/CSS) de Presupuestos
app.use('/presupuestos', createProxyMiddleware({
    target: 'http://localhost:3003',
    changeOrigin: true,
    pathRewrite: {
        '^/presupuestos': '', // Remueve /presupuestos cuando llega al 3003
    },
    onError: (err, req, res) => {
        console.error('[LOGISTICA] ❌ Error en Proxy de Presupuestos (UI):', err.message);
        res.status(503).send('Módulo de presupuestos fuera de línea.');
    }
}));

// Proxy para las transacciones API de Presupuestos
app.use('/api/presupuestos', createProxyMiddleware({
    target: 'http://localhost:3003',
    changeOrigin: true,
    pathRewrite: (path, req) => {
        // Restauramos el prefijo que Express elimina para que enganche al router del 3003
        return '/api/presupuestos' + req.url; 
    },
    onError: (err, req, res) => {
        console.error('[LOGISTICA] ❌ Error en Proxy de Presupuestos (API):', err.message);
        res.status(503).json({ error: 'Módulo de presupuestos fuera de línea.' });
    }
}));
// ==========================================

// Middleware básico (Parseo de Body para RUTAS NATIVAS de Logística)
// Se inyecta aquí para no interferir con el parseo en crudo del Proxy.
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Ruta raíz - redirigir al dashboard
app.get('/', (req, res) => {
    console.log('[LOGISTICA] Acceso a ruta raíz - redirigiendo a dashboard');
    res.redirect('/pages/dashboard.html');
});

// Solución dinámica para inyección de IP Pública en Frontend
app.get('/env-config.js', (req, res) => {
    // Configuración que se inyecta nativamente en el window del frontend
    const publicUrl = process.env.PUBLIC_BASE_URL || 'http://localhost:3005';
    res.type('.js');
    res.send(`window.PUBLIC_BASE_URL = "${publicUrl}";`);
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

// Rutas de Artículos
app.use('/api/logistica/articulos', require('./routes/articulos'));
console.log('[LOGISTICA] ✅ Rutas de Artículos montadas en /api/logistica/articulos');

// Rutas del Búnker (Core Financiero)
app.use('/api/logistica/bunker', require('./routes/bunker'));
console.log('[LOGISTICA] ✅ Rutas del Búnker montadas en /api/logistica/bunker');

// Rutas del Diccionario ABM Búnker
app.use('/api/logistica/bunker-diccionario', require('./routes/bunkerDiccionario'));
console.log('[LOGISTICA] ✅ Rutas ABM de Diccionario montadas en /api/logistica/bunker-diccionario');

// Rutas de Taxonomía Búnker (Rubros/Subrubros)
app.use('/api/logistica/bunker-taxonomia', require('./routes/bunkerTaxonomia'));
console.log('[LOGISTICA] ✅ Rutas de Taxonomía montadas en /api/logistica/bunker-taxonomia');

// Rutas de Presupuestos
app.use('/api/logistica/presupuestos', require('./routes/presupuestos'));
console.log('[LOGISTICA] ✅ Rutas de Presupuestos montadas en /api/logistica/presupuestos');

// Rutas de Usuarios
app.use('/api/logistica/usuarios', require('./routes/usuarios'));
console.log('[LOGISTICA] ✅ Rutas de Usuarios montadas en /api/logistica/usuarios');

// Rutas de Móvil
app.use('/api/logistica/movil', require('./routes/movil'));
console.log('[LOGISTICA] ✅ Rutas de Móvil montadas en /api/logistica/movil');

// Rutas de Diagnóstico (desarrollo)
app.use('/api/logistica/diagnostico', require('./routes/diagnostico-secuencia'));
console.log('[LOGISTICA] ✅ Rutas de Diagnóstico montadas en /api/logistica/diagnostico');

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

/**
 * ==========================================
 * INICIALIZACIÓN DEL SERVIDOR — BINDING DE RED
 * ==========================================
 * Host: '0.0.0.0' → Escucha en TODAS las interfaces de red del host.
 * Esto es OBLIGATORIO porque el sistema está detrás de un router TP-Link
 * con Port Forwarding (puerto 3005 → IP local del host) y DDNS habilitado
 * en el dominio: lamda-logistica.tplinkdns.com
 * 
 * ⚠️ NUNCA cambiar '0.0.0.0' por 'localhost' o '127.0.0.1'.
 *    Hacerlo bloquearía todo el tráfico externo (móviles, red LAN, WAN).
 * ==========================================
 */
const server = app.listen(PORT, '0.0.0.0', () => {
    console.log('[LOGISTICA] 🎉 ================================');
    console.log('[LOGISTICA] 🎉 SERVIDOR INICIADO EXITOSAMENTE');
    console.log('[LOGISTICA] 🎉 ================================');
    console.log(`[LOGISTICA] 🌐 URL Local: http://localhost:${PORT}`);
    console.log(`[LOGISTICA] 🏥 Health: http://localhost:${PORT}/health`);
    console.log(`[LOGISTICA] 📁 Archivos estáticos: ${staticPath}`);
    console.log('[LOGISTICA] 📊 Base de datos:', process.env.DB_NAME || 'etiquetas');
    console.log('[LOGISTICA] 🌍 Entorno:', process.env.NODE_ENV || 'production');
    console.log('[LOGISTICA] 🎉 ================================\n');
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
    console.log('[LOGISTICA] 🔄 Recibida señal SIGINT (Ctrl+C), cerrando servidor...');
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
