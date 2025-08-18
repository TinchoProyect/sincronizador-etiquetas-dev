console.log('[AUTO_SYNC] Cargando scheduler de sincronización automática...');

// Importar el MISMO motor que usa el botón manual (corrección de fechas)
const { ejecutarCorreccionFechas } = require('../../services/gsheets/sync_fechas_fix');

/**
 * Scheduler de sincronización automática sin dependencias externas
 * Usa setInterval con intervalo dinámico basado en configuración
 */

// Estado interno del scheduler
let schedulerState = {
    db: null,
    intervalId: null,
    isSchedulerActive: false,  // Si el scheduler está activo (setInterval corriendo)
    isSyncRunning: false,      // Si hay una sincronización en progreso
    currentIntervalMinutes: 1, // Intervalo actual en minutos
    lastRunAt: null,
    nextRunAt: null,
    lastResult: {
        ok: null,
        processed: 0,
        error: null
    }
};

/**
 * Obtener hora actual en timezone específico como HH:mm
 */
function getCurrentTimeInTimezone(timezone) {
    try {
        const now = new Date();
        const formatter = new Intl.DateTimeFormat('en-US', {
            hour: '2-digit',
            minute: '2-digit',
            hour12: false,
            timeZone: timezone
        });
        
        const parts = formatter.formatToParts(now);
        const hour = parts.find(part => part.type === 'hour').value;
        const minute = parts.find(part => part.type === 'minute').value;
        
        return `${hour}:${minute}`;
    } catch (error) {
        console.error('[AUTO_SYNC] ❌ Error al obtener hora en timezone:', error);
        // Fallback a hora local
        const now = new Date();
        const hour = String(now.getHours()).padStart(2, '0');
        const minute = String(now.getMinutes()).padStart(2, '0');
        return `${hour}:${minute}`;
    }
}

/**
 * Convertir HH:mm a minutos desde medianoche
 */
function timeToMinutes(timeStr) {
    if (!timeStr || typeof timeStr !== 'string') return 0;
    
    const [hours, minutes] = timeStr.split(':').map(Number);
    if (isNaN(hours) || isNaN(minutes)) return 0;
    
    return hours * 60 + minutes;
}

/**
 * Verificar si la hora actual está dentro de la ventana activa
 * Contempla cruce de medianoche
 */
function isWithinActiveHours(currentTime, startTime, endTime) {
    const current = timeToMinutes(currentTime);
    const start = timeToMinutes(startTime);
    const end = timeToMinutes(endTime);
    
    if (start === end) {
        // Si start == end, consideramos que está siempre activo
        return true;
    }
    
    if (start < end) {
        // Mismo día: 08:00 - 20:00
        return current >= start && current < end;
    } else {
        // Cruce de medianoche: 22:00 - 06:00
        return current >= start || current < end;
    }
}

/**
 * Verificar si han pasado suficientes minutos desde la última ejecución
 */
function shouldRunBasedOnInterval(lastRunAt, intervalMinutes) {
    if (!lastRunAt) return true;
    
    const now = new Date();
    const lastRun = new Date(lastRunAt);
    const diffMinutes = (now - lastRun) / (1000 * 60);
    
    return diffMinutes >= intervalMinutes;
}

/**
 * Calcular próxima ejecución estimada
 */
function calculateNextRunAt(config) {
    if (!config.auto_sync_enabled) return null;
    
    const now = new Date();
    const currentTime = getCurrentTimeInTimezone(config.timezone);
    
    // Si estamos dentro de la ventana activa
    if (isWithinActiveHours(currentTime, config.active_hours_start, config.active_hours_end)) {
        // Próxima ejecución en sync_interval_minutes
        const nextRun = new Date(now.getTime() + (config.sync_interval_minutes * 60 * 1000));
        return nextRun.toISOString();
    }
    
    // Si estamos fuera de la ventana, calcular próximo inicio de ventana
    const tomorrow = new Date(now);
    tomorrow.setDate(tomorrow.getDate() + 1);
    
    // Construir fecha con hora de inicio en el timezone correcto
    const startHour = parseInt(config.active_hours_start.split(':')[0]);
    const startMinute = parseInt(config.active_hours_start.split(':')[1]);
    
    const nextStart = new Date(tomorrow);
    nextStart.setHours(startHour, startMinute, 0, 0);
    
    return nextStart.toISOString();
}

/**
 * Obtener configuración activa de la base de datos
 */
