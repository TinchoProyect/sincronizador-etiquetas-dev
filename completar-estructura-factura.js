const { pool } = require('./src/facturacion/config/database');

async function completarEstructura() {
    try {
        console.log('🔧 Completando estructura de factura_facturas...\n');
        
        // 1. Agregar columna descuento si no existe
        console.log('1️⃣ Verificando columna descuento...');
        await pool.query(`
            ALTER TABLE factura_facturas 
            ADD COLUMN IF NOT EXISTS descuento NUMERIC(10,4) DEFAULT 0.00;
        `);
        await pool.query(`
            COMMENT ON COLUMN factura_facturas.descuento 
            IS 'Descuento global aplicado (valor fraccional: 0.05 = 5%)';
        `);
        console.log('✅ Columna descuento verificada/creada\n');
        
        // 2. Agregar columna razon_social si no existe
        console.log('2️⃣ Verificando columna razon_social...');
        await pool.query(`
            ALTER TABLE factura_facturas 
            ADD COLUMN IF NOT EXISTS razon_social VARCHAR(255);
        `);
        await pool.query(`
            COMMENT ON COLUMN factura_facturas.razon_social 
            IS 'Razón social del cliente';
        `);
        console.log('✅ Columna razon_social verificada/creada\n');
        
        // 3. Verificar estructura final
        console.log('3️⃣ Verificando estructura final...');
        const result = await pool.query(`
            SELECT column_name, data_type, column_default
            FROM information_schema.columns 
            WHERE table_schema='public' 
            AND table_name='factura_facturas'
            AND column_name IN ('descuento', 'razon_social')
            ORDER BY column_name;
        `);
        
        console.log('📋 Columnas agregadas/verificadas:');
        result.rows.forEach(col => {
            console.log(`   - ${col.column_name}: ${col.data_type} (default: ${col.column_default || 'NULL'})`);
        });
        
        await pool.end();
        console.log('\n🎉 Estructura completada exitosamente');
        console.log('\n💡 Ahora puedes ejecutar: node test-factura-con-descuento.js');
        
    } catch (error) {
        console.error('\n❌ Error:', error.message);
        await pool.end();
        process.exit(1);
    }
}

completarEstructura();
