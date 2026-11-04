const { Pool } = require('pg');
require('dotenv').config();

const pool = new Pool({
    user: process.env.DB_USER || 'postgres',
    host: process.env.DB_HOST || 'localhost',
    database: process.env.DB_NAME || 'etiquetas',
    password: process.env.DB_PASSWORD || 'ta3Mionga',
    port: parseInt(process.env.DB_PORT || '5432')
});

async function createBackupV510() {
    console.log('🔒 ====================================================================');
    console.log('🔒 VOLCADO DE SEGURIDAD (BACKUP DML PREVENTIVO v5.10)');
    console.log('🔒 ====================================================================\n');

    const client = await pool.connect();
    try {
        await client.query('BEGIN');

        // Drop previous backup table if exists
        await client.query(`DROP TABLE IF EXISTS public.bunker_articulos_backup_v510;`);

        // Create full snapshot backup table
        const backupRes = await client.query(`
            CREATE TABLE public.bunker_articulos_backup_v510 AS 
            SELECT * FROM public.bunker_articulos;
        `);

        const countRes = await client.query(`SELECT COUNT(*) FROM public.bunker_articulos_backup_v510;`);
        await client.query('COMMIT');

        console.log(`✅ Volcado de seguridad completado exitosamente:`);
        console.log(`   - Tabla creada: public.bunker_articulos_backup_v510`);
        console.log(`   - Registros respaldados: ${countRes.rows[0].count} filas\n`);

    } catch (err) {
        await client.query('ROLLBACK');
        console.error('❌ Error fatal al crear volcado de seguridad:', err);
        process.exit(1);
    } finally {
        client.release();
        await pool.end();
    }
}

createBackupV510();
