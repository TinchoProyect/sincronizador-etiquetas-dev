const { pool } = require('./src/facturacion/config/database');

async function verificarEstructura() {
    try {
        const result = await pool.query(`
            SELECT column_name, data_type 
            FROM information_schema.columns 
            WHERE table_name = 'factura_facturas' 
            AND table_schema = 'public' 
            ORDER BY ordinal_position
        `);
        
        console.log('\n=== ESTRUCTURA DE factura_facturas ===\n');
        console.log(`Total columnas: ${result.rows.length}\n`);
        
        result.rows.forEach((row, i) => {
            console.log(`${i+1}. ${row.column_name} (${row.data_type})`);
        });
        
        console.log('\n');
        await pool.end();
    } catch (error) {
        console.error('Error:', error.message);
        await pool.end();
    }
}

verificarEstructura();
