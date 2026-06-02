require('dotenv').config();
const { pool } = require('../src/logistica/config/database');

async function test() {
    try {
        console.log("--- SYSTEM CONTROL: AUDITING BUNKER PRICE LISTS TABLES ---");
        const tables = ['bunker_listas_precios', 'bunker_lista_articulos', 'bunker_lista_insumos'];
        for (const table of tables) {
            const res = await pool.query(
                `SELECT EXISTS (
                    SELECT FROM information_schema.tables 
                    WHERE table_schema = 'public' 
                    AND table_name = $1
                )`, [table]
            );
            console.log(`Table '${table}' exists:`, res.rows[0].exists);
            
            if (res.rows[0].exists) {
                const cols = await pool.query(
                    `SELECT column_name, data_type 
                     FROM information_schema.columns 
                     WHERE table_schema = 'public' 
                     AND table_name = $1`, [table]
                );
                console.log(`Columns of '${table}':`, cols.rows.map(c => `${c.column_name} (${c.data_type})`).join(', '));
            }
        }
    } catch(e) { 
        console.error(e); 
    }
    process.exit(0);
}
test();
