const { pool } = require('./src/facturacion/config/database');

async function test() {
    try {
        const res = await pool.query("SELECT column_name FROM information_schema.columns WHERE table_name = 'factura_facturas';");
        res.rows.forEach(r => console.log(r.column_name));
        process.exit(0);
    } catch (e) {
        console.error(e);
        process.exit(1);
    }
}
test();
