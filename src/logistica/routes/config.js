/**
 * Rutas de Configuración
 * Endpoint seguro para exponer configuraciones al frontend
 */

const express = require('express');
const router = express.Router();

console.log('🔍 [CONFIG] Configurando rutas de configuración...');



/**
 * @route GET /api/logistica/config
 * @desc Obtener configuración pública para el frontend
 * @access Público (solo configuraciones seguras)
 */
router.get('/', async (req, res) => {
    console.log('[CONFIG] Solicitando configuración pública');
    
    try {
        // La URL base pública se obtiene estrictamente de PUBLIC_BASE_URL
        // No hay detección automática de Ngrok ni fallbacks específicos para Ngrok.
        
        // Solo exponemos configuraciones seguras para el frontend
        const config = {
            googleMapsApiKey: process.env.GOOGLE_MAPS_API_KEY || '',
            environment: process.env.NODE_ENV || 'production',
            apiBaseUrl: process.env.API_BASE_URL || 'http://localhost:3005',
            publicBaseUrl: process.env.PUBLIC_BASE_URL || 'http://localhost:3005'
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

console.log('✅ [CONFIG] Rutas de configuración configuradas');
console.log('📋 [CONFIG] Rutas disponibles:');
console.log('   - GET /api/logistica/config');

module.exports = router;
