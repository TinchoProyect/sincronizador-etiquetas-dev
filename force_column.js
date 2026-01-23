const { Pool } = require('pg');
require('dotenv').config();

const pool = new Pool({
    user: process.env.DB_USER || 'postgres',
    host: process.env.DB_HOST || 'localhost',
    database: process.env.DB_NAME || 'etiquetas',
    password: process.env.DB_PASSWORD || 'ta3Mionga',
    port: parseInt(process.env.DB_PORT || '5432'),
});

async function forceColumn() {
    try {
        console.log('🔨 Forzando ADD COLUMN stock_mantenimiento...');
        // Comprobar si existe primero para evitar errores en log sucio
        const check = await pool.query("SELECT * FROM information_schema.columns WHERE table_name='stock_real_consolidado' AND column_name='stock_mantenimiento'");

        if (check.rows.length === 0) {
            await pool.query("ALTER TABLE public.stock_real_consolidado ADD COLUMN stock_mantenimiento NUMERIC(10,3) DEFAULT 0");
            console.log('✅ ALTER TABLE ejecutado.');
        } else {
            console.log('ℹ️ La columna ya existe (segun check pre-alter).');
        }

    } catch (error) {
        console.error('❌ Error forzando columna:', error);
    } finally {
        pool.end();
    }
}

forceColumn();
