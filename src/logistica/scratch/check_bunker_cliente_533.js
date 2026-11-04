const { pool } = require('../config/database');

async function checkBunker533() {
    console.log('--- INSPECCIÓN DE CLIENTE 533 EN bunker_clientes ---');
    try {
        const resBC = await pool.query(`
            SELECT bc.id, bc.lomas_soft_id, bc.razon_social, bclp.bunker_lista_precio_id
            FROM public.bunker_clientes bc
            LEFT JOIN public.bunker_cliente_listas_precios bclp ON bclp.bunker_cliente_id = bc.id
            WHERE bc.lomas_soft_id ILIKE '%533%' OR bc.id = 533
        `);
        console.table(resBC.rows);

        const resCheckQuery = await pool.query(`
            SELECT 
                c.cliente_id as id_cliente,
                c.nombre,
                c.apellido,
                c.condicion_iva,
                EXISTS (
                    SELECT 1 
                    FROM public.bunker_clientes bc
                    JOIN public.bunker_cliente_listas_precios bclp ON bclp.bunker_cliente_id = bc.id
                    WHERE bc.lomas_soft_id = LPAD(c.cliente_id::text, 4, '0') OR bc.lomas_soft_id = c.cliente_id::text OR bc.id = c.cliente_id
                ) as tiene_listas_bunker
            FROM public.clientes c
            WHERE c.cliente_id = 533
            LIMIT 1
        `);
        console.log('\nResultado query cliente 533:');
        console.table(resCheckQuery.rows);

        process.exit(0);
    } catch (e) {
        console.error(e);
        process.exit(1);
    }
}

checkBunker533();
