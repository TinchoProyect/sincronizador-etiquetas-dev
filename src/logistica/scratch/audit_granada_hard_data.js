const { pool } = require('../config/database');

async function auditGranadaHardData() {
    console.log('================================================================================');
    console.log('🔍 AUDITORÍA DE DATOS DUROS DE BASE DE DATOS PARA GDF5X500G (GRANADA 5 x 500g)');
    console.log('================================================================================\n');

    try {
        // 1. Datos en bunker_articulos
        const resArt = await pool.query(`
            SELECT 
                articulo_id,
                descripcion,
                descripcion_generada,
                costo_base,
                kilos_unidad,
                pack_unidades,
                porcentaje_iva,
                pack_hijo_codigo
            FROM public.bunker_articulos
            WHERE articulo_id = 'GDF5X500G' OR articulo_id = '76328500'
        `);
        console.log('1. Registro en bunker_articulos:');
        console.table(resArt.rows);

        // 2. Registros en bunker_lista_articulos para todas las listas
        const resLista = await pool.query(`
            SELECT 
                bla.id,
                bla.lista_id,
                bla.articulo_numero,
                bla.precio_final,
                bla.costo_base_sobrescrito,
                bla.costo_tiempo,
                bla.modo_calculo,
                bla.modo_iva,
                bla.margen_ganancia
            FROM public.bunker_lista_articulos bla
            WHERE bla.articulo_numero = 'GDF5X500G' OR bla.articulo_numero = '76328500'
            ORDER BY bla.lista_id ASC
        `);
        console.log('2. Registros en bunker_lista_articulos (todas las listas de precios):');
        console.table(resLista.rows);

        // 3. Receta de ingredientes
        const resReceta = await pool.query(`
            SELECT 
                bri.id,
                bri.articulo_padre_id,
                bri.insumo_id,
                bri.cantidad,
                ba_ins.costo_base as costo_base_insumo
            FROM public.bunker_receta_ingredientes bri
            LEFT JOIN public.bunker_articulos ba_ins ON ba_ins.articulo_id = bri.insumo_id
            WHERE bri.articulo_padre_id = 'GDF5X500G' OR bri.articulo_padre_id = '76328500'
        `);
        console.log('3. Receta de ingredientes en bunker_receta_ingredientes:');
        console.table(resReceta.rows);

        // 4. Insumos en bunker_lista_insumos
        const resInsumos = await pool.query(`
            SELECT 
                bli.id,
                bli.lista_articulo_id,
                bli.insumo_articulo_numero,
                bli.cantidad,
                bli.incluido
            FROM public.bunker_lista_insumos bli
            WHERE bli.lista_articulo_id IN (SELECT id FROM public.bunker_lista_articulos WHERE articulo_numero = 'GDF5X500G')
        `);
        console.log('4. Insumos en bunker_lista_insumos:');
        console.table(resInsumos.rows);

        process.exit(0);
    } catch (e) {
        console.error(e);
        process.exit(1);
    }
}

auditGranadaHardData();
