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

async function forceFunc() {
    try {
        console.log('⚡ Forzando creación de función liberar_stock_mantenimiento...');
        const sqlFunc = fs.readFileSync(path.join(__dirname, 'src', 'produccion', 'sql', '02_infraestructura_mantenimiento_func.sql'), 'utf8');
        await pool.query(sqlFunc);
        console.log('✅ Función CREADA/ACTUALIZADA.');

    } catch (error) {
        console.error('❌ Error forzando función:', error);
    } finally {
        pool.end();
    }
}

forceFunc();
