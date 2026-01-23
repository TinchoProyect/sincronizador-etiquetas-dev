const { Pool } = require('pg');
require('dotenv').config();

const pool = new Pool({
    user: process.env.DB_USER || 'postgres',
    host: process.env.DB_HOST || 'localhost',
    database: process.env.DB_NAME || 'etiquetas',
    password: process.env.DB_PASSWORD || 'ta3Mionga',
    port: parseInt(process.env.DB_PORT || '5432'),
});

async function checkNumero() {
    try {
        console.log('Verificando columna numero en articulos...');

        // 1. Constraints
        console.log('--- Constraints ---');
        const constraints = await pool.query(`
            SELECT tc.constraint_name, tc.constraint_type
            FROM information_schema.table_constraints tc
            JOIN information_schema.key_column_usage kcu 
              ON tc.constraint_name = kcu.constraint_name
            WHERE tc.table_name = 'articulos' AND kcu.column_name = 'numero';
        `);
        console.table(constraints.rows);

        // 2. Unicidad real
        console.log('--- Unicidad de Datos ---');
        const counts = await pool.query("SELECT COUNT(*) as total, COUNT(DISTINCT numero) as unicos FROM articulos");
        console.table(counts.rows);

    } catch (err) {
        console.error(err);
    } finally {
        pool.end();
    }
}

checkNumero();
