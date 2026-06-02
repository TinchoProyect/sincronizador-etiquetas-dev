const { pool } = require('../src/logistica/config/database');

async function run() {
    try {
        console.log("🛠️  Reseteando margen de MPBX5 a 0 para probar la herencia parental...");
        const res = await pool.query(
            "UPDATE public.bunker_lista_articulos SET margen_ganancia = 0 WHERE articulo_numero = 'MPBX5'"
        );
        console.log(`Filas afectadas: ${res.rowCount}`);
        console.log("✅ Margen reseteado exitosamente.");
    } catch (e) {
        console.error(e);
    } finally {
        process.exit(0);
    }
}

run();
