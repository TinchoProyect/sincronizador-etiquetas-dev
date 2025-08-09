console.log('🔍 [PRESUPUESTOS] Cargando controlador de Google Sheets...');

// Importar servicios de Google Sheets
const { checkAuthStatus, generateAuthUrl, getTokenFromCode } = require('../../services/gsheets/auth');
const { extractSheetId, validateSheetAccess, detectDataStructure } = require('../../services/gsheets/client');
const { syncFromGoogleSheets, validarConfiguracionSync, obtenerHistorialSincronizacion } = require('../../services/gsheets/sync_real');

/**
 * Controlador para la integración con Google Sheets
 * Maneja autenticación, configuración y sincronización
 */

/**
 * Verificar estado de autenticación con Google
 */
const verificarAutenticacion = async (req, res) => {
    try {
        console.log('🔍 [PRESUPUESTOS] Verificando estado de autenticación Google...');
        
        const authStatus = await checkAuthStatus();
        
        console.log(`${authStatus.authenticated ? '✅' : '⚠️'} [PRESUPUESTOS] Estado de autenticación:`, authStatus.authenticated);
        
        res.json({
            success: true,
            data: authStatus,
            timestamp: new Date().toISOString()
        });
        
    } catch (error) {
        console.error('❌ [PRESUPUESTOS] Error al verificar autenticación:', error);
        res.status(500).json({
            success: false,
            error: 'Error al verificar autenticación con Google',
            message: error.message,
            timestamp: new Date().toISOString()
        });
    }
};

/**
 * Iniciar proceso de autenticación con Google
 */
const iniciarAutenticacion = async (req, res) => {
    try {
        console.log('🔍 [PRESUPUESTOS] Iniciando proceso de autenticación Google...');
        
        // Importar funciones necesarias para crear cliente OAuth2
        const { loadCredentials, createOAuth2Client } = require('../../services/gsheets/auth');
        
        console.log('🔍 [PRESUPUESTOS] Generando URL de autorización...');
        
        // Cargar credenciales y crear cliente OAuth2
        const credentials = loadCredentials();
        const oAuth2Client = createOAuth2Client(credentials);
        
        // Generar URL de autorización con el cliente
        const authUrl = generateAuthUrl(oAuth2Client);
        
        console.log('✅ [PRESUPUESTOS] URL de autorización generada');
        
        res.json({
            success: true,
            data: {
                authUrl: authUrl,
                message: 'Visite la URL para autorizar el acceso a Google Sheets'
            },
            timestamp: new Date().toISOString()
        });
        
    } catch (error) {
        console.error('❌ [PRESUPUESTOS] Error al iniciar autenticación:', error);
        res.status(500).json({
            success: false,
            error: 'Error al iniciar autenticación con Google',
            message: error.message,
            timestamp: new Date().toISOString()
        });
    }
};

/**
 * Completar autenticación con código de autorización
 */
const completarAutenticacion = async (req, res) => {
    try {
        const { code } = req.body;
        
        console.log('🔍 [PRESUPUESTOS] Completando autenticación con código...');
        
        if (!code) {
            return res.status(400).json({
                success: false,
                error: 'Código de autorización requerido',
                timestamp: new Date().toISOString()
            });
        }
        
        // Importar funciones necesarias para crear cliente OAuth2
        const { loadCredentials, createOAuth2Client } = require('../../services/gsheets/auth');
        
        // Cargar credenciales y crear cliente OAuth2
        const credentials = loadCredentials();
        const oAuth2Client = createOAuth2Client(credentials);
        
        // Obtener token desde código con el cliente OAuth2
        const token = await getTokenFromCode(oAuth2Client, code);
        
        console.log('✅ [PRESUPUESTOS] Autenticación completada exitosamente');
        
        res.json({
            success: true,
            data: {
                message: 'Autenticación completada exitosamente',
                tokenExpiry: token.expiry_date
            },
            timestamp: new Date().toISOString()
        });
        
    } catch (error) {
        console.error('❌ [PRESUPUESTOS] Error al completar autenticación:', error);
        res.status(500).json({
            success: false,
            error: 'Error al completar autenticación',
            message: error.message,
            timestamp: new Date().toISOString()
        });
    }
};

/**
 * Validar acceso a una hoja de Google Sheets
 */
