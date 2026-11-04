const { Pool } = require('pg');
const pool = new Pool({ connectionString: 'postgresql://postgres:ta3Mionga@localhost:5432/etiquetas' });

async function run() {
    const resArt = await pool.query("SELECT * FROM public.bunker_articulos WHERE articulo_id = 'BF24X50'");
    console.log("--- bunker_articulos ROW ---");
    console.log(resArt.rows[0]);

    const resLA = await pool.query("SELECT * FROM public.bunker_lista_articulos WHERE articulo_numero = 'BF24X50'");
    console.log("--- bunker_lista_articulos ROWS ---");
    console.log(resLA.rows);

    await pool.end();
}
run();
