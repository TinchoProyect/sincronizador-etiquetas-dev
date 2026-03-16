const pool = require('./config/database');

async function main() {
    try {
        const query = `
            SELECT pg_get_triggerdef(oid) 
            FROM pg_trigger 
            WHERE tgname = 'trigger_actualizar_stock_ingrediente';
        `;
        const res = await pool.query(query);
        console.log(res.rows[0].pg_get_triggerdef);
        
        const funcQuery = `
            SELECT prosrc 
            FROM pg_proc 
            WHERE proname = 'actualizar_stock_ingrediente';
        `;
        const resFunc = await pool.query(funcQuery);
        console.log(resFunc.rows[0].prosrc);
    } catch (e) {
        console.error(e);
    } finally {
        pool.end();
    }
}
main();
