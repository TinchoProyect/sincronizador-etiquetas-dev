console.log('[PRESUPUESTOS-BACK] Cargando controlador de Google Sheets CON LOGS DE DEPURACIÓN...');

// Importar servicios de Google Sheets CON LOGS DE DEPURACIÓN
const { checkAuthStatus, loadCredentials, createOAuth2Client, generateAuthUrl, getTokenFromCode } = require('../../services/gsheets/auth_with_logs');
const { extractSheetId, validateSheetAccess, detectDataStructure } = require('../../services/gsheets/client_with_logs');
const { syncFromGoogleSheets, upsertPresupuesto, registrarLogSincronizacion } = require('../../services/gsheets/sync_complete_with_logs');

/**
 * Controlador para la integración con Google Sheets CON LOGS DETALLADOS
 * Maneja autenticación, configuración y sincronización
 */

/**
 * Verificar estado de autenticación con Google
 */
const verificarAutenticacion = async (req, res) => {
    try {
        console.log('[PRESUPUESTOS-BACK] Verificando estado de autenticación Google...');
        
        const authStatus = await checkAuthStatus();
        
        console.log(`[PRESUPUESTOS-BACK] ${authStatus.authenticated ? '✅' : '⚠️'} Estado de autenticación:`, authStatus.authenticated);
        
        res.json({
            success: true,
            data: authStatus,
            timestamp: new Date().toISOString()
        });
        
    } catch (error) {
        console.error('[PRESUPUESTOS-BACK] ❌ Error al verificar autenticación:', error);
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
        console.log('[PRESUPUESTOS-BACK] Iniciando proceso de autenticación Google...');
        console.log('[PRESUPUESTOS-BACK] Generando URL de autorización...');
        
        // Crear cliente OAuth2 con validación
        console.log('[PRESUPUESTOS-BACK] Cargando credenciales...');
        const credentials = loadCredentials();
        
        if (!credentials) {
            throw new Error('No se pudieron cargar las credenciales de Google');
        }
        
        console.log('[PRESUPUESTOS-BACK] Creando cliente OAuth2...');
        const oAuth2Client = createOAuth2Client(credentials);
        
        if (!oAuth2Client) {
            throw new Error('No se pudo crear el cliente OAuth2');
        }
        
        console.log('[PRESUPUESTOS-BACK] Cliente OAuth2 creado, generando URL...');
        
        // Generar URL de autorización
        const authUrl = generateAuthUrl(oAuth2Client);
        
        if (!authUrl) {
            throw new Error('No se pudo generar la URL de autorización');
        }
        
        console.log('[PRESUPUESTOS-BACK] ✅ URL de autorización generada exitosamente');
        console.log('[PRESUPUESTOS-BACK] URL:', authUrl);
        
        res.json({
            success: true,
            data: {
                authUrl: authUrl,
                message: 'Visite la URL para autorizar el acceso a Google Sheets'
            },
            timestamp: new Date().toISOString()
        });
        
    } catch (error) {
        console.error('[PRESUPUESTOS-BACK] ❌ Error al iniciar autenticación:', error);
        console.error('[PRESUPUESTOS-BACK] Stack trace:', error.stack);
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
        
        console.log('[PRESUPUESTOS-BACK] Completando autenticación con código...');
        
        if (!code) {
            return res.status(400).json({
                success: false,
                error: 'Código de autorización requerido',
                timestamp: new Date().toISOString()
            });
        }
        
        // Crear cliente OAuth2
        const credentials = loadCredentials();
        const oAuth2Client = createOAuth2Client(credentials);
        
        // Obtener token desde código
        const token = await getTokenFromCode(oAuth2Client, code);
        
        console.log('[PRESUPUESTOS-BACK] ✅ Autenticación completada exitosamente');
        
        res.json({
            success: true,
            data: {
                message: 'Autenticación completada exitosamente',
                tokenExpiry: token.expiry_date
            },
            timestamp: new Date().toISOString()
        });
        
    } catch (error) {
        console.error('[PRESUPUESTOS-BACK] ❌ Error al completar autenticación:', error);
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
        
        console.log('[PRESUPUESTOS-BACK] Validando acceso a hoja:', hoja_url);
        
        if (!hoja_url) {
            return res.status(400).json({
                success: false,
                error: 'URL de Google Sheets requerida',
                timestamp: new Date().toISOString()
            });
        }
        
        // Extraer ID de la hoja
        const hojaId = extractSheetId(hoja_url);
        console.log('[PRESUPUESTOS-BACK] ID de hoja extraído:', hojaId);
        
        // Validar acceso
        const validation = await validateSheetAccess(hojaId);
        
        if (validation.hasAccess) {
            console.log('[PRESUPUESTOS-BACK] ✅ Acceso validado:', validation.sheetTitle);
            
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
            console.log('[PRESUPUESTOS-BACK] ❌ Acceso denegado:', validation.error);
            
            res.status(403).json({
                success: false,
                error: 'No se puede acceder a la hoja de Google Sheets',
                details: validation,
                timestamp: new Date().toISOString()
            });
        }
        
    } catch (error) {
        console.error('[PRESUPUESTOS-BACK] ❌ Error al validar hoja:', error);
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
        
        console.log('[PRESUPUESTOS-BACK] Configurando hoja de Google Sheets...');
        console.log('[PRESUPUESTOS-BACK] Datos recibidos:', { hoja_url, rango, hoja_nombre });
        
        if (!hoja_url) {
            return res.status(400).json({
                success: false,
                error: 'URL de Google Sheets requerida',
                timestamp: new Date().toISOString()
            });
        }
        
        // Extraer ID de la hoja
        const hojaId = extractSheetId(hoja_url);
        
        // Validar configuración básica
        const configToValidate = {
            hoja_url,
            hoja_id: hojaId,
            rango: rango || 'A:P',
            hoja_nombre: hoja_nombre || 'Hoja1'
        };
        
        console.log('[PRESUPUESTOS-BACK] Configuración a validar:', configToValidate);
        
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
        
        console.log('[PRESUPUESTOS-BACK] ✅ Configuración creada con ID:', nuevaConfig.id);
        
        res.json({
            success: true,
            data: nuevaConfig,
            message: 'Configuración de Google Sheets guardada exitosamente',
            timestamp: new Date().toISOString()
        });
        
    } catch (error) {
        console.error('[PRESUPUESTOS-BACK] ❌ Error al configurar hoja:', error);
        res.status(500).json({
            success: false,
            error: 'Error al configurar hoja de Google Sheets',
            message: error.message,
            timestamp: new Date().toISOString()
        });
    }
};

