const { Pool } = require('pg');
const fs = require('fs');

const pool = new Pool({
    user: 'postgres',
    host: 'localhost',
    database: 'etiquetas_pruebas',
    password: 'ta3Mionga',
    port: 5432,
});

(async () => {
    let q = "SELECT column_name FROM information_schema.columns WHERE table_name='mantenimiento_movimientos'";
    let res = await pool.query(q);
    let out = "mantenimiento_movimientos: " + res.rows.map(r=>r.column_name).join(', ') + "\n";
    
    q = "SELECT column_name FROM information_schema.columns WHERE table_name='stock_real_consolidado'";
    res = await pool.query(q);
    out += "stock_real_consolidado: " + res.rows.map(r=>r.column_name).join(', ') + "\n";
    
    fs.writeFileSync('cols_test.txt', out);
    pool.end();
})();