const validarHoja = async (req, res) => {
    try {
        const { hoja_url } = req.body;
        
        console.log('🔍 [PRESUPUESTOS] Validando acceso a hoja:', hoja_url);
        
        if (!hoja_url) {
            return res.status(400).json({
                success: false,
                error: 'URL de Google Sheets requerida',
                timestamp: new Date().toISOString()
            });
        }
        
        // Extraer ID de la hoja
        const hojaId = extractSheetId(hoja_url);
        console.log('📋 [PRESUPUESTOS] ID de hoja extraído:', hojaId);
        
        // Validar acceso
        const validation = await validateSheetAccess(hojaId);
        
        if (validation.hasAccess) {
            console.log('✅ [PRESUPUESTOS] Acceso validado:', validation.sheetTitle);
            
            res.json({
                success: true,
                data: {
                    hasAccess: true,
                    hojaId: hojaId,
                    sheetTitle: validation.sheetTitle,
                    availableSheets: validation.availableSheets,
                    message: 'Acceso a Google Sheets validado correctamente'
                },
                timestamp: new Date().toISOString()
            });
        } else {
            console.log('❌ [PRESUPUESTOS] Acceso denegado:', validation.error);
            
            res.status(403).json({
                success: false,
                error: 'No se puede acceder a la hoja de Google Sheets',
                details: validation,
                timestamp: new Date().toISOString()
            });
        }
        
    } catch (error) {
        console.error('❌ [PRESUPUESTOS] Error al validar hoja:', error);
        res.status(500).json({
            success: false,
            error: 'Error al validar hoja de Google Sheets',
            message: error.message,
            timestamp: new Date().toISOString()
        });
    }
};

/**
 * Crear o actualizar configuración de Google Sheets
 */
const configurarHoja = async (req, res) => {
    try {
        const { hoja_url, rango, hoja_nombre } = req.body;
        const usuario_id = req.user?.id || 1; // TODO: Obtener de sesión real
        
        console.log('🔍 [PRESUPUESTOS] Configurando hoja de Google Sheets...');
        console.log('📋 [PRESUPUESTOS] Datos recibidos:', { hoja_url, rango, hoja_nombre });
        
        if (!hoja_url) {
            return res.status(400).json({
                success: false,
                error: 'URL de Google Sheets requerida',
                timestamp: new Date().toISOString()
            });
        }
        
        // Extraer ID de la hoja
        const hojaId = extractSheetId(hoja_url);
        
        // Validar configuración
        const configToValidate = {
            hoja_url,
            hoja_id: hojaId,
            rango: rango || 'A:P',
            hoja_nombre: hoja_nombre || 'Hoja1'
        };
        
        const validation = await validarConfiguracionSync(configToValidate);
        
        if (!validation.isValid) {
            console.log('❌ [PRESUPUESTOS] Configuración inválida:', validation.errors);
            return res.status(400).json({
                success: false,
                error: 'Configuración inválida',
                details: validation,
                timestamp: new Date().toISOString()
            });
        }
        
        // Desactivar configuraciones anteriores
        await req.db.query('UPDATE presupuestos_config SET activo = false WHERE activo = true');
        
        // Crear nueva configuración
        const insertQuery = `
            INSERT INTO presupuestos_config 
            (hoja_url, hoja_id, hoja_nombre, rango, activo, usuario_id, fecha_creacion)
            VALUES ($1, $2, $3, $4, true, $5, NOW())
            RETURNING *
        `;
        
        const result = await req.db.query(insertQuery, [
            hoja_url,
            hojaId,
            hoja_nombre || 'Hoja1',
            rango || 'A:P',
            usuario_id
        ]);
        
        const nuevaConfig = result.rows[0];
        
        console.log('✅ [PRESUPUESTOS] Configuración creada con ID:', nuevaConfig.id);
        
        res.json({
            success: true,
            data: nuevaConfig,
            validation: validation,
            message: 'Configuración de Google Sheets guardada exitosamente',
            timestamp: new Date().toISOString()
        });
        
    } catch (error) {
        console.error('❌ [PRESUPUESTOS] Error al configurar hoja:', error);
        res.status(500).json({
            success: false,
            error: 'Error al configurar hoja de Google Sheets',
            message: error.message,
            timestamp: new Date().toISOString()
        });
    }
};

/**
 * Ejecutar sincronización manual
 */
