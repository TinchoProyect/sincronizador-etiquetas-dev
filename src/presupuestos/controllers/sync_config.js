console.log('[SYNC_CONFIG] Cargando controlador de configuración de autosync...');

/**
 * Controlador para la configuración de sincronización automática
 * Maneja los endpoints de configuración del autosync
 */

/**
 * Obtener configuración actual de autosync
 */
const obtenerConfiguracionSync = async (req, res) => {
    console.log('[SYNC_CONFIG] GET /sync/config - Obteniendo configuración de autosync');
    
    try {
        // Buscar configuración activa (singleton)
        const query = `
            SELECT auto_sync_enabled, sync_interval_minutes, active_hours_start, 
                   active_hours_end, timezone
            FROM presupuestos_config 
            WHERE activo = true
        `;
        
        const result = await req.db.query(query);
        
        // Validar singleton
        if (result.rows.length === 0) {
            console.log('[SYNC_CONFIG] ❌ No hay configuración activa');
            return res.status(409).json({
                success: false,
                error: 'CONFIG_SINGLETON_VIOLATION',
                activos: 0,
                message: 'No existe configuración activa',
                timestamp: new Date().toISOString()
            });
        }
        
        if (result.rows.length > 1) {
            console.log(`[SYNC_CONFIG] ❌ Múltiples configuraciones activas: ${result.rows.length}`);
            return res.status(409).json({
                success: false,
                error: 'CONFIG_SINGLETON_VIOLATION',
                activos: result.rows.length,
                message: 'Múltiples configuraciones activas detectadas',
                timestamp: new Date().toISOString()
            });
        }
        
        const config = result.rows[0];
        
        // Aplicar defaults para valores NULL
        const response = {
            auto_sync_enabled: config.auto_sync_enabled || false,
            sync_interval_minutes: config.sync_interval_minutes || 1,
            active_hours_start: config.active_hours_start || '08:00',
            active_hours_end: config.active_hours_end || '20:00',
            timezone: config.timezone || 'America/Argentina/Buenos_Aires'
        };
        
        // Formatear horas a HH:mm si vienen como time
        if (response.active_hours_start && typeof response.active_hours_start === 'object') {
            response.active_hours_start = response.active_hours_start.toString().substring(0, 5);
        }
        if (response.active_hours_end && typeof response.active_hours_end === 'object') {
            response.active_hours_end = response.active_hours_end.toString().substring(0, 5);
        }
        
        console.log('[SYNC_CONFIG] ✅ Configuración obtenida:', response);
        
        res.json(response);
        
    } catch (error) {
        console.error('[SYNC_CONFIG] ❌ Error al obtener configuración:', error);
        res.status(500).json({
            success: false,
            error: 'Error interno al obtener configuración de autosync',
            message: error.message,
            timestamp: new Date().toISOString()
        });
    }
};

/**
 * Actualizar configuración de autosync
 */
