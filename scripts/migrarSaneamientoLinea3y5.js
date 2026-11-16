#!/usr/bin/env node
/**
 * Ejecutor CLI idempotente del saneamiento de Línea de Negocio 3 (Mixes) y Línea de Negocio 5 (Barritas).
 * Uso: node scripts/migrarSaneamientoLinea3y5.js
 */
require('dotenv').config();
const pool = require('../src/produccion/config/database');
const { ejecutarSaneamientoLinea3y5 } = require('../src/produccion/migrations/saneamientoLinea3y5');

async function main() {
    console.log('🔧 [MIGRACIÓN LDN3+LDN5] Ejecutando saneamiento idempotente de Línea 3 (Mixes) y Línea 5 (Barritas)...');
    const resumen = await ejecutarSaneamientoLinea3y5(pool);
    console.log('✅ [MIGRACIÓN LDN3+LDN5] Resultado:', JSON.stringify(resumen, null, 2));
    await pool.end();
}

main().catch(async (err) => {
    console.error('❌ [MIGRACIÓN LDN3+LDN5] Error:', err);
    try { await pool.end(); } catch (_) {}
    process.exit(1);
});
