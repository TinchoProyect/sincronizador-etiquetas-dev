const { pool } = require('../config/database');

async function checkSupaCabeceraSchema() {
    console.log('================================================================================');
    console.log('🔍 AUDITORÍA DE COLUMNAS EN clientes_b2b_pedidos_cabecera (SUPABASE B2B)');
    console.log('================================================================================\n');

    try {
        const url = process.env.SUPABASE_B2B_URL;
        const key = process.env.SUPABASE_B2B_SERVICE_KEY;

        const res = await fetch(`${url}/rest/v1/clientes_b2b_pedidos_cabecera?limit=1`, {
            headers: {
                'apikey': key,
                'Authorization': `Bearer ${key}`
            }
        });

        const data = await res.json();
        console.log('Columnas de clientes_b2b_pedidos_cabecera:');
        if (Array.isArray(data) && data.length > 0) {
            console.log(Object.keys(data[0]));
        } else {
            console.log('Fila devuelta:', data);
        }

        // Revisar los 7 presupuestos locales más recientes
        const res7 = await pool.query(`
            SELECT p.id, p.id_cliente, p.fecha, m.supabase_pedido_id 
            FROM public.presupuestos p
            LEFT JOIN public.b2b_pedidos_mapeo m ON m.local_presupuesto_id = p.id
            WHERE p.activo = true 
            ORDER BY p.id DESC 
            LIMIT 7
        `);

        console.log('\n2. Estado de los últimos 7 presupuestos locales:');
        console.table(res7.rows);

        process.exit(0);
    } catch (e) {
        console.error(e);
        process.exit(1);
    }
}

checkSupaCabeceraSchema();
