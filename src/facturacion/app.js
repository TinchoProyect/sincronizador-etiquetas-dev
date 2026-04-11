/**
 * Servidor principal del módulo de Facturación
 * Sistema LAMDA - Facturación Electrónica AFIP
 * Puerto: 3004
 */

require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');

console.log('🚀 [FACTURACION] =====================================');
console.log('🚀 [FACTURACION] INICIANDO MÓDULO DE FACTURACIÓN');
console.log('🚀 [FACTURACION] Sistema LAMDA - Facturación Electrónica');
console.log('🚀 [FACTURACION] =====================================');

const app = express();
const PORT = process.env.PORT || 3004;

// Importar configuraciones
const { dbMiddleware, verificarTablas } = require('./config/database');
const { validarConfiguracion, ENTORNO } = require('./config/afip');
const { infoTimezone } = require('./config/timezone');

// Importar rutas
const facturasRoutes = require('./routes/facturas');

console.log('🔧 [FACTURACION] Configurando middleware...');

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
        'http://localhost:3003',  // Servidor de presupuestos
        'http://localhost:3004',  // Este mismo servidor
        'http://localhost:3005',  // Servidor de logística
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
console.log('✅ [FACTURACION] CORS configurado para orígenes:', corsOptions.origin);

// Middleware básico
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

// Middleware de base de datos
app.use(dbMiddleware);

// Configurar archivos estáticos (si se necesitan en el futuro)
const staticPath = path.join(__dirname);
app.use(express.static(staticPath));
app.use('/pages', express.static(path.join(__dirname, 'pages')));

console.log('📁 [FACTURACION] Archivos estáticos configurados desde:', staticPath);
console.log('📁 [FACTURACION] Páginas HTML disponibles en: /pages');

// Ruta raíz - redirigir a página de facturas
app.get('/', (req, res) => {
    console.log('[FACTURACION] Acceso a ruta raíz - redirigiendo a página de facturas');
    res.redirect('/pages/facturas.html');
});

// Montar rutas del módulo
app.use('/facturacion', facturasRoutes);
console.log('✅ [FACTURACION] Rutas montadas en /facturacion');

// Ruta de health check general
app.get('/health', (req, res) => {
    console.log('[FACTURACION] Health check del servidor');
    
    res.json({
        success: true,
        service: 'facturacion-server',
        status: 'running',
        port: PORT,
        timestamp: new Date().toISOString(),
        uptime: process.uptime(),
        memory: process.memoryUsage(),
        version: '1.0.0',
        entorno: ENTORNO,
        features: {
            afip_wsaa: true,
            afip_wsfe: true,
            facturacion_interna: true,
            pdf_generation: true,
            logs_detallados: true
        }
    });
});

// Middleware para rutas no encontradas
app.use('*', (req, res) => {
    console.log(`⚠️ [FACTURACION] Ruta no encontrada: ${req.method} ${req.originalUrl}`);
    
    res.status(404).json({
        success: false,
        error: 'Recurso no encontrado',
        path: req.originalUrl,
        method: req.method,
        service: 'facturacion-server',
        timestamp: new Date().toISOString()
    });
});

// Middleware de manejo de errores global
app.use((err, req, res, next) => {
    console.error('❌ [FACTURACION] Error global:', err.message);
    console.error('❌ [FACTURACION] Stack:', err.stack);
    
    res.status(err.statusCode || 500).json({
        success: false,
        error: 'Error interno del servidor',
        message: err.message,
        timestamp: new Date().toISOString(),
        stack: process.env.NODE_ENV === 'development' ? err.stack : undefined
    });
});

/**
 * Inicializar servidor
 */
