if (!globalThis.WebSocket) { try { globalThis.WebSocket = require('ws'); } catch (_) {} }
const express = require('express');
const cors = require('cors');
const path = require('path');

console.log('[PRESUPUESTOS-BACK] 🚀 Iniciando servidor del módulo de presupuestos CON LOGS COMPLETOS...');

const app = express();
const PORT = process.env.PORT || 3003;

// Importar configuraciones y middleware
const { dbMiddleware } = require('./config/database');
const { requestLogger, errorHandler } = require('./middleware/auth');
const { crearTablas } = require('./config/init-database');

// Importar scheduler de sincronización automática
const { start: startAutoSync, getHealth: getAutoSyncHealth } = require('./scheduler/auto_sync');

// Importar rutas CON LOGS DE DEPURACIÓN COMPLETOS
const presupuestosRoutes = require('./routes/presupuestos');
const gsheetsRoutes = require('./routes/gsheets');

console.log('[PRESUPUESTOS-BACK] Configurando middleware...');

/**
 * CONFIGURACIÓN CORS — TOPOLOGÍA DE RED
 * Dominio externo oficial: lamda-logistica.tplinkdns.com (DDNS TP-Link)
 * Puerto de salida público: 3005 (Port Forwarding en router)
 * Host binding: 0.0.0.0 (NUNCA cambiar a localhost, bloquearía acceso externo)
 */
const corsOptions = {
    origin: [
        'http://localhost:3000',  // Servidor principal de etiquetas
        'http://localhost:3002',  // Servidor de producción
        'http://localhost:3003',  // Este mismo servidor (para desarrollo)
        'http://localhost:3005',  // Logistica Front
        'http://127.0.0.1:3005',
        'http://localhost:5173',  // Portal B2B Vite Dev
        'http://127.0.0.1:5173',
        // --- Acceso externo seguro vía Cloudflare Tunnel (Dominio Oficial LAMDA) ---
        'https://logistica.lamdaser.com',
        'https://nube.lamdaser.com',
        'http://nube.lamdaser.com',
        'http://logistica.lamdaser.com',
        // --- Acceso externo vía DDNS (router TP-Link con Port Forwarding) ---
        'http://lamda-logistica.tplinkdns.com:3005',
        'https://lamda-logistica.tplinkdns.com:3005',
        'http://lamda-logistica.tplinkdns.com'
    ],
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
    credentials: true
};

app.use(cors(corsOptions));
console.log('[PRESUPUESTOS-BACK] ✅ CORS configurado para orígenes:', corsOptions.origin);

const { createProxyMiddleware } = require('http-proxy-middleware');

// Middleware básico
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

// 🛡️ Runtime Cloud 24/7 + Banner Modo Laboratorio + Bandeja Zebra
const { attachLamdaCloudRuntime } = require('../shared/lamdaCloudRuntime');
attachLamdaCloudRuntime(app, PORT);

// Proxy para el módulo de producción (3002) - Necesario para el endpoint del Kit SSOT
app.use('/api/produccion', createProxyMiddleware({
    target: 'http://localhost:3002/api/produccion',
    changeOrigin: true
}));

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

// Disparador reactivo automático en 2do plano hacia Portal B2B ante cambios de presupuestos, políticas u ofertas
const { createB2BAutoSyncMiddleware } = require('../actualizaPrecios/b2bAutoSyncTrigger');
app.use(createB2BAutoSyncMiddleware('presupuestos'));

// Rutas API CON LOGS DE DEPURACIÓN COMPLETOS
app.use('/api/presupuestos', presupuestosRoutes);

// Rutas del panel nuevo de Google Sheets (solo si está habilitado)
const { GSHEETS_PANEL_ENABLED } = require('../config/feature-flags');
if (GSHEETS_PANEL_ENABLED) {
    console.log('[PRESUPUESTOS-BACK] ✅ Panel nuevo de Google Sheets habilitado');
    app.use('/api/gsheets', gsheetsRoutes);
    console.log('[PRESUPUESTOS-BACK] ✅ Rutas Google Sheets montadas en /api/gsheets');
} else {
    console.log('[PRESUPUESTOS-BACK] ⚠️ Panel nuevo de Google Sheets deshabilitado por feature flag');
}

console.log('[PRESUPUESTOS-BACK] ✅ Rutas API CON LOGS COMPLETOS montadas en /api/presupuestos');

// Rutas de ofertas dinámicas accesibles en el módulo de presupuestos
try {
    const rutasOfertasDinamicas = require('../app-etiquetas/routes/ofertasDinamicasRoutes');
    app.use('/api', rutasOfertasDinamicas);
    console.log('[PRESUPUESTOS-BACK] ✅ Rutas de Ofertas Dinámicas montadas en /api');
} catch (eOfertasRoutes) {
    console.warn('[PRESUPUESTOS-BACK] ⚠️ No se pudieron montar rutas de Ofertas Dinámicas:', eOfertasRoutes.message);
}

