const fs = require('fs');
const path = require('path');
const pool = require('../src/produccion/config/database');

async function runMigration() {
    let client;
    try {
        client = await pool.connect();
        console.log('🔌 Conexión a base de datos establecida.');
        
        const migrationPath = path.join(__dirname, '..', 'src', 'logistica', 'migrations', '16_migracion_insumos_y_sectores.sql');
        console.log(`📄 Leyendo archivo de migración: ${migrationPath}`);
        const sql = fs.readFileSync(migrationPath, 'utf8');
        
        console.log('⚡ Ejecutando sentencias SQL...');
        await client.query(sql);
        console.log('✅ Migración ejecutada con éxito.');
    } catch (err) {
        console.error('❌ Error al ejecutar la migración:', err);
    } finally {
        if (client) {
            client.release();
        }
        await pool.end();
        process.exit(0);
    }
}

runMigration();
