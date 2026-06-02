const { pool } = require('../src/logistica/config/database');

async function run() {
    try {
        console.log("🔍 [INSPECT-MAIZ] Buscando artículos de Maíz en bunker_lista_articulos...");
        const res = await pool.query(
            "SELECT * FROM public.bunker_lista_articulos WHERE articulo_numero IN ('MPBX5', 'MPBX25')"
        );
        console.log("Resultados:");
        console.log(res.rows);

        console.log("\n🔍 [INSPECT-MAIZ] Buscando en bunker_articulos...");
        const res2 = await pool.query(
            "SELECT articulo_id, descripcion, pack_hijo_codigo FROM public.bunker_articulos WHERE articulo_id IN ('MPBX5', 'MPBX25')"
        );
        console.log(res2.rows);
    } catch(e) {
        console.error(e);
    } finally {
        process.exit(0);
    }
}

run();
