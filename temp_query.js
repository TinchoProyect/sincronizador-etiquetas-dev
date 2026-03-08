const fs = require('fs');
const pool = require('./src/produccion/config/database');
pool.query("SELECT conname, pg_get_constraintdef(c.oid) AS constraint_def FROM pg_constraint c JOIN pg_class t ON c.conrelid = t.oid WHERE t.relname = 'mantenimiento_movimientos'")
    .then(res => { fs.writeFileSync('temp_out.txt', JSON.stringify(res.rows, null, 2)); pool.end(); })
    .catch(err => { console.error(err); pool.end(); });
