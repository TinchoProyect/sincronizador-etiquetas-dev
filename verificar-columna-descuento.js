const { pool } = require('./src/facturacion/config/database');

async function verificar() {
    try {
        const result = await pool.query(`
            SELECT column_name, data_type, is_nullable
            FROM information_schema.columns 
            WHERE table_schema='public' 
            AND table_name='factura_facturas'
            ORDER BY ordinal_position
        `);
        
        console.log('\n📋 Columnas de factura_facturas:');
        result.rows.forEach(col => {
            console.log(`  - ${col.column_name}: ${col.data_type} ${col.is_nullable === 'NO' ? '(NOT NULL)' : ''}`);
        });
        
        const tieneDescuento = result.rows.find(col => col.column_name === 'descuento');
        
        if (tieneDescuento) {
            console.log('\n✅ La columna "descuento" existe');
        } else {
            console.log('\n⚠️ La columna "descuento" NO existe - necesita ser agregada');
        }
        
        await pool.end();
    } catch (error) {
        console.error('❌ Error:', error.message);
        await pool.end();
        process.exit(1);
    }
}

verificar();