const ejecutarSincronizacion = async (req, res) => {
    try {
        console.log('🔄 [PRESUPUESTOS] Iniciando sincronización manual...');
        
        // Obtener configuración activa
        const configQuery = `
            SELECT * FROM presupuestos_config 
            WHERE activo = true 
            ORDER BY fecha_creacion DESC 
            LIMIT 1
        `;
        
        const configResult = await req.db.query(configQuery);
        
        if (configResult.rows.length === 0) {
            return res.status(400).json({
                success: false,
                error: 'No hay configuración activa de Google Sheets',
                message: 'Configure primero una hoja de Google Sheets',
                timestamp: new Date().toISOString()
            });
        }
        
        const config = configResult.rows[0];
        console.log('📋 [PRESUPUESTOS] Usando configuración:', config.id);
        
        // Ejecutar sincronización
        const syncResult = await syncFromGoogleSheets(config, req.db);
        
        console.log(`${syncResult.exitoso ? '✅' : '❌'} [PRESUPUESTOS] Sincronización completada`);
        
        res.json({
            success: syncResult.exitoso,
            data: syncResult,
            registros_procesados: syncResult.registros_procesados,
            registros_nuevos: syncResult.registros_nuevos,
            registros_actualizados: syncResult.registros_actualizados,
            exitoso: syncResult.exitoso,
            message: syncResult.exitoso ? 
                'Sincronización completada exitosamente' : 
                'Sincronización completada con errores',
            timestamp: new Date().toISOString()
        });
        
    } catch (error) {
        console.error('❌ [PRESUPUESTOS] Error en sincronización:', error);
        res.status(500).json({
            success: false,
            error: 'Error al ejecutar sincronización',
            message: error.message,
            timestamp: new Date().toISOString()
        });
    }
};

/**
 * Obtener historial de sincronizaciones
 */
const obtenerHistorial = async (req, res) => {
    try {
        const { limit = 10 } = req.query;
        
        console.log(`🔍 [PRESUPUESTOS] Obteniendo historial de sincronizaciones (límite: ${limit})...`);
        
        const historial = await obtenerHistorialSincronizacion(req.db, null, parseInt(limit));
        
        console.log(`✅ [PRESUPUESTOS] Historial obtenido: ${historial.length} registros`);
        
        res.json({
            success: true,
            data: historial,
            total: historial.length,
            timestamp: new Date().toISOString()
        });
        
    } catch (error) {
        console.error('❌ [PRESUPUESTOS] Error al obtener historial:', error);
        res.status(500).json({
            success: false,
            error: 'Error al obtener historial de sincronizaciones',
            message: error.message,
            timestamp: new Date().toISOString()
        });
    }
};

/**
 * Obtener estado de sincronización
 */
const obtenerEstadoSync = async (req, res) => {
    try {
        console.log('🔍 [PRESUPUESTOS] Obteniendo estado de sincronización...');
        
        // Obtener configuración activa
        const configQuery = `
            SELECT * FROM presupuestos_config 
            WHERE activo = true 
            ORDER BY fecha_creacion DESC 
            LIMIT 1
        `;
        
        const configResult = await req.db.query(configQuery);
        
        // Obtener último log de sincronización
        const lastSyncQuery = `
            SELECT * FROM presupuestos_sync_log 
            ORDER BY fecha_sync DESC 
            LIMIT 1
        `;
        
        const lastSyncResult = await req.db.query(lastSyncQuery);
        
        // Verificar estado de autenticación
        const authStatus = await checkAuthStatus();
        
        const estado = {
            configurado: configResult.rows.length > 0,
            autenticado: authStatus.authenticated,
            configuracion: configResult.rows[0] || null,
            ultimaSync: lastSyncResult.rows[0] || null,
            authStatus: authStatus
        };
        
        console.log('✅ [PRESUPUESTOS] Estado de sincronización obtenido');
        
        res.json({
            success: true,
            data: estado,
            timestamp: new Date().toISOString()
        });
        
    } catch (error) {
        console.error('❌ [PRESUPUESTOS] Error al obtener estado:', error);
        res.status(500).json({
            success: false,
            error: 'Error al obtener estado de sincronización',
            message: error.message,
            timestamp: new Date().toISOString()
        });
    }
};

console.log('✅ [PRESUPUESTOS] Controlador de Google Sheets configurado');

module.exports = {
    verificarAutenticacion,
    iniciarAutenticacion,
    completarAutenticacion,
    validarHoja,
    configurarHoja,
    ejecutarSincronizacion,
    obtenerHistorial,
    obtenerEstadoSync
};
