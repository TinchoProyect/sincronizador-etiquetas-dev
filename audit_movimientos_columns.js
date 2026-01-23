const { Pool } = require('pg');
require('dotenv').config();

const pool = new Pool({
    user: process.env.DB_USER || 'postgres',
    host: process.env.DB_HOST || 'localhost',
    database: process.env.DB_NAME || 'etiquetas',
    password: process.env.DB_PASSWORD || 'ta3Mionga',
    port: parseInt(process.env.DB_PORT || '5432'),
});

async function auditColumns() {
    try {
        console.log('\n🔍 EVIDENCIA DE ESTRUCTURA DESACOPLADA:');
        console.log('Tabla: PUBLIC.MANTENIMIENTO_MOVIMIENTOS\n');

        const res = await pool.query(`
            SELECT column_name, data_type, is_nullable
            FROM information_schema.columns 
            WHERE table_name = 'mantenimiento_movimientos'
            ORDER BY ordinal_position;
        `);
        console.table(res.rows);

        console.log('\n🔍 Verificando FOREIGN KEYS (Debería estar vacío):');
        const fks = await pool.query(`
            SELECT tc.constraint_name, kcu.column_name, ccu.table_name AS references_table
            FROM information_schema.table_constraints tc
            JOIN information_schema.key_column_usage kcu ON tc.constraint_name = kcu.constraint_name
            JOIN information_schema.constraint_column_usage ccu ON ccu.constraint_name = tc.constraint_name
            WHERE tc.constraint_type = 'FOREIGN KEY' AND tc.table_name = 'mantenimiento_movimientos';
        `);
        if (fks.rows.length === 0) {
            console.log('✅ CERO FOREIGN KEYS DETECTADAS (Correcto).');
        } else {
            console.table(fks.rows);
            console.log('⚠️ ADVERTENCIA: SE ENCONTRARON CLAVES FORÁNEAS.');
        }

    } catch (err) {
        console.error(err);
    } finally {
        pool.end();
    }
}

auditColumns();
