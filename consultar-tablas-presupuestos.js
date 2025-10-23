const { pool } = require('./src/presupuestos/config/database');

async function consultarTablas() {
    try {
        console.log('🔍 Consultando tablas de presupuestos y clientes...\n');
        
        const query = `
            SELECT table_name, 
                   (SELECT COUNT(*) FROM information_schema.columns WHERE table_schema='public' AND table_name=t.table_name) as num_columnas
            FROM information_schema.tables t
            WHERE table_schema='public' 
            AND (table_name LIKE '%presupuesto%' OR table_name LIKE '%cliente%')
            ORDER BY table_name
        `;
        
        const result = await pool.query(query);
        
        console.log('📊 Tablas encontradas:\n');
        result.rows.forEach(row => {
            console.log(`  ✅ ${row.table_name} (${row.num_columnas} columnas)`);
        });
        
        console.log('\n🔍 Consultando estructura de presupuestos...\n');
        
        // Buscar tabla principal de presupuestos
        const presupuestoTable = result.rows.find(r => 
            r.table_name.includes('presupuesto') && !r.table_name.includes('detalle')
        );
        
        if (presupuestoTable) {
            const columnsQuery = `
                SELECT column_name, data_type, is_nullable
                FROM information_schema.columns
                WHERE table_schema='public' AND table_name=$1
                ORDER BY ordinal_position
            `;
            
            const columns = await pool.query(columnsQuery, [presupuestoTable.table_name]);
            
            console.log(`📋 Columnas de ${presupuestoTable.table_name}:\n`);
            columns.rows.forEach(col => {
                console.log(`  - ${col.column_name}: ${col.data_type} ${col.is_nullable === 'NO' ? '(NOT NULL)' : ''}`);
            });
        }
        
        await pool.end();
        console.log('\n✅ Consulta completada');
        
    } catch (error) {
        console.error('❌ Error:', error.message);
        await pool.end();
        process.exit(1);
    }
}

consultarTablas();
