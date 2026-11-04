const { Pool } = require('pg');
require('dotenv').config();

const pool = new Pool({
    user: process.env.DB_USER || 'postgres',
    host: process.env.DB_HOST || 'localhost',
    database: process.env.DB_NAME || 'etiquetas',
    password: process.env.DB_PASSWORD || 'ta3Mionga',
    port: parseInt(process.env.DB_PORT || '5432')
});

async function runDrop() {
    try {
        console.log('=== 🚀 ELIMINANDO CONSTRAIN unq_bunker_diccionario_lower_termino ===\n');
        await pool.query(`ALTER TABLE public.bunker_diccionario DROP CONSTRAINT IF EXISTS unq_bunker_diccionario_lower_termino CASCADE;`);
        await pool.query(`DROP INDEX IF EXISTS public.unq_bunker_diccionario_lower_termino CASCADE;`);
        console.log('✅ Restricción unq_bunker_diccionario_lower_termino ELIMINADA CON ÉXITO.');
    } catch (e) {
        console.error('Error:', e);
    } finally {
        await pool.end();
    }
}

runDrop();
