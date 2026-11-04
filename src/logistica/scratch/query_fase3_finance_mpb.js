const BunkerService = require('../services/bunkerService');
const { Pool } = require('pg');
require('dotenv').config();

const pool = new Pool({
    user: process.env.DB_USER || 'postgres',
    host: process.env.DB_HOST || 'localhost',
    database: process.env.DB_NAME || 'etiquetas',
    password: process.env.DB_PASSWORD || 'ta3Mionga',
    port: parseInt(process.env.DB_PORT || '5432')
});

async function queryFinanceMPB() {
    console.log('🔬 ====================================================================');
    console.log('🔬 EXTRACCIÓN EMPÍRICA FASE 3: INGESTA FINANCIERA MPB (v5.44)');
    console.log('🔬 ====================================================================\n');

    try {
        const finData = await BunkerService.obtenerRadiografiaFinanciera(pool, 'MPB');
        console.log('JSON Crudo de BunkerService.obtenerRadiografiaFinanciera(pool, "MPB"):');
        console.log(JSON.stringify(finData, null, 2));

    } catch (err) {
        console.error('❌ Error obteniendo radiografía financiera:', err);
    } finally {
        await pool.end();
    }
}

queryFinanceMPB();
