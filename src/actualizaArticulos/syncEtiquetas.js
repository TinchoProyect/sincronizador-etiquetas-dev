// filepath: src/actualizaArticulos/syncEtiquetas.js
'use strict';

/**
 * 🛑 PUENTE LEGACY RETIRADO PERMANENTEMENTE (Etapa 1 — Arquitectura Cloud LAMDA)
 * -----------------------------------------------------------------------------
 * Este script pertenecía a una etapa de transición anterior donde se importaban
 * artículos desde api.lamdaser.com ejecutando DELETE FROM articulos.
 * Hoy el Sistema LAMDA da de alta y gestiona sus propios artículos en forma autónoma.
 * Se neutraliza este archivo para impedir cualquier borrado accidental de tablas locales.
 */

console.warn('═══════════════════════════════════════════════════════════════════════════');
console.warn('🛑 [SYNC-ARTICULOS-LEGACY] PUENTE DE TRANSICIÓN RETIRADO PERMANENTEMENTE');
console.warn('ℹ️  LAMDA gestiona sus propios artículos directamente en el Búnker.');
console.warn('🔒 Se bloqueó preventivamente "DELETE FROM articulos" para proteger la BD.');
console.warn('═══════════════════════════════════════════════════════════════════════════');
process.exit(0);
