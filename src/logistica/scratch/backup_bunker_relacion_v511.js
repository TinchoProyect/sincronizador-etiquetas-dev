const { Pool } = require('pg');
require('dotenv').config();

const pool = new Pool({
    user: process.env.DB_USER || 'postgres',
    host: process.env.DB_HOST || 'localhost',
    database: process.env.DB_NAME || 'etiquetas',
    password: process.env.DB_PASSWORD || 'ta3Mionga',
    port: parseInt(process.env.DB_PORT || '5432')
});

async function createRelacionBackupV511() {
    console.log('🔒 ====================================================================');
    console.log('🔒 FASE 1: VOLCADO DE SEGURIDAD RELACIONAL (BACKUP DML v5.11)');
    console.log('🔒 ====================================================================\n');

    const client = await pool.connect();
    try {
        await client.query('BEGIN');

        // Drop previous backup table if exists
        await client.query(`DROP TABLE IF EXISTS public.bunker_relacion_backup_v511;`);

        // Create full snapshot backup table for bunker_relacion_atributo_principal
        await client.query(`
            CREATE TABLE public.bunker_relacion_backup_v511 AS 
            SELECT * FROM public.bunker_relacion_atributo_principal;
        `);

        const countRes = await client.query(`SELECT COUNT(*) FROM public.bunker_relacion_backup_v511;`);
        await client.query('COMMIT');

        console.log(`✅ Volcado de seguridad relacional completado exitosamente:`);
        console.log(`   - Tabla creada: public.bunker_relacion_backup_v511`);
        console.log(`   - Registros respaldados: ${countRes.rows[0].count} filas\n`);

    } catch (err) {
        await client.query('ROLLBACK');
        console.error('❌ Error fatal al crear volcado de seguridad relacional:', err);
        process.exit(1);
    } finally {
        client.release();
        await pool.end();
    }
}

createRelacionBackupV511();
