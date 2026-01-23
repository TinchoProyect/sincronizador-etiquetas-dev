const { Pool } = require('pg');
require('dotenv').config();

const pool = new Pool({
    user: process.env.DB_USER || 'postgres',
    host: process.env.DB_HOST || 'localhost',
    database: process.env.DB_NAME || 'etiquetas',
    password: process.env.DB_PASSWORD || 'ta3Mionga',
    port: parseInt(process.env.DB_PORT || '5432'),
});

async function runAudit() {
    try {
        console.log('\n╔══════════════════════════════════════════╗');
        console.log('║ 🕵️ AUDITORÍA DE EVIDENCIA TÉCNICA       ║');
        console.log('╚══════════════════════════════════════════╝');

        console.log('\n📡 CONEXIÓN ACTUAL:');
        console.log(`   - HOST: ${process.env.DB_HOST || 'localhost'}`);
        console.log(`   - PORT: ${process.env.DB_PORT || '5432'}`);
        console.log(`   - DB:   ${process.env.DB_NAME || 'etiquetas'}`);
        console.log('--------------------------------------------');

        // 1. Existencia de Tabla y Columna
        console.log('\n1️⃣  Existencia de Tabla STOCK_REAL_CONSOLIDADO y Columna STOCK_MANTENIMIENTO:');
        const q1 = `
            SELECT table_name, column_name, data_type 
            FROM information_schema.columns 
            WHERE table_name = 'stock_real_consolidado' AND column_name = 'stock_mantenimiento';
        `;
        const res1 = await pool.query(q1);
        if (res1.rows.length > 0) console.table(res1.rows);
        else console.log('❌ 0 filas (NO EXISTE)');

        // 2. Existencia de la Tabla de Movimientos
        console.log('\n2️⃣  Existencia de tabla MANTENIMIENTO_MOVIMIENTOS:');
        const q2 = `
            SELECT table_name, table_type 
            FROM information_schema.tables 
            WHERE table_name = 'mantenimiento_movimientos';
        `;
        const res2 = await pool.query(q2);
        if (res2.rows.length > 0) console.table(res2.rows);
        else console.log('❌ 0 filas (NO EXISTE)');

        // 3. Existencia del Motor (Función)
        console.log('\n3️⃣  Existencia de función LIBERAR_STOCK_MANTENIMIENTO:');
        const q3 = `
            SELECT routine_name 
            FROM information_schema.routines 
            WHERE routine_name = 'liberar_stock_mantenimiento';
        `;
        const res3 = await pool.query(q3);
        if (res3.rows.length > 0) console.table(res3.rows);
        else console.log('❌ 0 filas (NO EXISTE)');

        console.log('\n════════════════════════════════════════════');

    } catch (error) {
        console.error('❌ ERROR FATAL EN AUDITORÍA:', error);
    } finally {
        pool.end();
    }
}

runAudit();
