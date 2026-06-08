const { Pool } = require('pg');
const pool = new Pool({ connectionString: 'postgres://postgres:ta3Mionga@localhost:5432/etiquetas' });

async function run() {
    try {
        const listas = await pool.query("SELECT * FROM public.bunker_listas_precios");
        console.log("Listas de precios:");
        console.table(listas.rows);

        const countLA = await pool.query(`
            SELECT lista_id, COUNT(*) as count 
            FROM public.bunker_lista_articulos 
            GROUP BY lista_id
        `);
        console.log("Conteo de artículos por lista_id:");
        console.table(countLA.rows);

    } catch (err) {
        console.error(err);
    } finally {
        pool.end();
    }
}
run();
