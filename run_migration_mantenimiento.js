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

async function runMigration() {
    try {
        const sqlPath = path.join(__dirname, 'src', 'produccion', 'sql', '01_infraestructura_mantenimiento.sql');
        console.log(`📖 Leyendo script SQL de: ${sqlPath}`);

        const sql = fs.readFileSync(sqlPath, 'utf8');

        console.log('🔄 Ejecutando script SQL...');
        await pool.query(sql);

        console.log('✅ Script SQL ejecutado exitosamente.');

        // Verificación
        console.log('\n🔍 Verificando cambios...');

        // 1. Verificar Columna
        const chkCol = await pool.query(`
            SELECT column_name 
            FROM information_schema.columns 
            WHERE table_name = 'stock_real_consolidado' 
            AND column_name = 'stock_mantenimiento'
        `);
        console.log(`- Columna stock_mantenimiento: ${chkCol.rows.length > 0 ? '✅ EXISTE' : '❌ NO EXISTE'}`);

        // 2. Verificar Tabla Auditoría
        const chkTable = await pool.query(`
            SELECT table_name 
            FROM information_schema.tables 
            WHERE table_name = 'mantenimiento_movimientos'
        `);
        console.log(`- Tabla mantenimiento_movimientos: ${chkTable.rows.length > 0 ? '✅ EXISTE' : '❌ NO EXISTE'}`);

        // 3. Verificar Función
        const chkFunc = await pool.query(`
            SELECT routine_name 
            FROM information_schema.routines 
            WHERE routine_name = 'liberar_stock_mantenimiento'
        `);
        console.log(`- Función liberar_stock_mantenimiento: ${chkFunc.rows.length > 0 ? '✅ EXISTE' : '❌ NO EXISTE'}`);

    } catch (error) {
        console.error('❌ Error durante la migración:', error);
    } finally {
        await pool.end();
    }
}

runMigration();
