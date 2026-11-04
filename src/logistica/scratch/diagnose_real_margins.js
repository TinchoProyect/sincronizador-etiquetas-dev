const { pool } = require('../config/database');

async function diagnoseRealMargins() {
    console.log('=== DIAGNÓSTICO PROFUNDO DE MARGEN Y GANANCIA REAL EN BÚNKER ===\n');

    try {
        // 1. Obtener la información del cliente 533 (Crusalva) y sus listas asignadas en Búnker
        const resCliente = await pool.query(`
            SELECT 
                bc.id as bunker_cliente_id,
                bc.lomas_soft_id,
                bc.razon_social,
                bclp.bunker_lista_precio_id
            FROM public.bunker_clientes bc
            LEFT JOIN public.bunker_cliente_listas_precios bclp ON bclp.bunker_cliente_id = bc.id
            WHERE bc.lomas_soft_id = '0533' OR bc.lomas_soft_id = '533' OR bc.id::text = '533'
        `);
        console.log('1. Cliente 533 en Búnker:');
        console.table(resCliente.rows);

        const listaId = resCliente.rows[0]?.bunker_lista_precio_id || 1;
        console.log(`\nLista de Precios Asignada al Cliente 533: ID ${listaId}\n`);

        // 2. Artículos a diagnosticar:
        // - Granada 5 x 500g (Código: 76328500 / SKU: GDF5X500G)
        // - Pasa Jumbo x 10kg (Código: 5349211857 / SKU: PJx10)
        const articulosTarget = [
            { label: 'Granada 5 x 500g', code: '76328500', sku: 'GDF5X500G' },
            { label: 'Pasa Jumbo x 10kg', code: '5349211857', sku: 'PJx10' }
        ];

        for (const item of articulosTarget) {
            console.log(`--------------------------------------------------------------------------------`);
            console.log(`📌 DIAGNÓSTICO PARA: ${item.label} (Código: ${item.code}, SKU: ${item.sku})`);
            console.log(`--------------------------------------------------------------------------------`);

            // a) Registro en bunker_articulos
            const resBA = await pool.query(`
                SELECT 
                    ba.articulo_id,
                    ba.descripcion,
                    ba.descripcion_generada,
                    ba.costo_base,
                    ba.porcentaje_iva
                FROM public.bunker_articulos ba
                WHERE ba.articulo_id = $1 OR ba.articulo_id = $2
            `, [item.sku, item.code]);
            console.log('a) bunker_articulos:');
            console.table(resBA.rows);

            // b) Registro en bunker_lista_articulos para la lista de precios del cliente 533
            const resBLA = await pool.query(`
                SELECT 
                    bla.id,
                    bla.lista_id,
                    bla.articulo_numero,
                    bla.precio_final,
                    bla.modo_iva,
                    bla.disponible
                FROM public.bunker_lista_articulos bla
                WHERE (bla.articulo_numero = $1 OR bla.articulo_numero = $2)
                  AND bla.lista_id = $3
            `, [item.sku, item.code, listaId]);
            console.log(`b) bunker_lista_articulos (lista_id = ${listaId}):`);
            console.table(resBLA.rows);

            // c) Consulta actual de /api/presupuestos/precios
            const resApiQuery = await pool.query(`
                SELECT 
                    bla.articulo_numero,
                    ba.descripcion,
                    ba.costo_base,
                    ba.porcentaje_iva,
                    bla.precio_final,
                    COALESCE(ba.porcentaje_iva, 21) as iva_aplicado,
                    (bla.precio_final / (1 + COALESCE(ba.porcentaje_iva, 21) / 100.0)) as neto_venta,
                    (bla.precio_final / (1 + COALESCE(ba.porcentaje_iva, 21) / 100.0) - COALESCE(ba.costo_base, 0)) as ganancia_real
                FROM public.bunker_lista_articulos bla
                JOIN public.bunker_cliente_listas_precios bclp ON bclp.bunker_lista_precio_id = bla.lista_id
                JOIN public.bunker_clientes bc ON bc.id = bclp.bunker_cliente_id
                LEFT JOIN public.bunker_articulos ba ON ba.articulo_id = bla.articulo_numero
                LEFT JOIN public.stock_real_consolidado src ON src.articulo_numero = bla.articulo_numero
                WHERE (bc.lomas_soft_id = '0533' OR bc.lomas_soft_id = '533' OR bc.id::text = '533')
                  AND (bla.articulo_numero = $1 OR src.codigo_barras = $1 OR bla.articulo_numero = $2 OR src.codigo_barras = $2)
            `, [item.code, item.sku]);

            console.log('c) Resultado SQL Backend /api/presupuestos/precios:');
            console.table(resApiQuery.rows);
        }

        process.exit(0);
    } catch (e) {
        console.error('Error en diagnóstico:', e);
        process.exit(1);
    }
}

diagnoseRealMargins();
