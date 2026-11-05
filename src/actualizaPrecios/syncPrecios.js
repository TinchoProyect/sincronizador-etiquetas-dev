// filepath: src/actualizaPrecios/syncPrecios.js
'use strict';

/**
 * 🛑 PUENTE LEGACY RETIRADO PERMANENTEMENTE (Etapa 1 — Arquitectura Cloud LAMDA)
 * -----------------------------------------------------------------------------
 * Este script pertenecía a una etapa de transición anterior donde se importaban
 * precios desde api.lamdaser.com ejecutando TRUNCATE TABLE precios_articulos.
 * Hoy el Sistema LAMDA gestiona sus propios costos y listas de precios en el Búnker.
 * Se neutraliza este archivo para impedir cualquier vaciado accidental de precios_articulos.
 */

console.warn('═══════════════════════════════════════════════════════════════════════════');
console.warn('🛑 [SYNC-PRECIOS-LEGACY] PUENTE DE TRANSICIÓN RETIRADO PERMANENTEMENTE');
console.warn('ℹ️  LAMDA gestiona sus propios costos y precios directamente en el Búnker.');
console.warn('🔒 Se bloqueó preventivamente "TRUNCATE TABLE precios_articulos".');
console.warn('═══════════════════════════════════════════════════════════════════════════');
process.exit(0);
