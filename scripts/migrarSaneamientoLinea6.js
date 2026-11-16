#!/usr/bin/env node
/**
 * Ejecutor CLI idempotente del saneamiento de Línea de Negocio 6 (Granolas: GFGN y GSGN).
 * Uso: node scripts/migrarSaneamientoLinea6.js
 */
require('dotenv').config();
const pool = require('../src/produccion/config/database');
const { ejecutarSaneamientoLinea6 } = require('../src/produccion/migrations/saneamientoLinea6');

async function main() {
    console.log('🔧 [MIGRACIÓN LDN6] Ejecutando saneamiento idempotente de Línea 6 (Granolas)...');
    const resumen = await ejecutarSaneamientoLinea6(pool);
    console.log('✅ [MIGRACIÓN LDN6] Resultado:', JSON.stringify(resumen, null, 2));
    await pool.end();
}

main().catch(async (err) => {
    console.error('❌ [MIGRACIÓN LDN6] Error:', err);
    try { await pool.end(); } catch (_) {}
    process.exit(1);
});
