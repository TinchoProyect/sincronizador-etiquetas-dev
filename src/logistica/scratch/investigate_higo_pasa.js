const { pool } = require('../config/database');

async function checkHigoPasa() {
    console.log('--- INVESTIGACIÓN HIGO NEGRO VS PASA JUMBO ---');
    try {
        // 1. Buscar Higo negro y Pasa Jumbo en stock_real_consolidado
        const resSRC = await pool.query(`
            SELECT src.articulo_numero, src.descripcion, src.codigo_barras, src.stock_consolidado
            FROM public.stock_real_consolidado src
            WHERE src.descripcion ILIKE '%higo%negro%' OR src.descripcion ILIKE '%pasa%jumbo%' OR src.descripcion ILIKE '%pasas%jumbo%'
        `);
        console.log('\n1. stock_real_consolidado:');
        console.table(resSRC.rows);

        // 2. Buscar en bunker_articulos
        const resBA = await pool.query(`
            SELECT ba.articulo_id, ba.descripcion, ba.descripcion_generada, src.codigo_barras
            FROM public.bunker_articulos ba
            LEFT JOIN public.stock_real_consolidado src ON src.articulo_numero = ba.articulo_id
            WHERE ba.descripcion ILIKE '%higo%negro%' OR ba.descripcion ILIKE '%pasa%jumbo%' OR ba.descripcion_generada ILIKE '%higo%negro%' OR ba.descripcion_generada ILIKE '%pasa%jumbo%'
        `);
        console.log('\n2. bunker_articulos:');
        console.table(resBA.rows);

        // 3. Buscar en presupuestos_detalles si hay filas con "Higo" o con códigos de Higo/Pasa Jumbo
        const resDet = await pool.query(`
            SELECT pd.id, pd.id_presupuesto, p.id_cliente, pd.articulo, pd.cantidad, pd.precio1, p.usar_precios_bunker, p.fecha
            FROM public.presupuestos_detalles pd
            JOIN public.presupuestos p ON p.id = pd.id_presupuesto
            WHERE pd.articulo IN (
                SELECT codigo_barras FROM public.stock_real_consolidado WHERE descripcion ILIKE '%higo%negro%' OR descripcion ILIKE '%pasa%jumbo%'
                UNION
                SELECT articulo_numero FROM public.stock_real_consolidado WHERE descripcion ILIKE '%higo%negro%' OR descripcion ILIKE '%pasa%jumbo%'
            )
            ORDER BY p.id DESC
            LIMIT 10
        `);
        console.log('\n3. Ocurrencias en presupuestos_detalles:');
        console.table(resDet.rows);

        process.exit(0);
    } catch (e) {
        console.error(e);
        process.exit(1);
    }
}

checkHigoPasa();
