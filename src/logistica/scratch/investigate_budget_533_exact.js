const { pool } = require('../config/database');

async function checkExact533() {
    console.log('--- DETALLES EXACTOS PRESUPUESTOS Y PRODUCTOS BUSCADOS ---');
    try {
        // 1. Buscar presupuesto de cliente Crusalva (533)
        const resPres = await pool.query(`
            SELECT p.id, p.secuencia, p.id_presupuesto_ext, p.id_cliente, p.usar_precios_bunker, p.descuento, p.estado, p.fecha
            FROM public.presupuestos p
            WHERE p.id_cliente::text = '533' OR p.id::text = '533' OR p.secuencia::text = '533' OR p.id_presupuesto_ext ILIKE '%533%'
            ORDER BY p.id DESC
            LIMIT 5
        `);
        console.log('\n1. Presupuestos para cliente 533:');
        console.table(resPres.rows);

        for (const p of resPres.rows) {
            const resItems = await pool.query(`
                SELECT d.id, d.id_presupuesto, d.articulo, d.cantidad, d.valor1, d.precio1, d.iva1, d.camp1, d.camp2, d.camp3, d.camp4, d.camp5, d.camp6
                FROM public.presupuestos_detalles d
                WHERE d.id_presupuesto = $1
                ORDER BY d.id ASC
            `, [p.id]);
            console.log(`\n2. Detalles del Presupuesto ID ${p.id} (usar_bunker: ${p.usar_precios_bunker}):`);
            console.table(resItems.rows);

            // Para cada item, buscar qué devuelve obtenerSugerenciasArticulos para el código en `d.articulo`
            for (const item of resItems.rows) {
                const code = item.articulo;
                console.log(`\n🔍 Probando consulta de sugerencia para d.articulo = "${code}":`);
                
                // Con usar_bunker = false
                const resNoBunker = await pool.query(`
                    SELECT src.codigo_barras, src.articulo_numero, src.descripcion, src.stock_consolidado
                    FROM public.stock_real_consolidado src
                    WHERE (src.codigo_barras = $1 OR src.articulo_numero = $1 OR src.descripcion ILIKE $2)
                    ORDER BY CASE WHEN COALESCE(src.stock_consolidado,0) > 0 THEN 0 ELSE 1 END ASC, src.descripcion ASC
                    LIMIT 3
                `, [code, `%${code}%`]);
                console.log('   - Resultado (usar_bunker=false):', resNoBunker.rows);

                // Con usar_bunker = true
                const resWithBunker = await pool.query(`
                    SELECT ba.articulo_id, ba.descripcion, ba.descripcion_generada, src.codigo_barras, src.descripcion as desc_src
                    FROM public.bunker_articulos ba
                    LEFT JOIN public.stock_real_consolidado src ON src.articulo_numero = ba.articulo_id
                    WHERE (ba.articulo_id = $1 OR src.codigo_barras = $1 OR ba.descripcion ILIKE $2 OR src.descripcion ILIKE $2)
                    LIMIT 3
                `, [code, `%${code}%`]);
                console.log('   - Resultado (usar_bunker=true):', resWithBunker.rows);
            }
        }

        process.exit(0);
    } catch (e) {
        console.error('Error:', e);
        process.exit(1);
    }
}

checkExact533();