/**
 * Ejecutar sincronización manual CON LOGS DETALLADOS
 */
const ejecutarSincronizacion = async (req, res) => {
    try {
        console.log('[PRESUPUESTOS-BACK] 🔄 INICIANDO SINCRONIZACIÓN MANUAL CON LOGS...');
        
        // Obtener configuración activa
        const configQuery = `
            SELECT * FROM presupuestos_config 
            WHERE activo = true 
            ORDER BY fecha_creacion DESC 
            LIMIT 1
        `;
        
        const configResult = await req.db.query(configQuery);
        
        if (configResult.rows.length === 0) {
            console.log('[PRESUPUESTOS-BACK] ❌ No hay configuración activa');
            return res.status(400).json({
                success: false,
                error: 'No hay configuración activa de Google Sheets',
                message: 'Configure primero una hoja de Google Sheets',
                timestamp: new Date().toISOString()
            });
        }
        
        const config = configResult.rows[0];
        console.log('[PRESUPUESTOS-BACK] ✅ Usando configuración ID:', config.id);
        console.log('[PRESUPUESTOS-BACK] URL de la hoja:', config.hoja_url);
        console.log('[PRESUPUESTOS-BACK] ID de la hoja:', config.hoja_id);
        console.log('[PRESUPUESTOS-BACK] ¿Es el archivo PresupuestosCopia?', config.hoja_url.includes('1r7VEnEArREqAGZiDxQCW4A0XIKb8qaxHXD0TlVhfuf8'));
        
        // Ejecutar sincronización CON LOGS DETALLADOS
        console.log('[PRESUPUESTOS-BACK] 🚀 Ejecutando syncFromGoogleSheets con logs...');
        const syncResult = await syncFromGoogleSheets(config, req.db);
        
        console.log(`[PRESUPUESTOS-BACK] ${syncResult.exitoso ? '✅' : '❌'} Sincronización completada`);
        console.log('[PRESUPUESTOS-BACK] Resultado detallado:', {
            exitoso: syncResult.exitoso,
            registros_procesados: syncResult.registros_procesados,
            registros_nuevos: syncResult.registros_nuevos,
            registros_actualizados: syncResult.registros_actualizados,
            errores: syncResult.errores.length
        });
        
        res.json({
            success: syncResult.exitoso,
            data: syncResult,
            message: syncResult.exitoso ? 
                'Sincronización completada exitosamente' : 
                'Sincronización completada con errores',
            timestamp: new Date().toISOString()
        });
        
    } catch (error) {
        console.error('[PRESUPUESTOS-BACK] ❌ Error en sincronización:', error);
        console.log('[PRESUPUESTOS-BACK] Stack trace completo:', error.stack);
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
        
        console.log(`[PRESUPUESTOS-BACK] Obteniendo historial de sincronizaciones (límite: ${limit})...`);
        
        const historialQuery = `
            SELECT 
                psl.*,
                pc.hoja_url,
                pc.hoja_id,
                pc.hoja_nombre
            FROM presupuestos_sync_log psl
            LEFT JOIN presupuestos_config pc ON pc.id = psl.config_id
            ORDER BY psl.fecha_sync DESC
            LIMIT $1
        `;
        
        const result = await req.db.query(historialQuery, [parseInt(limit)]);
        const historial = result.rows;
        
        console.log(`[PRESUPUESTOS-BACK] ✅ Historial obtenido: ${historial.length} registros`);
        
        res.json({
            success: true,
            data: historial,
            total: historial.length,
            timestamp: new Date().toISOString()
        });
        
    } catch (error) {
        console.error('[PRESUPUESTOS-BACK] ❌ Error al obtener historial:', error);
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
        console.log('[PRESUPUESTOS-BACK] Obteniendo estado de sincronización...');
        
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
        
        console.log('[PRESUPUESTOS-BACK] ✅ Estado de sincronización obtenido');
        console.log('[PRESUPUESTOS-BACK] Configurado:', estado.configurado);
        console.log('[PRESUPUESTOS-BACK] Autenticado:', estado.autenticado);
        
        res.json({
            success: true,
            data: estado,
            timestamp: new Date().toISOString()
        });
        
    } catch (error) {
        console.error('[PRESUPUESTOS-BACK] ❌ Error al obtener estado:', error);
        res.status(500).json({
            success: false,
            error: 'Error al obtener estado de sincronización',
            message: error.message,
            timestamp: new Date().toISOString()
        });
    }
};

console.log('[PRESUPUESTOS-BACK] ✅ Controlador de Google Sheets CON LOGS configurado');

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
