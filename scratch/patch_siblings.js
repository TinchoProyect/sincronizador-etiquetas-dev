const { pool } = require('../src/logistica/config/database');

async function run() {
    try {
        console.log("🛠️  Patcher de Hermanos para Búnker Iniciado...");
        
        // 1. Mapear pack_hijo_codigo de MPBX5 a MPBX25
        const res1 = await pool.query(
            "UPDATE public.bunker_articulos SET pack_hijo_codigo = 'MPBX25' WHERE articulo_id = 'MPBX5'"
        );
        console.log(`- MPBX5 -> MPBX25: Filas afectadas: ${res1.rowCount}`);

        // 2. Mapear pack_hijo_codigo de Semillas de Zapallo
        const res2 = await pool.query(
            "UPDATE public.bunker_articulos SET pack_hijo_codigo = 'SZAAX25' WHERE articulo_id = 'SZAAx5'"
        );
        console.log(`- SZAAx5 -> SZAAX25: Filas afectadas: ${res2.rowCount}`);

        const res3 = await pool.query(
            "UPDATE public.bunker_articulos SET pack_hijo_codigo = 'SZAAX25' WHERE articulo_id = 'SZAAX1'"
        );
        console.log(`- SZAAX1 -> SZAAX25: Filas afectadas: ${res3.rowCount}`);

        console.log("✅ Hermanos Búnker actualizados con éxito.");
    } catch (e) {
        console.error("❌ Error en patch_siblings:", e);
    } finally {
        process.exit(0);
    }
}

run();
