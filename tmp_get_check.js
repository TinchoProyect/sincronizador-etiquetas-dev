const pool = require('./src/produccion/config/database');
const fs = require('fs');
async function run() {
    const res = await pool.query(`
        SELECT pg_get_constraintdef(c.oid) AS definicion
        FROM pg_constraint c
        WHERE c.conname = 'mantenimiento_movimientos_estado_check';
    `);
    fs.writeFileSync('check_res.txt', res.rows[0].definicion);
    process.exit(0);
}
run();