// Proxy para actualizar destinatarios en el módulo de logística (puerto 3005)
app.patch('/api/logistica/bunker/clientes/:id/whatsapp-contacts', async (req, res) => {
    try {
        const { id } = req.params;
        const logisticaPort = process.env.PORT_LOGISTICA || 3005;
        const targetUrl = `http://localhost:${logisticaPort}/api/logistica/bunker/clientes/${id}/whatsapp-contacts`;
        console.log(`🔄 [PRESUPUESTOS-PROXY] Reenviando actualización de contactos del cliente ID ${id} a Logística (${targetUrl})...`);

        const response = await fetch(targetUrl, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(req.body)
        });

        const data = await response.json().catch(() => ({}));
        res.status(response.status).json(data);
    } catch (error) {
        console.error('❌ [PRESUPUESTOS-PROXY] Error al reenviar actualización a Logística:', error.message);
        res.status(500).json({ success: false, error: 'Servidor de logística no disponible', details: error.message });
    }
});

// Ruta de health check general del servidor
app.get('/health', (req, res) => {
    console.log('[PRESUPUESTOS-BACK] Health check del servidor');
    
    res.json({
        success: true,
        service: 'presupuestos-server-integrated-main',
        status: 'running',
        port: PORT,
        timestamp: new Date().toISOString(),
        uptime: process.uptime(),
        memory: process.memoryUsage(),
        version: '1.4.0-integrated-main-with-logs',
        features: {
            logs_detallados: true,
            google_sheets_debug: true,
            controladores_con_logs: true,
            rutas_con_logs: true,
            integrado_sistema_principal: true,
            punto_entrada_unico: true
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
        service: 'presupuestos-server-integrated-main',
        timestamp: new Date().toISOString()
    });
});

// Middleware de manejo de errores (debe ir al final)
app.use(errorHandler);

// Inicializar base de datos y servidor
const inicializarServidor = async () => {
    try {
        console.log('[PRESUPUESTOS-BACK] 🔧 INICIALIZANDO BASE DE DATOS...');
        
        // Inicializar base de datos ANTES de arrancar el servidor
        const dbResult = await crearTablas();
        console.log('[PRESUPUESTOS-BACK] ✅ Base de datos inicializada exitosamente:', dbResult);
        
        // Iniciar servidor DESPUÉS de inicializar BD
        const server = app.listen(PORT, '0.0.0.0', () => {
            console.log('[PRESUPUESTOS-BACK] 🎉 ================================');
            console.log('[PRESUPUESTOS-BACK] 🎉 SERVIDOR PRINCIPAL CON LOGS INICIADO EXITOSAMENTE');
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
            console.log('[PRESUPUESTOS-BACK] 🚀 PUNTO DE ENTRADA ÚNICO - Ejecutar con: npm start');
            console.log('[PRESUPUESTOS-BACK] 🎯 INTEGRADO AL SISTEMA PRINCIPAL LAMDA');
            console.log(`[PRESUPUESTOS-BACK] 📊 BD: ${dbResult.total_presupuestos} presupuestos existentes`);
            console.log('[PRESUPUESTOS-BACK] 🎉 ================================');
            
            // INICIAR SCHEDULER DE SINCRONIZACIÓN AUTOMÁTICA
            // NOTA: El scheduler siempre se inicia, pero solo ejecutará sincronizaciones
            //       si auto_sync_enabled = true en la tabla presupuestos_config
            try {
                console.log('[PRESUPUESTOS-BACK] 🔄 Iniciando scheduler de sincronización automática...');
                
                // Usar la misma instancia de base de datos que el resto del módulo
                const { pool } = require('./config/database');
                
                // Iniciar scheduler con la instancia compartida de BD
                startAutoSync(pool);
                
                console.log('[PRESUPUESTOS-BACK] ✅ Scheduler de sincronización automática iniciado');
                console.log('[PRESUPUESTOS-BACK] ⏰ Intervalo de verificación: 60 segundos');
                console.log('[PRESUPUESTOS-BACK] 📊 Estado: INACTIVO por defecto (auto_sync_enabled = false en BD)');
                console.log('[PRESUPUESTOS-BACK] 🔧 Para activar: usar modal de configuración en el frontend');
                console.log('[PRESUPUESTOS-BACK] 🔗 Usando instancia compartida de base de datos');
                
            } catch (schedulerError) {
                console.error('[PRESUPUESTOS-BACK] ❌ Error al iniciar scheduler:', schedulerError);
                console.error('[PRESUPUESTOS-BACK] ⚠️ El servidor continuará sin sincronización automática');
            }
        });
        
        return server;
        
    } catch (error) {
        console.error('[PRESUPUESTOS-BACK] ❌ Error fatal al inicializar servidor:', error);
        console.error('[PRESUPUESTOS-BACK] ❌ Stack trace:', error.stack);
        process.exit(1);
    }
};

// Ejecutar inicialización
console.log('[PRESUPUESTOS-BACK] 🚀 Ejecutando inicialización del servidor...');
inicializarServidor().then(server => {

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
}).catch(error => {
    console.error('[PRESUPUESTOS-BACK] ❌ Error fatal al inicializar:', error);
    process.exit(1);
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
