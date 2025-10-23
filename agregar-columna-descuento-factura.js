const { pool } = require('./src/facturacion/config/database');

async function agregarColumna() {
    try {
        console.log('🔧 Agregando columna descuento a factura_facturas...');
        
        await pool.query(`
            ALTER TABLE factura_facturas 
            ADD COLUMN IF NOT EXISTS descuento NUMERIC(10,4) DEFAULT 0.00;
        `);
        
        await pool.query(`
            COMMENT ON COLUMN factura_facturas.descuento 
            IS 'Descuento global aplicado (valor fraccional: 0.05 = 5%)';
        `);
        
        console.log('✅ Columna descuento agregada exitosamente');
        
        // Verificar
        const result = await pool.query(`
            SELECT column_name, data_type, column_default
            FROM information_schema.columns 
            WHERE table_schema='public' 
            AND table_name='factura_facturas'
            AND column_name='descuento'
        `);
        
        if (result.rows.length > 0) {
            console.log('✅ Verificación exitosa:', result.rows[0]);
        }
        
        await pool.end();
        console.log('\n🎉 Proceso completado');
        
    } catch (error) {
        console.error('❌ Error:', error.message);
        await pool.end();
        process.exit(1);
    }
}

agregarColumna();
