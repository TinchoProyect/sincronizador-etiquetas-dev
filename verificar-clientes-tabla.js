const { pool } = require('./src/facturacion/config/database');

async function verificar() {
    try {
        // Ver tablas con clientes
        const tablas = await pool.query(`
            SELECT table_name 
            FROM information_schema.tables 
            WHERE table_schema = 'public' 
            AND table_name LIKE '%cliente%'
        `);
        
        console.log('Tablas con clientes:', tablas.rows);
        
        // Ver estructura de factura_facturas
        const columnas = await pool.query(`
            SELECT column_name, data_type 
            FROM information_schema.columns 
            WHERE table_name = 'factura_facturas'
            ORDER BY ordinal_position
        `);
        
        console.log('\nColumnas de factura_facturas:');
        columnas.rows.forEach(c => console.log(`  - ${c.column_name}: ${c.data_type}`));
        
        // Ver una factura de ejemplo
        const ejemplo = await pool.query('SELECT * FROM factura_facturas ORDER BY id DESC LIMIT 1');
        console.log('\nFactura de ejemplo:', ejemplo.rows[0]);
        
        await pool.end();
    } catch (error) {
        console.error('Error:', error);
        process.exit(1);
    }
}

verificar();
