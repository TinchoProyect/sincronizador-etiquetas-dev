const { Pool } = require('pg');
require('dotenv').config();

const pool = new Pool({
    user: process.env.DB_USER || 'postgres',
    host: process.env.DB_HOST || 'localhost',
    database: process.env.DB_NAME || 'etiquetas',
    password: process.env.DB_PASSWORD || 'ta3Mionga',
    port: parseInt(process.env.DB_PORT || '5432'),
});

async function inspectArticulos() {
    try {
        console.log('Inspeccionando tabla articulos...');
        const res = await pool.query(`
            SELECT column_name, data_type, is_nullable
            FROM information_schema.columns
            WHERE table_name = 'articulos'
            AND column_name IN ('id', 'codigo_barras', 'articulo_numero');
        `);
        console.table(res.rows);

        console.log('Verificando Constraints (PK/Unique)...');
        const constraints = await pool.query(`
            SELECT tc.constraint_name, tc.constraint_type, kcu.column_name
            FROM information_schema.table_constraints tc
            JOIN information_schema.key_column_usage kcu 
              ON tc.constraint_name = kcu.constraint_name
            WHERE tc.table_name = 'articulos';
        `);
        console.table(constraints.rows);

    } catch (err) {
        console.error(err);
    } finally {
        pool.end();
    }
}

inspectArticulos();
