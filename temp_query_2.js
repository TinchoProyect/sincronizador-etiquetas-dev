const fs = require('fs');
const pool = require('./src/produccion/config/database');
Promise.all([
    pool.query("SELECT column_name, data_type FROM information_schema.columns WHERE table_name = 'factura_facturas'"),
    pool.query("SELECT column_name, data_type FROM information_schema.columns WHERE table_name = 'factura_factura_items'")
]).then(([res1, res2]) => {
    fs.writeFileSync('temp_out_2.txt', JSON.stringify({ facturas: res1.rows, items: res2.rows }, null, 2));
    pool.end();
}).catch(e => { console.error(e); pool.end(); });
