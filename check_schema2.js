const pool = require('./src/produccion/config/database');

async function run() {
    try {
        let res = await pool.query("SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' AND table_name LIKE '%factura%'");
        console.log('Tablas factura:', res.rows.map(r => r.table_name).join(', '));
        
        res = await pool.query("SELECT column_name, data_type FROM information_schema.columns WHERE table_name = 'presupuestos'");
        console.log('\npresupuestos cols:', res.rows.map(r => r.column_name).join(', '));

        res = await pool.query("SELECT column_name, data_type FROM information_schema.columns WHERE table_name = 'presupuestos_detalles'");
        console.log('\npresupuestos_detalles cols:', res.rows.map(r => r.column_name).join(', '));

        res = await pool.query("SELECT column_name, data_type FROM information_schema.columns WHERE table_name = 'factura_facturas'");
        console.log('\nfactura_facturas cols:', res.rows.map(r => r.column_name).join(', '));
    } catch(e) {
        console.error(e);
    } finally {
        pool.end();
    }
}
run();
