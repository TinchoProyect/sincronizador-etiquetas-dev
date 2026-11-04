const { pool } = require('../config/database');

async function checkCostoBaseSchema() {
    console.log('=== INSPECCIÓN DE COSTO BASE Y PROPIEDADES EN bunker_articulos ===\n');

    try {
        const res = await pool.query(`
            SELECT 
                ba.articulo_id,
                ba.descripcion,
                ba.descripcion_generada,
                ba.costo_base,
                ba.kilos_unidad,
                ba.pack_unidades,
                ba.porcentaje_iva
            FROM public.bunker_articulos ba
            WHERE ba.articulo_id IN ('GDF5X500G', 'PJx10', 'HNx5', 'MFX18')
        `);
        console.table(res.rows);

        process.exit(0);
    } catch (e) {
        console.error(e);
        process.exit(1);
    }
}

checkCostoBaseSchema();
