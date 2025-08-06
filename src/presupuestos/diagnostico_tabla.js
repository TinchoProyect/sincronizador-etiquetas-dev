const { pool } = require('./config/database');

async function diagnosticarTabla() {
    try {
        console.log('🔍 Diagnosticando estructura de la tabla presupuestos...');
        
        // Consultar la estructura de la tabla
        const query = `
            SELECT column_name, data_type, is_nullable, column_default
            FROM information_schema.columns 
            WHERE table_name = 'presupuestos' 
            ORDER BY ordinal_position;
        `;
        
        const result = await pool.query(query);
        
        console.log('📋 Estructura de la tabla presupuestos:');
        console.table(result.rows);
        
        // Verificar si hay datos
        const countQuery = 'SELECT COUNT(*) as total FROM presupuestos';
        const countResult = await pool.query(countQuery);
        console.log(`📊 Total de registros: ${countResult.rows[0].total}`);
        
        // Mostrar algunos registros de ejemplo
        const sampleQuery = 'SELECT * FROM presupuestos LIMIT 3';
        const sampleResult = await pool.query(sampleQuery);
        console.log('📋 Registros de ejemplo:');
        console.table(sampleResult.rows);
        
        process.exit(0);
        
    } catch (error) {
        console.error('❌ Error en diagnóstico:', error);
        process.exit(1);
    }
}

diagnosticarTabla();
