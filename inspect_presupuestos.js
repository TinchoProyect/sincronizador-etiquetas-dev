const { Pool } = require('pg');
require('dotenv').config();

const pool = new Pool({
    user: process.env.DB_USER || 'postgres',
    host: process.env.DB_HOST || 'localhost',
    database: process.env.DB_NAME || 'etiquetas',
    password: process.env.DB_PASSWORD || 'ta3Mionga',
    port: parseInt(process.env.DB_PORT || '5432'),
});

async function inspectPresupuestos() {
    try {
        console.log('Inspeccionando tabla presupuestos_datos...');

        // Verificar si existe la tabla
        const checkTable = await pool.query(`
            SELECT table_name 
            FROM information_schema.tables 
            WHERE table_name = 'presupuestos_datos'
        `);

        if (checkTable.rows.length === 0) {
            console.log('❌ La tabla presupuestos_datos NO existe en esta BD.');
            // Intentar listar tablas que contengan "presupuesto"
            const search = await pool.query(`
                SELECT table_name 
                FROM information_schema.tables 
                WHERE table_name LIKE '%presupuesto%'
            `);
            console.log('Tablas relacionadas encontradas:', search.rows);
            return;
        }

        // Listar columnas
        const res = await pool.query(`
            SELECT column_name, data_type, is_nullable
            FROM information_schema.columns 
            WHERE table_name = 'presupuestos_datos'
            ORDER BY ordinal_position;
        `);
        console.table(res.rows);

    } catch (err) {
        console.error(err);
    } finally {
        pool.end();
    }
}

inspectPresupuestos();
