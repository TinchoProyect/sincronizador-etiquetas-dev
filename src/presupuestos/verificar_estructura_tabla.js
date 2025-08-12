console.log('🔍 [DIAGNÓSTICO] Verificando estructura real de la tabla presupuestos...');

const { pool } = require('./config/database');

async function verificarEstructuraTabla() {
    try {
        console.log('📋 [DIAGNÓSTICO] Consultando estructura de la tabla presupuestos...');
        
        // Consultar información de columnas de la tabla presupuestos
        const query = `
            SELECT 
                column_name,
                data_type,
                is_nullable,
                column_default
            FROM information_schema.columns 
            WHERE table_name = 'presupuestos' 
            AND table_schema = 'public'
            ORDER BY ordinal_position;
        `;
        
        const result = await pool.query(query);
        
        console.log('✅ [DIAGNÓSTICO] Estructura de la tabla presupuestos:');
        console.log('📊 [DIAGNÓSTICO] Total columnas:', result.rows.length);
        console.log('');
        
        result.rows.forEach((column, index) => {
            console.log(`${index + 1}. ${column.column_name} (${column.data_type}) - Nullable: ${column.is_nullable} - Default: ${column.column_default || 'NULL'}`);
        });
        
        console.log('');
        console.log('🔍 [DIAGNÓSTICO] Buscando columnas relacionadas con fechas...');
        
        const fechaColumns = result.rows.filter(col => 
            col.column_name.toLowerCase().includes('fecha') || 
            col.column_name.toLowerCase().includes('date') ||
            col.column_name.toLowerCase().includes('time') ||
            col.column_name.toLowerCase().includes('sync') ||
            col.column_name.toLowerCase().includes('actualiz')
        );
        
        if (fechaColumns.length > 0) {
            console.log('📅 [DIAGNÓSTICO] Columnas de fecha encontradas:');
            fechaColumns.forEach(col => {
                console.log(`   - ${col.column_name} (${col.data_type})`);
            });
        } else {
            console.log('⚠️ [DIAGNÓSTICO] No se encontraron columnas de fecha específicas');
        }
        
        // También verificar algunos registros de ejemplo
        console.log('');
        console.log('🔍 [DIAGNÓSTICO] Consultando registros de ejemplo...');
        
        const sampleQuery = `SELECT * FROM presupuestos LIMIT 3`;
        const sampleResult = await pool.query(sampleQuery);
        
        if (sampleResult.rows.length > 0) {
            console.log('📋 [DIAGNÓSTICO] Ejemplo de registros:');
            console.log('📊 [DIAGNÓSTICO] Columnas disponibles:', Object.keys(sampleResult.rows[0]));
            
            sampleResult.rows.forEach((row, index) => {
                console.log(`\nRegistro ${index + 1}:`);
                Object.entries(row).forEach(([key, value]) => {
                    if (key.toLowerCase().includes('fecha') || key.toLowerCase().includes('date')) {
                        console.log(`   ${key}: ${value}`);
                    }
                });
            });
        }
        
        console.log('\n✅ [DIAGNÓSTICO] Verificación completada');
        
    } catch (error) {
        console.error('❌ [DIAGNÓSTICO] Error al verificar estructura:', error);
        console.error('📊 [DIAGNÓSTICO] Código de error:', error.code);
        console.error('📊 [DIAGNÓSTICO] Mensaje:', error.message);
    } finally {
        process.exit(0);
    }
}

// Ejecutar verificación
verificarEstructuraTabla();
