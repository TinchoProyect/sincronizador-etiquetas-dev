const express = require('express');
const router = express.Router();

console.log('🔍 [GSHEETS-ROUTES] Configurando rutas de integración Google Sheets...');

// Importar servicios de Google Sheets
const { checkAuthStatus } = require('../../services/gsheets/auth');
const { readSheetWithHeaders } = require('../../services/gsheets/client');

// Importar job de sincronización
const { syncOnce } = require('../../jobs/sync');

/**
 * @route GET /api/gsheets/auth/status
 * @desc Verificar estado de autenticación con Service Account
 * @access Público
 */
router.get('/auth/status', async (req, res) => {
    console.log('🔍 [GSHEETS-ROUTES] GET /auth/status - Verificando estado de autenticación');
    
    try {
        const authStatus = await checkAuthStatus();
        
        console.log('✅ [GSHEETS-ROUTES] Estado de autenticación obtenido:', authStatus.authenticated);
        
        res.json({
            success: true,
            data: authStatus,
            timestamp: new Date().toISOString()
        });
        
    } catch (error) {
        console.error('❌ [GSHEETS-ROUTES] Error al verificar autenticación:', error.message);
        res.status(500).json({
            success: false,
            error: 'Error al verificar autenticación con Google Sheets',
            message: error.message,
            timestamp: new Date().toISOString()
        });
    }
});

/**
 * @route POST /api/gsheets/sync/trigger
 * @desc Disparar sincronización manual
 * @access Público
 */
router.post('/sync/trigger', async (req, res) => {
    console.log('🔍 [GSHEETS-ROUTES] POST /sync/trigger - Disparando sincronización manual');
    
    try {
        const syncResult = await syncOnce();
        
        console.log('✅ [GSHEETS-ROUTES] Sincronización completada:', syncResult);
        
        res.json({
            success: true,
            ok: true,
            stats: {
                presupuestos: syncResult.presupuestos || 0,
                detalles: syncResult.detalles || 0
            },
            data: syncResult,
            timestamp: new Date().toISOString()
        });
        
    } catch (error) {
        console.error('❌ [GSHEETS-ROUTES] Error en sincronización:', error.message);
        res.status(500).json({
            success: false,
            ok: false,
            error: 'Error al ejecutar sincronización',
            message: error.message,
            timestamp: new Date().toISOString()
        });
    }
});

/**
 * @route GET /api/gsheets/presupuestos
 * @desc Leer datos de la hoja Presupuestos
 * @access Público
 */
router.get('/presupuestos', async (req, res) => {
    console.log('🔍 [GSHEETS-ROUTES] GET /presupuestos - Leyendo hoja Presupuestos');
    
    try {
        const { range = 'A1:Z100' } = req.query;
        
        console.log('📋 [GSHEETS-ROUTES] Usando rango:', range);
        console.log('📋 [GSHEETS-ROUTES] Hoja:', process.env.SHEET_PRESUPUESTOS);
        
        const data = await readSheetWithHeaders(
            process.env.SPREADSHEET_ID,
            range,
            process.env.SHEET_PRESUPUESTOS
        );
        
        console.log('✅ [GSHEETS-ROUTES] Datos leídos:', data.totalRows, 'filas');
        
        res.json({
            success: true,
            data: {
                headers: data.headers,
                rows: data.rows,
                totalRows: data.totalRows
            },
            range: range,
            sheetName: process.env.SHEET_PRESUPUESTOS,
            timestamp: new Date().toISOString()
        });
        
    } catch (error) {
        console.error('❌ [GSHEETS-ROUTES] Error al leer Presupuestos:', error.message);
        res.status(500).json({
            success: false,
            error: 'Error al leer hoja Presupuestos',
            message: error.message,
            timestamp: new Date().toISOString()
        });
    }
});

/**
 * @route GET /api/gsheets/detalles
 * @desc Leer datos de la hoja DetallesPresupuestos
 * @access Público
 */
router.get('/detalles', async (req, res) => {
    console.log('🔍 [GSHEETS-ROUTES] GET /detalles - Leyendo hoja DetallesPresupuestos');
    
    try {
        const { range = 'A1:Z100' } = req.query;
        
        console.log('📋 [GSHEETS-ROUTES] Usando rango:', range);
        console.log('📋 [GSHEETS-ROUTES] Hoja:', process.env.SHEET_DETALLES);
        
        const data = await readSheetWithHeaders(
            process.env.SPREADSHEET_ID,
            range,
            process.env.SHEET_DETALLES
        );
        
        console.log('✅ [GSHEETS-ROUTES] Datos leídos:', data.totalRows, 'filas');
        
        res.json({
            success: true,
            data: {
                headers: data.headers,
                rows: data.rows,
                totalRows: data.totalRows
            },
            range: range,
            sheetName: process.env.SHEET_DETALLES,
            timestamp: new Date().toISOString()
        });
        
    } catch (error) {
        console.error('❌ [GSHEETS-ROUTES] Error al leer DetallesPresupuestos:', error.message);
        res.status(500).json({
            success: false,
            error: 'Error al leer hoja DetallesPresupuestos',
            message: error.message,
            timestamp: new Date().toISOString()
        });
    }
});

/**
 * @route GET /api/gsheets/health
 * @desc Health check del módulo Google Sheets
 * @access Público
 */
router.get('/health', async (req, res) => {
    console.log('🔍 [GSHEETS-ROUTES] GET /health - Health check');
    
    try {
        const authStatus = await checkAuthStatus();
        
        res.json({
            success: true,
            module: 'google-sheets-integration',
            status: 'active',
            authenticated: authStatus.authenticated,
            authType: authStatus.authType || 'service_account',
            spreadsheetId: process.env.SPREADSHEET_ID ? 'configured' : 'missing',
            sheets: {
                presupuestos: process.env.SHEET_PRESUPUESTOS || 'not_configured',
                detalles: process.env.SHEET_DETALLES || 'not_configured'
            },
            syncInterval: process.env.SYNC_INTERVAL_MINUTES || 'not_configured',
            timestamp: new Date().toISOString(),
            version: '1.0.0'
        });
        
    } catch (error) {
        console.error('❌ [GSHEETS-ROUTES] Error en health check:', error.message);
        res.status(500).json({
            success: false,
            module: 'google-sheets-integration',
            status: 'error',
            error: error.message,
            timestamp: new Date().toISOString()
        });
    }
});

console.log('✅ [GSHEETS-ROUTES] Rutas de Google Sheets configuradas:');
console.log('   - GET /api/gsheets/auth/status');
console.log('   - POST /api/gsheets/sync/trigger');
console.log('   - GET /api/gsheets/presupuestos?range=A1:Z100');
console.log('   - GET /api/gsheets/detalles?range=A1:Z100');
console.log('   - GET /api/gsheets/health');

module.exports = router;