async function getActiveConfig(db) {
    try {
        const query = `
            SELECT id, hoja_url, hoja_id, hoja_nombre, rango, usuario_id,
                   auto_sync_enabled, sync_interval_minutes, 
                   active_hours_start, active_hours_end, timezone
            FROM presupuestos_config 
            WHERE activo = true
        `;
        
        const result = await db.query(query);
        
        if (result.rows.length === 0) {
            console.log('[AUTO_SYNC] ⚠️ No hay configuración activa');
            return null;
        }
        
        if (result.rows.length > 1) {
            console.log(`[AUTO_SYNC] ⚠️ Múltiples configuraciones activas: ${result.rows.length}`);
            return null;
        }
        
        const config = result.rows[0];
        
        // Aplicar defaults
        return {
            ...config,
            auto_sync_enabled: config.auto_sync_enabled || false,
            sync_interval_minutes: config.sync_interval_minutes || 1,
            active_hours_start: config.active_hours_start || '08:00',
            active_hours_end: config.active_hours_end || '20:00',
            timezone: config.timezone || 'America/Argentina/Buenos_Aires'
        };
        
    } catch (error) {
        console.error('[AUTO_SYNC] ❌ Error al obtener configuración:', error);
        return null;
    }
}

/**
 * Ejecutar sincronización usando EXACTAMENTE el mismo motor del botón manual
 */
async function executeSyncronization(config, db) {
    console.log('[AUTO_SYNC] 🔄 Ejecutando sincronización automática con motor manual...');
    
    try {
        // Verificar estado del motor antes de ejecutar
        const motorEnabled = process.env.SYNC_ENGINE_ENABLED === 'true';
        console.log(`[AUTO_SYNC] 🔍 Estado del motor: SYNC_ENGINE_ENABLED=${process.env.SYNC_ENGINE_ENABLED}`);
        
        if (!motorEnabled) {
            console.log('[AUTO_SYNC] ⚠️ Motor deshabilitado, activando temporalmente...');
            process.env.SYNC_ENGINE_ENABLED = 'true';
        }
        
        // Usar EXACTAMENTE el mismo servicio que el botón manual (corrección de fechas)
        console.log('[AUTO_SYNC] 🔄 Llamando a ejecutarCorreccionFechas (mismo flujo que botón manual)...');
        const syncResult = await ejecutarCorreccionFechas(config, db);
        
        // Adaptar resultado del servicio de corrección de fechas al formato esperado
        schedulerState.lastResult = {
            ok: syncResult.exito,
            processed: (syncResult.datosInsertados?.presupuestos || 0) + (syncResult.datosInsertados?.detalles || 0),
            error: syncResult.exito ? null : (syncResult.errores?.join('; ') || 'Error desconocido')
        };
        
        console.log(`[AUTO_SYNC] ✅ Sincronización completada: ${schedulerState.lastResult.processed} registros procesados`);
        console.log(`[AUTO_SYNC] 📊 Fechas corregidas: ${syncResult.fechasCorregidas || 0}`);
        console.log(`[AUTO_SYNC] 📊 Fechas futuras: ${syncResult.fechasFuturas || 0}`);
        
        return {
            exitoso: syncResult.exito,
            registros_procesados: schedulerState.lastResult.processed,
            registros_nuevos: (syncResult.datosInsertados?.presupuestos || 0) + (syncResult.datosInsertados?.detalles || 0),
            registros_actualizados: 0, // Corrección de fechas es full refresh
            errores: syncResult.errores || [],
            fechasCorregidas: syncResult.fechasCorregidas || 0,
            fechasFuturas: syncResult.fechasFuturas || 0
        };
        
    } catch (error) {
        console.error('[AUTO_SYNC] ❌ Error en sincronización automática:', error);
        
        schedulerState.lastResult = {
            ok: false,
            processed: 0,
            error: error.message
        };
        
        throw error;
    }
}

/**
 * Tick del scheduler - se ejecuta cada 60 segundos
 */
async function schedulerTick() {
    try {
        // Obtener configuración actual
        const config = await getActiveConfig(schedulerState.db);
        
        if (!config) {
            console.log('[AUTO_SYNC] ⚠️ No hay configuración válida, omitiendo tick');
            return;
        }
        
        // Verificar si el autosync está habilitado
        if (!config.auto_sync_enabled) {
            console.log('[AUTO_SYNC] ℹ️ Autosync deshabilitado, omitiendo tick');
            schedulerState.nextRunAt = null;
            return;
        }
        
        // Obtener hora actual en timezone configurado
        const currentTime = getCurrentTimeInTimezone(config.timezone);
        
        // Verificar si estamos dentro de la ventana activa
        if (!isWithinActiveHours(currentTime, config.active_hours_start, config.active_hours_end)) {
            console.log(`[AUTO_SYNC] ℹ️ Fuera de ventana activa (${currentTime} no está en ${config.active_hours_start}-${config.active_hours_end})`);
            schedulerState.nextRunAt = calculateNextRunAt(config);
            return;
        }
        
        // Verificar intervalo mínimo
        if (!shouldRunBasedOnInterval(schedulerState.lastRunAt, config.sync_interval_minutes)) {
            console.log(`[AUTO_SYNC] ℹ️ Intervalo no cumplido (${config.sync_interval_minutes} min)`);
            schedulerState.nextRunAt = calculateNextRunAt(config);
            return;
        }
        
        // Verificar mutex para evitar solapamiento
        if (schedulerState.isSyncRunning) {
            console.log('[AUTO_SYNC] ⚠️ Sincronización ya en progreso, omitiendo tick');
            return;
        }
        
        // Ejecutar sincronización
        schedulerState.isSyncRunning = true;
        schedulerState.lastRunAt = new Date().toISOString();
        
        console.log(`[AUTO_SYNC] 🚀 Iniciando sincronización automática (${currentTime} en ${config.timezone})`);
        
        try {
            await executeSyncronization(config, schedulerState.db);
            console.log('[AUTO_SYNC] ✅ Sincronización automática completada exitosamente');
        } catch (syncError) {
            console.error('[AUTO_SYNC] ❌ Error en sincronización automática:', syncError.message);
        }
        
        // Calcular próxima ejecución
        schedulerState.nextRunAt = calculateNextRunAt(config);
        
    } catch (error) {
        console.error('[AUTO_SYNC] ❌ Error en tick del scheduler:', error);
    } finally {
        schedulerState.isSyncRunning = false;
    }
}

