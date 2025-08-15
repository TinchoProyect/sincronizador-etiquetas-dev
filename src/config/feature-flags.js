/**
 * Feature Flags para el sistema
 * Controla qué funcionalidades están habilitadas
 */

require('dotenv').config();

console.log('🔍 [FEATURE-FLAGS] Configurando feature flags...');

/**
 * Feature flag para usar Service Account en lugar de OAuth2
 * Default: true (usar Service Account)
 * Para volver a OAuth2: USE_SA_SHEETS=false en .env
 */
const USE_SA_SHEETS = process.env.USE_SA_SHEETS !== 'false'; // Default true

/**
 * Feature flag para habilitar el panel nuevo de Google Sheets
 * Default: false (panel deshabilitado)
 * Para habilitar: GSHEETS_PANEL_ENABLED=true en .env
 */
const GSHEETS_PANEL_ENABLED = process.env.GSHEETS_PANEL_ENABLED === 'true'; // Default false

/**
 * Feature flag para logs detallados de Google Sheets
 * Default: false (logs normales)
 * Para habilitar: GSHEETS_DEBUG=true en .env
 */
const GSHEETS_DEBUG = process.env.GSHEETS_DEBUG === 'true'; // Default false

/**
 * Feature flag para sincronización automática
 * Default: false (sincronización manual)
 * Para habilitar: AUTO_SYNC_ENABLED=true en .env
 */
const AUTO_SYNC_ENABLED = process.env.AUTO_SYNC_ENABLED === 'true'; // Default false

/**
 * Feature flag para panel de sincronización
 * Default: true (panel habilitado)
 * Para deshabilitar: SYNC_PANEL_ENABLED=false en .env
 */
const SYNC_PANEL_ENABLED = process.env.SYNC_PANEL_ENABLED !== 'false'; // Default true

/**
 * Feature flag para modo de desarrollo
 * Default: false (modo producción)
 * Para habilitar: DEV_MODE=true en .env
 */
const DEV_MODE = process.env.DEV_MODE === 'true'; // Default false

/**
 * Feature flag para logs de depuración SQL
 * Default: false (sin logs SQL)
 * Para habilitar: SQL_DEBUG=true en .env
 */
const SQL_DEBUG = process.env.SQL_DEBUG === 'true'; // Default false

// Log de configuración actual
console.log('🔍 [FEATURE-FLAGS] Configuración actual:');
console.log('  USE_SA_SHEETS:', USE_SA_SHEETS);
console.log('  GSHEETS_PANEL_ENABLED:', GSHEETS_PANEL_ENABLED);
console.log('  GSHEETS_DEBUG:', GSHEETS_DEBUG);
console.log('  AUTO_SYNC_ENABLED:', AUTO_SYNC_ENABLED);
console.log('  SYNC_PANEL_ENABLED:', SYNC_PANEL_ENABLED);
console.log('  DEV_MODE:', DEV_MODE);
console.log('  SQL_DEBUG:', SQL_DEBUG);

const featureFlags = {
    USE_SA_SHEETS,
    GSHEETS_PANEL_ENABLED,
    GSHEETS_DEBUG,
    AUTO_SYNC_ENABLED,
    SYNC_PANEL_ENABLED,
    DEV_MODE,
    SQL_DEBUG
};

console.log('✅ [FEATURE-FLAGS] Feature flags configurados');

module.exports = featureFlags;
