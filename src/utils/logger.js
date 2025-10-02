/**
 * Logger Estándar para Sincronización de Detalles
 * Formato: [TS][MOD][CID] mensaje | meta
 */

const LOG_LEVELS = {
    error: 0,
    warn: 1,
    info: 2,
    debug: 3
};

const CURRENT_LOG_LEVEL = LOG_LEVELS[process.env.LOG_LEVEL] ?? LOG_LEVELS.info;
const ENABLED_MODULES = process.env.LOG_MODULES ? 
    process.env.LOG_MODULES.split(',').map(m => m.trim()) : null;

/**
 * Formatear timestamp ISO corto
 */
function formatTimestamp() {
    return new Date().toISOString().slice(11, 23); // HH:mm:ss.sss
}

/**
 * Verificar si el módulo está habilitado para logging
 */
function isModuleEnabled(module) {
    return !ENABLED_MODULES || ENABLED_MODULES.includes(module);
}

/**
 * Función base de logging
 */
function log(level, module, cid, message, meta = null) {
    if (LOG_LEVELS[level] > CURRENT_LOG_LEVEL) return;
    if (!isModuleEnabled(module)) return;
    
    const timestamp = formatTimestamp();
    const cidStr = cid ? `[${cid}]` : '[---]';
    const metaStr = meta ? ` | ${typeof meta === 'object' ? JSON.stringify(meta) : meta}` : '';
    
    console.log(`[${timestamp}][${module}]${cidStr} ${message}${metaStr}`);
}

/**
 * API del Logger
 */
const logger = {
    error: (module, cid, message, meta) => log('error', module, cid, message, meta),
    warn: (module, cid, message, meta) => log('warn', module, cid, message, meta),
    info: (module, cid, message, meta) => log('info', module, cid, message, meta),
    debug: (module, cid, message, meta) => log('debug', module, cid, message, meta)
};

module.exports = logger;
