// filepath: src/jobs/sync.js
'use strict';

/**
 * 🛑 JOB LEGACY RETIRADO PERMANENTEMENTE (Etapa 1 — Arquitectura Cloud LAMDA)
 * Este job de sincronización con Google Sheets (AppSheet) ya no se utiliza.
 */
console.warn('🛑 [SYNC-JOB-LEGACY] Job de Google Sheets retirado permanentemente.');
module.exports = {
    syncOnce: async () => ({ success: true, retired: true }),
    startScheduledSync: () => ({ start: () => {}, stop: () => {} }),
    upsertPresupuestos: async () => ({ processed: 0 }),
    upsertDetalles: async () => ({ processed: 0 })
};
