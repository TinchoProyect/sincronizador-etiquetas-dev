require('dotenv').config({ path: './src/facturacion/.env' });
const { pool } = require('./src/facturacion/config/database');

async function verificar() {
    try {
        // 1. Columnas de presupuestos_detalles
        console.log('=== PRESUPUESTOS_DETALLES ===\n');
        const cols = await pool.query(`
            SELECT column_name, data_type 
            FROM information_schema.columns 
            WHERE table_name='presupuestos_detalles' 
            ORDER BY ordinal_position
        `);
        
        console.log('Columnas:');
        cols.rows.forEach(c => console.log(`  ${c.column_name}: ${c.data_type}`));
        
        // 2. Ejemplo de fila
        const ejemplo = await pool.query('SELECT * FROM presupuestos_detalles LIMIT 1');
        console.log('\nEjemplo de fila:');
        console.log(ejemplo.rows[0]);
        
        // 3. Verificar si existe factura_iva_alicuotas
        const existeTabla = await pool.query(`
            SELECT EXISTS (
                SELECT FROM information_schema.tables 
                WHERE table_name = 'factura_iva_alicuotas'
            )
        `);
        
        console.log('\n=== FACTURA_IVA_ALICUOTAS ===\n');
        
        if (existeTabla.rows[0].exists) {
            const alicuotas = await pool.query('SELECT * FROM factura_iva_alicuotas ORDER BY porcentaje');
            console.log('Tabla existe:');
            alicuotas.rows.forEach(row => {
                console.log(`  ${row.porcentaje}% → codigo_afip: ${row.codigo_afip}`);
            });
        } else {
            console.log('❌ Tabla NO existe');
        }
        
        await pool.end();
    } catch (error) {
        console.error('ERROR:', error.message);
        await pool.end();
        process.exit(1);
    }
}

verificar();
