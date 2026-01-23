const { Pool } = require('pg');
require('dotenv').config();

const pool = new Pool({
    user: process.env.DB_USER || 'postgres',
    host: process.env.DB_HOST || 'localhost',
    database: process.env.DB_NAME || 'etiquetas',
    password: process.env.DB_PASSWORD || 'ta3Mionga',
    port: parseInt(process.env.DB_PORT || '5432'),
});

async function audit() {
    try {
        console.log('--- AUDITORÍA DE CONEXIÓN ---');
        console.log(`DB_HOST: ${process.env.DB_HOST || 'localhost'}`);
        console.log(`DB_NAME: ${process.env.DB_NAME || 'etiquetas'}`);
        console.log(`DB_PORT: ${process.env.DB_PORT || '5432'}`);
        console.log('-----------------------------');

        console.log('\n--- VERIFICACIÓN DE ESQUEMA ---');

        // 1. Verificar Columna stock_mantenimiento
        console.log('1. Buscando columna stock_mantenimiento en stock_real_consolidado...');
        const colRes = await pool.query(`
            SELECT column_name, data_type 
            FROM information_schema.columns 
            WHERE table_name = 'stock_real_consolidado' 
            AND column_name = 'stock_mantenimiento'
        `);
        if (colRes.rows.length > 0) {
            console.table(colRes.rows);
        } else {
            console.log('❌ Columna NO ENCONTRADA.');
        }

        // 2. Verificar Tabla mantenimiento_movimientos
        console.log('\n2. Buscando tabla mantenimiento_movimientos...');
        const tableRes = await pool.query(`
            SELECT table_name 
            FROM information_schema.tables 
            WHERE table_name = 'mantenimiento_movimientos'
        `);
        if (tableRes.rows.length > 0) {
            console.log('✅ Tabla ENCONTRADA.');
            // Descripcion de columnas
            const cols = await pool.query(`
                SELECT column_name, data_type 
                FROM information_schema.columns 
                WHERE table_name = 'mantenimiento_movimientos'
            `);
            console.table(cols.rows);
        } else {
            console.log('❌ Tabla NO ENCONTRADA.');
        }

    } catch (error) {
        console.error('❌ Error en auditoría:', error);
    } finally {
        pool.end();
    }
}

audit();
