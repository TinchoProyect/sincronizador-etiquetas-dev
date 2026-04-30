const { Pool } = require('pg');
require('dotenv').config();

const pool = new Pool({
    connectionString: process.env.DATABASE_URL || 'postgres://postgres:postgres@localhost:5432/lamdaser'
});

async function run() {
    try {
        console.log("Presupuestos with 17 in ID:");
        let res1 = await pool.query(`SELECT id, estado, tipo_comprobante FROM presupuestos WHERE id::text LIKE '%17%' LIMIT 5`);
        console.log(res1.rows);
        
        console.log("Ordenes de Tratamiento with 17 in ID:");
        let res2 = await pool.query(`SELECT id, id_cliente FROM ordenes_tratamiento WHERE id = 17 OR id::text LIKE '%17%' LIMIT 5`);
        console.log(res2.rows);

        console.log("Presupuestos that are 'Orden de Retiro':");
        let res3 = await pool.query(`SELECT id, estado, tipo_comprobante FROM presupuestos WHERE estado = 'Orden de Retiro' LIMIT 5`);
        console.log(res3.rows);

    } catch(e) {
        console.error(e);
    } finally {
        pool.end();
    }
}
run();
