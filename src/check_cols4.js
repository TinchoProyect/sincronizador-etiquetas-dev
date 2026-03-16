const pool = require('./produccion/config/database');
(async () => {
    let q = "SELECT column_name FROM information_schema.columns WHERE table_name='mantenimiento_movimientos'";
    let res = await pool.query(q);
    console.log("mantenimiento_movimientos:", res.rows.map(r=>r.column_name));
    q = "SELECT column_name FROM information_schema.columns WHERE table_name='stock_real_consolidado'";
    res = await pool.query(q);
    console.log("stock_real_consolidado:", res.rows.map(r=>r.column_name));
    pool.end();
})();
