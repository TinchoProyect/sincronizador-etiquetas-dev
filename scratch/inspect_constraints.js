const { Pool } = require('pg');
const pool = new Pool({ connectionString: 'postgres://postgres:ta3Mionga@localhost:5432/etiquetas' });

async function run() {
    try {
        const vCols = await pool.query(`
            SELECT column_name, data_type 
            FROM information_schema.columns 
            WHERE table_name = 'bunker_lotes_vinculos';
        `);
        console.log("bunker_lotes_vinculos columns:");
        console.table(vCols.rows);

        const dCols = await pool.query(`
            SELECT column_name, data_type 
            FROM information_schema.columns 
            WHERE table_name = 'bunker_lotes_destinos';
        `);
        console.log("bunker_lotes_destinos columns:");
        console.table(dCols.rows);
    } catch (err) {
        console.error(err);
    } finally {
        pool.end();
    }
}

run();
