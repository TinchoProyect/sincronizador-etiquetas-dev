/**
 * Rutas de Configuración
 * Endpoint seguro para exponer configuraciones al frontend
 */

const express = require('express');
const router = express.Router();

console.log('🔍 [CONFIG] Configurando rutas de configuración...');

/**
 * Detectar URL pública de Ngrok automáticamente con reintentos
 */
async function detectarNgrokUrl(intentos = 3, delay = 1000) {
    console.log('\n╔════════════════════════════════════════════════════════╗');
    console.log('║  🔍 DETECCIÓN AUTOMÁTICA DE NGROK                     ║');
    console.log('╚════════════════════════════════════════════════════════╝');
    
    for (let i = 1; i <= intentos; i++) {
        try {
            console.log(`[CONFIG] 📡 Intento ${i}/${intentos}: Conectando a API de Ngrok...`);
            console.log(`[CONFIG] 🌐 URL: http://127.0.0.1:4040/api/tunnels`);
            
            // Intentar conectar a la API local de Ngrok
            const response = await fetch('http://127.0.0.1:4040/api/tunnels', {
                method: 'GET',
                headers: { 'Accept': 'application/json' }
            });
            
            console.log(`[CONFIG] 📊 Status HTTP: ${response.status}`);
            
            if (!response.ok) {
                throw new Error(`HTTP ${response.status}: ${response.statusText}`);
            }
            
            const data = await response.json();
            console.log(`[CONFIG] 📦 Túneles encontrados: ${data.tunnels?.length || 0}`);
            
            if (data.tunnels && data.tunnels.length > 0) {
                // Mostrar todos los túneles
                data.tunnels.forEach((tunnel, index) => {
                    console.log(`[CONFIG]    Túnel ${index + 1}: ${tunnel.proto} → ${tunnel.public_url}`);
                });
                
                // Buscar el túnel HTTPS
                const httpsTunnel = data.tunnels.find(t => t.proto === 'https');
                
                if (httpsTunnel && httpsTunnel.public_url) {
                    console.log('\n╔════════════════════════════════════════════════════════╗');
                    console.log('║  ✅ NGROK DETECTADO EXITOSAMENTE                      ║');
                    console.log('╚════════════════════════════════════════════════════════╝');
                    console.log(`[CONFIG] 🚀 URL Pública: ${httpsTunnel.public_url}`);
                    console.log(`[CONFIG] 🎯 Esta URL se usará para generar los códigos QR\n`);
                    return httpsTunnel.public_url;
                }
                
                throw new Error('No se encontró túnel HTTPS (solo HTTP encontrado)');
            }
            
            throw new Error('No hay túneles activos');
            
        } catch (error) {
            console.log(`[CONFIG] ❌ Intento ${i} falló: ${error.message}`);
            
            // Si no es el último intento, esperar antes de reintentar
            if (i < intentos) {
                console.log(`[CONFIG] ⏳ Esperando ${delay}ms antes del siguiente intento...`);
                await new Promise(resolve => setTimeout(resolve, delay));
            }
        }
    }
    
    // Todos los intentos fallaron
    console.log('\n╔════════════════════════════════════════════════════════╗');
    console.log('║  ⚠️  NGROK NO DETECTADO                               ║');
    console.log('╚════════════════════════════════════════════════════════╝');
    console.log('[CONFIG] ℹ️ Posibles causas:');
    console.log('[CONFIG]    1. Ngrok no está corriendo');
    console.log('[CONFIG]    2. Ngrok está en un puerto diferente');
    console.log('[CONFIG]    3. API de Ngrok no está en http://127.0.0.1:4040');
    console.log('[CONFIG] 💡 Solución: Iniciar Ngrok con: ngrok http 3005');
    console.log('[CONFIG] 📝 Fallback: Se usará NGROK_URL de .env si existe\n');
    
    return null;
}

/**
 * @route GET /api/logistica/config
 * @desc Obtener configuración pública para el frontend
 * @access Público (solo configuraciones seguras)
 */
