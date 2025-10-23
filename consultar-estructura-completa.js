const { pool } = require('./src/presupuestos/config/database');

async function consultarEstructura() {
    try {
        console.log('🔍 Consultando estructura completa...\n');
        
        // Clientes
        console.log('📋 Tabla: clientes\n');
        let result = await pool.query(`
            SELECT column_name, data_type, is_nullable
            FROM information_schema.columns
            WHERE table_schema='public' AND table_name='clientes'
            ORDER BY ordinal_position
        `);
        result.rows.forEach(col => {
            console.log(`  - ${col.column_name}: ${col.data_type} ${col.is_nullable === 'NO' ? '(NOT NULL)' : ''}`);
        });
        
        // Presupuestos Detalles
        console.log('\n📋 Tabla: presupuestos_detalles\n');
        result = await pool.query(`
            SELECT column_name, data_type, is_nullable
            FROM information_schema.columns
            WHERE table_schema='public' AND table_name='presupuestos_detalles'
            ORDER BY ordinal_position
        `);
        result.rows.forEach(col => {
            console.log(`  - ${col.column_name}: ${col.data_type} ${col.is_nullable === 'NO' ? '(NOT NULL)' : ''}`);
        });
        
        // Factura IVA Alícuotas
        console.log('\n📋 Tabla: factura_iva_alicuotas\n');
        result = await pool.query(`
            SELECT column_name, data_type, is_nullable
            FROM information_schema.columns
            WHERE table_schema='public' AND table_name='factura_iva_alicuotas'
            ORDER BY ordinal_position
        `);
        
        if (result.rows.length > 0) {
            result.rows.forEach(col => {
                console.log(`  - ${col.column_name}: ${col.data_type} ${col.is_nullable === 'NO' ? '(NOT NULL)' : ''}`);
            });
            
            // Mostrar datos de alícuotas
            console.log('\n📊 Datos de factura_iva_alicuotas:\n');
            const alicuotas = await pool.query('SELECT * FROM factura_iva_alicuotas ORDER BY id');
            alicuotas.rows.forEach(a => {
                console.log(`  ID ${a.id}: ${a.descripcion} - ${a.porcentaje}%`);
            });
        } else {
            console.log('  ⚠️ Tabla no existe - necesitaremos crearla');
        }
        
        await pool.end();
        console.log('\n✅ Consulta completada');
        
    } catch (error) {
        console.error('❌ Error:', error.message);
        await pool.end();
        process.exit(1);
    }
}

consultarEstructura();