/**
 * Iniciar el scheduler con intervalo dinámico
 */
async function start(db) {
    console.log('[AUTO_SYNC] 🚀 Iniciando scheduler de sincronización automática...');
    
    if (schedulerState.intervalId) {
        console.log('[AUTO_SYNC] ⚠️ Scheduler ya está ejecutándose');
        return;
    }
    
    if (!db) {
        console.error('[AUTO_SYNC] ❌ Base de datos requerida para iniciar scheduler');
        return;
    }
    
    // Guardar referencia a la base de datos
    schedulerState.db = db;
    
    try {
        // Obtener configuración para determinar intervalo
        const config = await getActiveConfig(db);
        const intervalMinutes = config?.sync_interval_minutes || 1;
        
        // Guardar intervalo actual
        schedulerState.currentIntervalMinutes = intervalMinutes;
        
        // Iniciar intervalo dinámico basado en configuración
        const intervalMs = intervalMinutes * 60 * 1000;
        schedulerState.intervalId = setInterval(schedulerTick, intervalMs);
        schedulerState.isSchedulerActive = true;
        
        console.log(`[AUTO_SYNC] ✅ Scheduler iniciado con intervalo de ${intervalMinutes} minuto(s)`);
        
        // Ejecutar primer tick después de 5 segundos
        setTimeout(schedulerTick, 5000);
        
    } catch (error) {
        console.error('[AUTO_SYNC] ❌ Error al obtener configuración inicial:', error);
        
        // Fallback: usar intervalo de 1 minuto
        schedulerState.currentIntervalMinutes = 1;
        schedulerState.intervalId = setInterval(schedulerTick, 60 * 1000);
        schedulerState.isSchedulerActive = true;
        
        console.log('[AUTO_SYNC] ⚠️ Usando intervalo por defecto de 1 minuto');
        setTimeout(schedulerTick, 5000);
    }
}

/**
 * Detener el scheduler
 */
function stop() {
    console.log('[AUTO_SYNC] 🛑 Deteniendo scheduler...');
    
    if (schedulerState.intervalId) {
        clearInterval(schedulerState.intervalId);
        schedulerState.intervalId = null;
        schedulerState.isSchedulerActive = false;
        console.log('[AUTO_SYNC] ✅ Scheduler detenido');
    } else {
        console.log('[AUTO_SYNC] ⚠️ Scheduler no estaba ejecutándose');
    }
}

/**
 * Reiniciar el scheduler con nueva configuración
 */
async function restart(db) {
    console.log('[AUTO_SYNC] 🔄 Reiniciando scheduler con nueva configuración...');
    
    // Detener scheduler actual
    stop();
    
    // Esperar un momento para asegurar limpieza
    await new Promise(resolve => setTimeout(resolve, 1000));
    
    // Iniciar con nueva configuración
    await start(db);
    
    console.log('[AUTO_SYNC] ✅ Scheduler reiniciado exitosamente');
}

/**
 * Obtener estado de salud del scheduler
 */
function getHealth() {
    return {
        isRunning: schedulerState.isSchedulerActive,  // Reportar si el scheduler está activo
        isSyncInProgress: schedulerState.isSyncRunning,  // Si hay sync en progreso
        lastRunAt: schedulerState.lastRunAt,
        nextRunAt: schedulerState.nextRunAt,
        lastResult: schedulerState.lastResult
    };
}

console.log('[AUTO_SYNC] ✅ Scheduler de sincronización automática configurado');

module.exports = {
    start,
    stop,
    restart,
    getHealth,
    // Exponer el estado interno para acceso directo
    getState: () => schedulerState
};
