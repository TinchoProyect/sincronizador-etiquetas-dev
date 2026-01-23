const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');
require('dotenv').config();

const pool = new Pool({
    user: process.env.DB_USER || 'postgres',
    host: process.env.DB_HOST || 'localhost',
    database: process.env.DB_NAME || 'etiquetas',
    password: process.env.DB_PASSWORD || 'ta3Mionga',
    port: parseInt(process.env.DB_PORT || '5432'),
});

async function repairInfrastructure() {
    try {
        console.log('👷 INICIANDO REPARACIÓN DE INFRAESTRUCTURA (Split Execution)');

        // --- BLOQUE 1: DDL ---
        console.log('\n🔵 EJECUTANDO BLOQUE 1: DDL (Tablas y Columnas)...');
        const sqlDDL = fs.readFileSync(path.join(__dirname, 'src', 'produccion', 'sql', '01_infraestructura_mantenimiento_ddl.sql'), 'utf8');
        await pool.query(sqlDDL);
        console.log('✅ Bloque 1 Completado.');

        // --- VERIFICACIÓN INTERMEDIA ---
        console.log('🔍 Verificando existencia de DDL...');
        const checkCol = await pool.query("SELECT column_name FROM information_schema.columns WHERE table_name = 'stock_real_consolidado' AND column_name = 'stock_mantenimiento'");
        if (checkCol.rows.length === 0) throw new Error('Falló la creación de columna stock_mantenimiento');

        const checkTab = await pool.query("SELECT table_name FROM information_schema.tables WHERE table_name = 'mantenimiento_movimientos'");
        if (checkTab.rows.length === 0) throw new Error('Falló la creación de tabla mantenimiento_movimientos');

        console.log('✅ Verificación Intermedia OK. Estructura existe.');

        // --- BLOQUE 2: FUNCIÓN ---
        console.log('\n🔵 EJECUTANDO BLOQUE 2: LÓGICA (Función)...');
        const sqlFunc = fs.readFileSync(path.join(__dirname, 'src', 'produccion', 'sql', '02_infraestructura_mantenimiento_func.sql'), 'utf8');
        await pool.query(sqlFunc);
        console.log('✅ Bloque 2 Completado.');

        console.log('\n🎉 REPARACIÓN EXITOSA. Listo para auditoría final.');

    } catch (error) {
        console.error('❌ ERROR FATAL EN REPARACIÓN:', error);
    } finally {
        pool.end();
    }
}

repairInfrastructure();
