#!/usr/bin/env node
/**
 * Ejecutor CLI idempotente del saneamiento de Línea de Negocio 4 (Tostaderos) y Artículos Puente.
 * Uso: node scripts/migrarSaneamientoLinea4.js
 */
require('dotenv').config();
const pool = require('../src/produccion/config/database');
const { ejecutarSaneamientoLinea4 } = require('../src/produccion/migrations/saneamientoLinea4');

async function main() {
    console.log('🔧 [MIGRACIÓN LDN4] Ejecutando saneamiento idempotente de Línea 4 y Artículos Puente...');
    const resumen = await ejecutarSaneamientoLinea4(pool);
    console.log('✅ [MIGRACIÓN LDN4] Resultado:', JSON.stringify(resumen, null, 2));
    await pool.end();
}

main().catch(async (err) => {
    console.error('❌ [MIGRACIÓN LDN4] Error:', err);
    try { await pool.end(); } catch (_) {}
    process.exit(1);
});
