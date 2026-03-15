const pool = require('../src/produccion/config/database');

async function testLib() {
    let client = await pool.connect();
    try {
        await client.query('BEGIN');
        
        const q1 = await client.query(`UPDATE stock_real_consolidado SET stock_mantenimiento=1 WHERE articulo_numero='AGPX10Q' RETURNING *`);
        console.log("BEFORE:", q1.rows[0]);

        const query = `SELECT public.liberar_stock_mantenimiento($1, $2, $3, $4) as resultado`;
        const values = ['AGPX10Q', 1, 'TEST', 'test obs'];

        const result = await client.query(query, values);
        console.log("RESULTADO LIBERAR:", result.rows[0].resultado);
        
        const q2 = await client.query(`SELECT * FROM stock_real_consolidado WHERE articulo_numero='AGPX10Q'`);
        console.log("AFTER:", q2.rows[0]);

        await client.query('ROLLBACK');
    } catch(e) {
        console.error(e);
    } finally {
        client.release();
        pool.end();
    }
}
testLib();
