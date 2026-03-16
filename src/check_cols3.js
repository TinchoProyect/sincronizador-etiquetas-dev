const pool = require('./produccion/config/database');
pool.query("SELECT column_name FROM information_schema.columns WHERE table_name='stock_real_consolidado'")
.then(res => {
    console.log(res.rows.map(r=>r.column_name).join(', '));
    pool.end();
})
.catch(err => {
    console.error(err);
    pool.end();
});
