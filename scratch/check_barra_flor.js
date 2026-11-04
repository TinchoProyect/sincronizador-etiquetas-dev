const { Pool } = require('pg');
const pool = new Pool({
    connectionString: "postgresql://postgres:ta3Mionga@localhost:5432/etiquetas"
});

async function main() {
    try {
        console.log('Querying public.bunker_margenes for BF24X50...');
        const resM = await pool.query("SELECT * FROM public.bunker_margenes WHERE articulo_id = 'BF24X50'");
        console.log('bunker_margenes:', resM.rows);

        console.log('Querying public.bunker_lista_articulos for BF24X50...');
        const resLa = await pool.query("SELECT * FROM public.bunker_lista_articulos WHERE articulo_numero = 'BF24X50'");
        console.log('bunker_lista_articulos:', resLa.rows);
    } catch(e) {
        console.error(e);
    } finally {
        await pool.end();
    }
}

main();
