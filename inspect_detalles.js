const { Pool } = require('pg');
require('dotenv').config();

const pool = new Pool({
    user: process.env.DB_USER || 'postgres',
    host: process.env.DB_HOST || 'localhost',
    database: process.env.DB_NAME || 'etiquetas',
    password: process.env.DB_PASSWORD || 'ta3Mionga',
    port: parseInt(process.env.DB_PORT || '5432'),
});

async function inspectDetalles() {
    try {
        console.log('Inspeccionando tabla presupuestos_detalles (o similar)...');
        // Buscar tablas candidatas
        const tables = await pool.query(`
            SELECT table_name FROM information_schema.tables 
            WHERE table_name LIKE '%detalle%'
        `);
        console.log('Tablas encontradas:', tables.rows.map(r => r.table_name));

        // Asumimos 'presupuestos_detalles' o similar
        const tableName = tables.rows.find(r => r.table_name.includes('presupuestos_detalle'))?.table_name || 'presupuestos_detalles';

        console.log(`Columnas de ${tableName}:`);
        const res = await pool.query(`
            SELECT column_name, data_type 
            FROM information_schema.columns 
            WHERE table_name = '${tableName}'
        `);
        console.table(res.rows);

    } catch (err) {
        console.error(err);
    } finally {
        pool.end();
    }
}

inspectDetalles();