router.get('/', async (req, res) => {
    console.log('[CONFIG] Solicitando configuración pública');
    
    try {
        // Prioridad de URLs:
        // 1. Detección automática vía API local de Ngrok
        // 2. Variable de entorno .env (fallback manual)
        // 3. Vacío (localhost)
        
        let ngrokUrl = '';
        let fuente = '';
        
        console.log('[NGROK] 🔎 Buscando túnel activo...');
        
        // Intentar detectar vía API local
        const ngrokUrlDetectada = await detectarNgrokUrl();
        
        if (ngrokUrlDetectada) {
            ngrokUrl = ngrokUrlDetectada;
            fuente = 'api-local';
            console.log(`[NGROK] ✅ Túnel detectado: ${ngrokUrlDetectada}`);
        } else if (process.env.NGROK_URL) {
            ngrokUrl = process.env.NGROK_URL;
            fuente = 'env-manual';
            console.log('[NGROK] ⚠️ No se detectó Ngrok, usando configuración manual de .env');
        } else {
            console.warn('[NGROK] ⚠️ Ngrok no disponible. QR usará localhost (no funcionará en móvil externo)');
            fuente = 'localhost';
        }
        
        // Solo exponemos configuraciones seguras para el frontend
        const config = {
            googleMapsApiKey: process.env.GOOGLE_MAPS_API_KEY || '',
            environment: process.env.NODE_ENV || 'production',
            apiBaseUrl: process.env.API_BASE_URL || 'http://localhost:3005',
            publicBaseUrl: process.env.PUBLIC_BASE_URL || 'http://localhost:3005',
            ngrokUrl: ngrokUrl,
            ngrokFuente: fuente
        };
        
        // Validar que la API key existe
        if (!config.googleMapsApiKey) {
            console.warn('[CONFIG] ⚠️ GOOGLE_MAPS_API_KEY no está configurada en .env');
        }
        
        res.json({
            success: true,
            data: config
        });
        
    } catch (error) {
        console.error('[CONFIG] ❌ Error al obtener configuración:', error);
        res.status(500).json({
            success: false,
            error: 'Error al obtener configuración',
            message: error.message
        });
    }
});

/**
 * @route GET /api/logistica/debug/ngrok
 * @desc Endpoint de debug para ver respuesta cruda de Ngrok API
 * @access Público (solo para debugging)
 */
router.get('/debug/ngrok', async (req, res) => {
    console.log('[DEBUG] Solicitando información cruda de Ngrok API');
    
    try {
        const response = await fetch('http://127.0.0.1:4040/api/tunnels');
        
        const debugInfo = {
            ngrok_api_accesible: response.ok,
            status_http: response.status,
            status_text: response.statusText
        };
        
        if (response.ok) {
            const data = await response.json();
            debugInfo.respuesta_cruda = data;
            debugInfo.tuneles_count = data.tunnels?.length || 0;
            debugInfo.tuneles = data.tunnels?.map(t => ({
                nombre: t.name,
                proto: t.proto,
                public_url: t.public_url,
                config: t.config
            }));
            
            // Buscar HTTPS
            const httpsTunnel = data.tunnels?.find(t => t.proto === 'https');
            debugInfo.https_tunnel_encontrado = !!httpsTunnel;
            debugInfo.https_url = httpsTunnel?.public_url || null;
        } else {
            debugInfo.error = 'No se pudo conectar a Ngrok API';
        }
        
        // También incluir variables de entorno
        debugInfo.env_ngrok_url = process.env.NGROK_URL || '(no configurada)';
        
        res.json({
            success: true,
            data: debugInfo
        });
        
    } catch (error) {
        console.error('[DEBUG] Error al consultar Ngrok:', error);
        res.json({
            success: false,
            error: error.message,
            ngrok_api_accesible: false,
            env_ngrok_url: process.env.NGROK_URL || '(no configurada)'
        });
    }
});

console.log('✅ [CONFIG] Rutas de configuración configuradas');
console.log('📋 [CONFIG] Rutas disponibles:');
console.log('   - GET /api/logistica/config (con detección automática de Ngrok)');
console.log('   - GET /api/logistica/debug/ngrok (debug de Ngrok API)');

module.exports = router;
