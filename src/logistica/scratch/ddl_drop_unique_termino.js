const { Pool } = require('pg');
require('dotenv').config();

const pool = new Pool({
    user: process.env.DB_USER || 'postgres',
    host: process.env.DB_HOST || 'localhost',
    database: process.env.DB_NAME || 'etiquetas',
    password: process.env.DB_PASSWORD || 'ta3Mionga',
    port: parseInt(process.env.DB_PORT || '5432')
});

async function runDDL() {
    const client = await pool.connect();
    try {
        console.log('=== 🚀 PASO 1: ELIMINACIÓN DE RESTRICCIÓN UNIQUE POR TEXTO EN bunker_diccionario ===\n');

        await client.query('BEGIN');

        // Drop any UNIQUE constraint or index on LOWER(termino) or termino
        console.log('1. Eliminando índices/restricciones de unicidad por texto...');
        await client.query(`
            DROP INDEX IF EXISTS public.idx_bunker_diccionario_termino_lower;
            DROP INDEX IF EXISTS public.bunker_diccionario_termino_key;
            DROP INDEX IF EXISTS public.bunker_diccionario_termino_lower_idx;
        `);
        
        // Also check table constraints
        const resCons = await client.query(`
            SELECT constraint_name 
            FROM information_schema.table_constraints 
            WHERE table_name = 'bunker_diccionario' AND constraint_type = 'UNIQUE';
        `);
        for (const r of resCons.rows) {
            console.log(`   - Eliminando restricción UNIQUE: ${r.constraint_name}...`);
            await client.query(`ALTER TABLE public.bunker_diccionario DROP CONSTRAINT IF EXISTS "${r.constraint_name}";`);
        }

        await client.query('COMMIT');
        console.log('\n✅ PASO 1 COMPLETADO CON ÉXITO: Base de datos liberada de restricciones por texto.');

    } catch (e) {
        await client.query('ROLLBACK');
        console.error('❌ Error en DDL SQL:', e);
        process.exit(1);
    } finally {
        client.release();
        await pool.end();
    }
}

runDDL();
