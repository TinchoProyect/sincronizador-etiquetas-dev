const { pool } = require('../config/database');

async function inspect() {
    try {
        const res = await pool.query("SELECT column_name FROM information_schema.columns WHERE table_name='stock_real_consolidado'");
        console.log("COLUMNAS DE stock_real_consolidado:\n", res.rows.map(r => r.column_name));

        const resBunker = await pool.query("SELECT column_name FROM information_schema.columns WHERE table_name='bunker_articulos'");
        console.log("\nCOLUMNAS DE bunker_articulos:\n", resBunker.rows.map(r => r.column_name));
        const resArt = await pool.query("SELECT column_name FROM information_schema.columns WHERE table_name='articulos'");
        console.log("\nCOLUMNAS DE articulos:\n", resArt.rows.map(r => r.column_name));
        process.exit(0);
    } catch (e) {
        console.error("ERROR:", e);
        process.exit(1);
    }
}
inspect();
