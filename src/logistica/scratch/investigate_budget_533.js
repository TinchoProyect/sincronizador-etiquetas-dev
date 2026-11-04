const { pool } = require('../config/database');

async function checkBudget533() {
    console.log('--- INVESTIGACIÓN FORENSE PRESUPUESTO CLIENTE 533 (CRUSALVA) ---');
    try {
        const resPres = await pool.query(`
            SELECT p.id, p.secuencia, p.id_presupuesto_ext, p.id_cliente, p.cliente_nuevo_id, p.usar_precios_bunker, p.descuento, p.estado, p.fecha
            FROM public.presupuestos p
            WHERE p.id::text = '533' OR p.secuencia::text = '533' OR p.id_cliente::text = '533' OR p.cliente_nuevo_id::text = '533' OR p.id_presupuesto_ext ILIKE '%533%'
            ORDER BY p.id DESC
            LIMIT 10
        `);
        console.log('\n1. Presupuesto(s) encontrado(s):');
        console.table(resPres.rows);

        if (resPres.rows.length === 0) {
            console.log('No se encontró presupuesto con 533');
            process.exit(0);
        }

        for (const p of resPres.rows) {
            const resItems = await pool.query(`
                SELECT d.id, d.id_presupuesto, d.articulo, d.cantidad, d.valor1, d.precio1, d.iva1
                FROM public.presupuestos_detalles d
                WHERE d.id_presupuesto = $1
                ORDER BY d.id ASC
            `, [p.id]);
            console.log(`\n2. Detalles del Presupuesto ID ${p.id} (Ext: ${p.id_presupuesto_ext}, Cliente: ${p.id_cliente}, usar_bunker: ${p.usar_precios_bunker}):`);
            console.table(resItems.rows);
        }

        const resCli = await pool.query(`
            SELECT c.id, c.id_cliente_legacy, c.razon_social, c.lista_precio_id
            FROM public.bunker_clientes c
            WHERE c.id_cliente_legacy::text = '533' OR c.razon_social ILIKE '%crusalva%' OR c.id::text = '533'
        `);
        console.log('\n3. Cliente 533 en bunker_clientes:');
        console.table(resCli.rows);

        process.exit(0);
    } catch (e) {
        console.error('Error:', e);
        process.exit(1);
    }
}

checkBudget533();