const actualizarConfiguracionSync = async (req, res) => {
    console.log('[SYNC_CONFIG] PATCH /sync/config - Actualizando configuración de autosync');
    console.log('[SYNC_CONFIG] Body recibido:', req.body);
    
    try {
        const {
            auto_sync_enabled,
            sync_interval_minutes,
            active_hours_start,
            active_hours_end,
            timezone
        } = req.body;
        
        // No se requiere lógica adicional - la BD maneja el estado
        // El scheduler lee auto_sync_enabled directamente de la BD
        
        // Validaciones
        const errors = [];
        
        if (sync_interval_minutes !== undefined) {
            if (!Number.isInteger(sync_interval_minutes) || sync_interval_minutes < 1) {
                errors.push('sync_interval_minutes debe ser un entero >= 1');
            }
        }
        
        if (active_hours_start !== undefined) {
            // Aceptar tanto HH:mm como HH:mm:ss (formato TIME de PostgreSQL)
            if (!active_hours_start.match(/^([01]?[0-9]|2[0-3]):[0-5][0-9](:[0-5][0-9])?$/)) {
                errors.push('active_hours_start debe tener formato HH:mm o HH:mm:ss');
            }
        }
        
        if (active_hours_end !== undefined) {
            // Aceptar tanto HH:mm como HH:mm:ss (formato TIME de PostgreSQL)
            if (!active_hours_end.match(/^([01]?[0-9]|2[0-3]):[0-5][0-9](:[0-5][0-9])?$/)) {
                errors.push('active_hours_end debe tener formato HH:mm o HH:mm:ss');
            }
        }
        
        if (timezone !== undefined) {
            if (!timezone || typeof timezone !== 'string' || timezone.trim() === '') {
                errors.push('timezone debe ser un string no vacío');
            }
        }
        
        if (errors.length > 0) {
            console.log('[SYNC_CONFIG] ❌ Errores de validación:', errors);
            return res.status(400).json({
                success: false,
                error: 'Errores de validación',
                details: errors,
                timestamp: new Date().toISOString()
            });
        }
        
        // Verificar singleton antes de actualizar
        const checkQuery = `
            SELECT id FROM presupuestos_config WHERE activo = true
        `;
        
        const checkResult = await req.db.query(checkQuery);
        
        if (checkResult.rows.length === 0) {
            console.log('[SYNC_CONFIG] ❌ No hay configuración activa para actualizar');
            return res.status(409).json({
                success: false,
                error: 'CONFIG_SINGLETON_VIOLATION',
                activos: 0,
                message: 'No existe configuración activa para actualizar',
                timestamp: new Date().toISOString()
            });
        }
        
        if (checkResult.rows.length > 1) {
            console.log(`[SYNC_CONFIG] ❌ Múltiples configuraciones activas: ${checkResult.rows.length}`);
            return res.status(409).json({
                success: false,
                error: 'CONFIG_SINGLETON_VIOLATION',
                activos: checkResult.rows.length,
                message: 'Múltiples configuraciones activas detectadas',
                timestamp: new Date().toISOString()
            });
        }
        
        // Construir query de actualización dinámico
        const updateFields = [];
        const updateValues = [];
        let paramIndex = 1;
        
        if (auto_sync_enabled !== undefined) {
            updateFields.push(`auto_sync_enabled = $${paramIndex}`);
            updateValues.push(auto_sync_enabled);
            paramIndex++;
        }
        
        if (sync_interval_minutes !== undefined) {
            updateFields.push(`sync_interval_minutes = $${paramIndex}`);
            updateValues.push(sync_interval_minutes);
            paramIndex++;
        }
        
        if (active_hours_start !== undefined) {
            updateFields.push(`active_hours_start = $${paramIndex}`);
            updateValues.push(active_hours_start);
            paramIndex++;
        }
        
        if (active_hours_end !== undefined) {
            updateFields.push(`active_hours_end = $${paramIndex}`);
            updateValues.push(active_hours_end);
            paramIndex++;
        }
        
        if (timezone !== undefined) {
            updateFields.push(`timezone = $${paramIndex}`);
            updateValues.push(timezone.trim());
            paramIndex++;
        }
        
        if (updateFields.length === 0) {
            console.log('[SYNC_CONFIG] ⚠️ No hay campos para actualizar');
            return res.status(400).json({
                success: false,
                error: 'No se proporcionaron campos para actualizar',
                timestamp: new Date().toISOString()
            });
        }
        
        // Agregar fecha_modificacion
        updateFields.push(`fecha_modificacion = NOW()`);
        
        const updateQuery = `
            UPDATE presupuestos_config 
            SET ${updateFields.join(', ')}
            WHERE activo = true
            RETURNING auto_sync_enabled, sync_interval_minutes, active_hours_start, 
                     active_hours_end, timezone
        `;
        
        console.log('[SYNC_CONFIG] Ejecutando actualización:', updateQuery);
        console.log('[SYNC_CONFIG] Valores:', updateValues);
        
        const updateResult = await req.db.query(updateQuery, updateValues);
        
        if (updateResult.rows.length === 0) {
            console.log('[SYNC_CONFIG] ❌ No se actualizó ningún registro');
            return res.status(500).json({
                success: false,
                error: 'No se pudo actualizar la configuración',
                timestamp: new Date().toISOString()
            });
        }
        
        const updatedConfig = updateResult.rows[0];
        
        // Formatear respuesta con defaults
        const response = {
            auto_sync_enabled: updatedConfig.auto_sync_enabled || false,
            sync_interval_minutes: updatedConfig.sync_interval_minutes || 1,
            active_hours_start: updatedConfig.active_hours_start || '08:00',
            active_hours_end: updatedConfig.active_hours_end || '20:00',
            timezone: updatedConfig.timezone || 'America/Argentina/Buenos_Aires'
        };
        
        // Formatear horas a HH:mm si vienen como time
        if (response.active_hours_start && typeof response.active_hours_start === 'object') {
            response.active_hours_start = response.active_hours_start.toString().substring(0, 5);
        }
        if (response.active_hours_end && typeof response.active_hours_end === 'object') {
            response.active_hours_end = response.active_hours_end.toString().substring(0, 5);
        }
        
        console.log('[SYNC_CONFIG] ✅ Configuración actualizada:', response);
        
        res.json(response);
        
    } catch (error) {
        console.error('[SYNC_CONFIG] ❌ Error al actualizar configuración:', error);
        res.status(500).json({
            success: false,
            error: 'Error interno al actualizar configuración de autosync',
            message: error.message,
            timestamp: new Date().toISOString()
        });
    }
};

/**
 * Obtener estado de salud del autosync
 */
const obtenerEstadoSalud = async (req, res) => {
    console.log('[SYNC_CONFIG] GET /sync/health - Obteniendo estado de salud del autosync');
    
    try {
        // Importar función de estado del scheduler
        const { getHealth } = require('../scheduler/auto_sync');
        
        // Obtener estado real del scheduler
        const schedulerHealth = getHealth();
        
        console.log('[SYNC_CONFIG] ✅ Estado de salud del scheduler:', schedulerHealth);
        
        res.json(schedulerHealth);
        
    } catch (error) {
        console.error('[SYNC_CONFIG] ❌ Error al obtener estado de salud:', error);
        res.status(500).json({
            success: false,
            error: 'Error interno al obtener estado de salud del autosync',
            message: error.message,
            timestamp: new Date().toISOString()
        });
    }
};

console.log('[SYNC_CONFIG] ✅ Controlador de configuración de autosync configurado');

module.exports = {
    obtenerConfiguracionSync,
    actualizarConfiguracionSync,
    obtenerEstadoSalud
};
