const fs = require('fs');
const path = require('path');
const { pool } = require('../src/logistica/config/database');

async function runMigration() {
    console.log('🔄 Iniciando migración de base de datos...');
    const sqlPath = path.join(__dirname, '../migrations/04_add_email_billing_columns.sql');
    
    try {
        console.log(`📄 Leyendo archivo SQL desde: ${sqlPath}`);
        const sql = fs.readFileSync(sqlPath, 'utf8');
        
        console.log('⚡ Ejecutando query de migración...');
        await pool.query(sql);
        
        console.log('✅ Migración exitosa: columnas creadas o ya existentes en public.bunker_clientes.');
    } catch (error) {
        console.error('❌ Error ejecutando migración:', error);
    } finally {
        // Cerrar el pool para que el proceso finalice de inmediato
        await pool.end();
        console.log('🔌 Conexión de base de datos cerrada.');
    }
}

runMigration();
