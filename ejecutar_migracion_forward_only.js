require('dotenv').config();

const { pool } = require('./src/presupuestos/config/database');
const fs = require('fs');

async function ejecutarMigracion() {
    console.log('🔍 [MIGRACIÓN] === EJECUTANDO MIGRACIÓN FORWARD-ONLY ===\n');
    
    try {
        // Leer el archivo SQL
        const sqlContent = fs.readFileSync('./migrations/add_forward_only_columns.sql', 'utf8');
        
        console.log('[MIGRACIÓN] Ejecutando SQL...');
        console.log(sqlContent);
        
        // Ejecutar cada statement por separado
        const statements = sqlContent.split(';').filter(stmt => stmt.trim());
        
        for (const statement of statements) {
            if (statement.trim()) {
                console.log(`[MIGRACIÓN] Ejecutando: ${statement.trim().substring(0, 50)}...`);
                await pool.query(statement.trim());
            }
        }
        
        console.log('\n✅ [MIGRACIÓN] Migración completada exitosamente');
        
        // Verificar las columnas agregadas
        const result = await pool.query(`
            SELECT column_name, data_type, is_nullable, column_default 
            FROM information_schema.columns 
            WHERE table_name = 'presupuestos_config' 
            AND column_name IN ('forward_only_mode', 'cutoff_at', 'last_seen_local_id', 'last_seen_sheet_row')
            ORDER BY column_name
        `);
        
        console.log('\n📋 [MIGRACIÓN] Columnas Forward-Only agregadas:');
        result.rows.forEach(row => {
            console.log(`  ${row.column_name}: ${row.data_type} (nullable: ${row.is_nullable}, default: ${row.column_default})`);
        });
        
    } catch (error) {
        console.error('❌ [MIGRACIÓN] Error:', error.message);
        console.error('Stack:', error.stack);
    } finally {
        try {
            await pool.end();
        } catch (e) {
            console.log('Pool ya cerrado');
        }
    }
}

ejecutarMigracion();
