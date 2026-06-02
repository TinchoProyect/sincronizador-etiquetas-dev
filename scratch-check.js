require('dotenv').config();
const { pool } = require('./src/logistica/config/database');

async function test() {
    try {
        console.log("=== DISTINCT TIPO VALUES IN ingredientes_movimientos ===");
        const resTipo = await pool.query(`
            SELECT DISTINCT tipo FROM public.ingredientes_movimientos
        `);
        console.table(resTipo.rows);

        console.log("=== CHECK CONSTRAINT DEFINITION ===");
        const resConst = await pool.query(`
            SELECT conname, pg_get_constraintdef(oid) 
            FROM pg_constraint 
            WHERE conname = 'ingredientes_movimientos_tipo_check'
        `);
        console.table(resConst.rows);
    } catch(e) { 
        console.error(e); 
    }
    process.exit(0);
}
test();
