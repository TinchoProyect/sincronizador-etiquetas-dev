/**
 * Feature Flags para el sistema
 * Controla qué funcionalidades están habilitadas
 * NOTA ETAPA 1 (Nube): Los sincronizadores de transición vieja (Google Sheets / AppSheet)
 * fueron desactivados permanentemente.
 */

require('dotenv').config();

const USE_SA_SHEETS = false;
const GSHEETS_PANEL_ENABLED = false;
const GSHEETS_DEBUG = false;
const AUTO_SYNC_ENABLED = false;
const SYNC_PANEL_ENABLED = false;
const DEV_MODE = process.env.DEV_MODE === 'true';
const SQL_DEBUG = process.env.SQL_DEBUG === 'true';

const featureFlags = {
    USE_SA_SHEETS,
    GSHEETS_PANEL_ENABLED,
    GSHEETS_DEBUG,
    AUTO_SYNC_ENABLED,
    SYNC_PANEL_ENABLED,
    DEV_MODE,
    SQL_DEBUG
};

module.exports = featureFlags;