const inicializarServidor = async () => {
    try {
        console.log('🔧 [FACTURACION] =====================================');
        console.log('🔧 [FACTURACION] INICIALIZANDO SERVIDOR...');
        console.log('🔧 [FACTURACION] =====================================');
        
        // 1. Validar configuración de AFIP
        console.log('🔍 [FACTURACION] Validando configuración de AFIP...');
        const validacion = validarConfiguracion();
        
        if (!validacion.valida) {
            console.error('❌ [FACTURACION] Configuración de AFIP inválida');
            validacion.errores.forEach(error => console.error(`   - ${error}`));
            console.warn('⚠️ [FACTURACION] El servidor continuará, pero AFIP puede no funcionar');
        } else {
            console.log('✅ [FACTURACION] Configuración de AFIP válida');
        }
        
        // 2. Verificar tablas de base de datos
        console.log('🔍 [FACTURACION] Verificando tablas de base de datos...');
        const estadoTablas = await verificarTablas();
        
        if (!estadoTablas.todas_existen) {
            console.error('❌ [FACTURACION] Faltan tablas requeridas en la base de datos');
            console.error('❌ [FACTURACION] El módulo puede no funcionar correctamente');
        } else {
            console.log('✅ [FACTURACION] Todas las tablas requeridas existen');
        }
        
        // 3. Mostrar información de zona horaria
        console.log('🕒 [FACTURACION] Información de zona horaria:');
        const tzInfo = infoTimezone();
        console.log(`   - Timezone: ${tzInfo.timezone}`);
        console.log(`   - Offset: ${tzInfo.offset}`);
        console.log(`   - Timestamp: ${tzInfo.formatted}`);
        
        // 4. Iniciar servidor HTTP
        const server = app.listen(PORT, '0.0.0.0', () => {
            console.log('🎉 [FACTURACION] =====================================');
            console.log('🎉 [FACTURACION] SERVIDOR INICIADO EXITOSAMENTE');
            console.log('🎉 [FACTURACION] =====================================');
            console.log(`🌐 [FACTURACION] URL: http://localhost:${PORT}`);
            console.log(`📊 [FACTURACION] API: http://localhost:${PORT}/facturacion`);
            console.log(`🏥 [FACTURACION] Health: http://localhost:${PORT}/health`);
            console.log(`🌍 [FACTURACION] Entorno AFIP: ${ENTORNO}`);
            console.log(`📁 [FACTURACION] Directorio: ${__dirname}`);
            console.log('🔍 [FACTURACION] Logs de depuración: ACTIVADOS');
            console.log('📋 [FACTURACION] Características:');
            console.log('   ✅ Facturación Electrónica AFIP (WSAA/WSFE)');
            console.log('   ✅ Facturación Interna sin AFIP');
            console.log('   ✅ Generación de PDF con CAE/QR');
            console.log('   ✅ Conversión automática coma/punto');
            console.log('   ✅ Zona horaria Argentina');
            console.log('   ✅ Logs detallados en español');
            console.log('🎉 [FACTURACION] =====================================');
            console.log('🚀 [FACTURACION] LISTO PARA RECIBIR REQUESTS');
            console.log('🎉 [FACTURACION] =====================================');
        });
        
        return server;
        
    } catch (error) {
        console.error('❌ [FACTURACION] =====================================');
        console.error('❌ [FACTURACION] ERROR FATAL AL INICIALIZAR SERVIDOR');
        console.error('❌ [FACTURACION] =====================================');
        console.error('❌ [FACTURACION] Error:', error.message);
        console.error('❌ [FACTURACION] Stack:', error.stack);
        console.error('❌ [FACTURACION] =====================================');
        process.exit(1);
    }
};

// Ejecutar inicialización
console.log('🚀 [FACTURACION] Ejecutando inicialización del servidor...');
inicializarServidor().then(server => {
    
    // Manejo de errores del servidor
    server.on('error', (error) => {
        if (error.code === 'EADDRINUSE') {
            console.error(`❌ [FACTURACION] Puerto ${PORT} ya está en uso`);
            console.error('❌ [FACTURACION] Verifique que no haya otro proceso usando este puerto');
        } else {
            console.error('❌ [FACTURACION] Error del servidor:', error.message);
        }
        process.exit(1);
    });
    
    // Manejo de cierre graceful
    process.on('SIGTERM', () => {
        console.log('🔄 [FACTURACION] Recibida señal SIGTERM, cerrando servidor...');
        server.close(() => {
            console.log('✅ [FACTURACION] Servidor cerrado exitosamente');
            process.exit(0);
        });
    });
    
    process.on('SIGINT', () => {
        console.log('🔄 [FACTURACION] Recibida señal SIGINT, cerrando servidor...');
        server.close(() => {
            console.log('✅ [FACTURACION] Servidor cerrado exitosamente');
            process.exit(0);
        });
    });
    
}).catch(error => {
    console.error('❌ [FACTURACION] Error fatal al inicializar:', error.message);
    process.exit(1);
});

// Manejo de errores no capturados
process.on('uncaughtException', (error) => {
    console.error('❌ [FACTURACION] Error no capturado:', error.message);
    console.error('❌ [FACTURACION] Stack:', error.stack);
    process.exit(1);
});

process.on('unhandledRejection', (reason, promise) => {
    console.error('❌ [FACTURACION] Promesa rechazada no manejada:', reason);
    console.error('❌ [FACTURACION] En promesa:', promise);
});

module.exports = app;
