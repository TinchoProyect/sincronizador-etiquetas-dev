const { Pool } = require('pg');
require('dotenv').config();

const pool = new Pool({
    user: process.env.DB_USER || 'postgres',
    host: process.env.DB_HOST || 'localhost',
    database: process.env.DB_NAME || 'etiquetas',
    password: process.env.DB_PASSWORD || 'ta3Mionga',
    port: parseInt(process.env.DB_PORT || '5432')
});

async function verifyBackupsV515() {
    console.log('🔒 ====================================================================');
    console.log('🔒 FASE 1: VERIFICACIÓN DE RESPALDOS DE INFRAESTRUCTURA (v5.15)');
    console.log('🔒 ====================================================================\n');

    const client = await pool.connect();
    try {
        const resArtBackup = await client.query(`SELECT COUNT(*) FROM public.bunker_articulos_backup_v510;`);
        const resRelBackup = await client.query(`SELECT COUNT(*) FROM public.bunker_relacion_backup_v511;`);

        console.log(`✅ Estado de las Tablas Snapshot de Respaldo:`);
        console.log(`   - public.bunker_articulos_backup_v510: ${resArtBackup.rows[0].count} filas`);
        console.log(`   - public.bunker_relacion_backup_v511: ${resRelBackup.rows[0].count} filas\n`);
    } catch (err) {
        console.error('❌ Error al verificar respaldos de infraestructura:', err);
        process.exit(1);
    } finally {
        client.release();
        await pool.end();
    }
}

verifyBackupsV515();
