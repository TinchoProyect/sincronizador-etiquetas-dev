const { pool } = require('../config/database');

async function checkGDFList() {
    console.log('=== INSPECCIÓN DE GDF5X500G EN bunker_lista_articulos Y bunker_lista_insumos ===\n');

    try {
        const resBLA = await pool.query(`
            SELECT 
                bla.id,
                bla.lista_id,
                bla.articulo_numero,
                bla.precio_final,
                bla.costo_base_sobrescrito,
                bla.costo_tiempo,
                bla.modo_iva,
                bla.disponible
            FROM public.bunker_lista_articulos bla
            WHERE bla.articulo_numero = 'GDF5X500G'
        `);
        console.log('1. bunker_lista_articulos para GDF5X500G across all 5 price lists:');
        console.table(resBLA.rows);

        const resIns = await pool.query(`
            SELECT 
                bli.id,
                bli.lista_articulo_id,
                bli.insumo_articulo_numero,
                bli.cantidad,
                bli.incluido
            FROM public.bunker_lista_insumos bli
            WHERE bli.lista_articulo_id IN (SELECT id FROM public.bunker_lista_articulos WHERE articulo_numero = 'GDF5X500G')
        `);
        console.log('2. bunker_lista_insumos para GDF5X500G:');
        console.table(resIns.rows);

        process.exit(0);
    } catch (e) {
        console.error(e);
        process.exit(1);
    }
}

checkGDFList();
