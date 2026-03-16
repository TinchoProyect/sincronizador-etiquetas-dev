const pool = require('./produccion/config/database');
const fs = require('fs');
(async () => {
    let q = "SELECT column_name FROM information_schema.columns WHERE table_name='mantenimiento_movimientos'";
    let res = await pool.query(q);
    let out = "mantenimiento_movimientos: " + res.rows.map(r=>r.column_name).join(', ') + "\n";
    
    q = "SELECT column_name FROM information_schema.columns WHERE table_name='stock_real_consolidado'";
    res = await pool.query(q);
    out += "stock_real_consolidado: " + res.rows.map(r=>r.column_name).join(', ') + "\n";
    
    fs.writeFileSync('cols.txt', out);
    pool.end();
})();
