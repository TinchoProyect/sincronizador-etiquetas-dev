require("dotenv").config({ path: "process.env.NODE_ENV === 'production' ? '.env.production' : '.env'" });
const pool = require("../produccion/config/database");

async function run() {
    try {
        const res = await pool.query("SELECT codigo_barras, articulo_numero, descripcion, kilos_unidad, es_pack, pack_hijo_codigo, pack_unidades FROM stock_real_consolidado WHERE es_pack = true LIMIT 5");
        console.log("kilos_unidad:", res.rows.map(x => x.kilos_unidad));
        console.log("pack_unidades:", res.rows.map(x => x.pack_unidades));
        console.log(res.rows);
    } catch(e) {
        console.error(e);
    } finally {
        process.exit();
    }
}
run();
