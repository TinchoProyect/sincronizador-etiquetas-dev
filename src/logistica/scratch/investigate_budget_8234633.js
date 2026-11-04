const { pool } = require('../config/database');

async function test8234633() {
    console.log('--- INSPECCIÓN DEL PRESUPUESTO ID 8234633 (CLIENTE 533) ---');
    try {
        const presId = 8234633;
        const resItems = await pool.query(`
            SELECT d.id, d.id_presupuesto, d.articulo, d.cantidad, d.valor1, d.precio1, d.iva1
            FROM public.presupuestos_detalles d
            WHERE d.id_presupuesto = $1
            ORDER BY d.id ASC
        `, [presId]);
        console.log(`\nDetalles del Presupuesto ID ${presId}:`);
        console.table(resItems.rows);

        for (const item of resItems.rows) {
            console.log(`\n🔍 Verificando ganancias Búnker para item ID ${item.id} (código "${item.articulo}"):`);
            
            const resPrice = await pool.query(`
                SELECT 
                    bla.articulo_numero,
                    ba.descripcion,
                    ba.costo_base,
                    ba.porcentaje_iva,
                    bla.precio_final,
                    (bla.precio_final / (1 + COALESCE(ba.porcentaje_iva, 21) / 100.0) - COALESCE(ba.costo_base, 0)) as ganancia_real
                FROM public.bunker_lista_articulos bla
                JOIN public.bunker_cliente_listas_precios bclp ON bclp.bunker_lista_precio_id = bla.lista_id
                JOIN public.bunker_clientes bc ON bc.id = bclp.bunker_cliente_id
                LEFT JOIN public.bunker_articulos ba ON ba.articulo_id = bla.articulo_numero
                LEFT JOIN public.stock_real_consolidado src ON src.articulo_numero = bla.articulo_numero
                WHERE (bc.lomas_soft_id = '0533' OR bc.lomas_soft_id = '533' OR bc.id::text = '533')
                  AND (bla.articulo_numero = $1 OR src.codigo_barras = $1)
            `, [item.articulo]);

            console.log('   - Resultado búsqueda Búnker:', resPrice.rows);
        }

        process.exit(0);
    } catch (e) {
        console.error(e);
        process.exit(1);
    }
}

test8234633();
