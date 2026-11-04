const { pool } = require('../src/logistica/config/database');

async function testJoin() {
    try {
        console.log('🔍 Buscando facturas con su bunker_cliente_id asociado...');
        const query = `
            SELECT 
                f.id,
                f.cliente_id,
                bc.id as bunker_cliente_id,
                bc.razon_social,
                bc.lomas_soft_id
            FROM factura_facturas f
            LEFT JOIN bunker_clientes bc ON 
                (CASE 
                    WHEN bc.lomas_soft_id ~ '^\\d+$' THEN bc.lomas_soft_id::integer 
                    ELSE NULL 
                END) = f.cliente_id
            ORDER BY f.id DESC
            LIMIT 10
        `;
        const res = await pool.query(query);
        console.log('Resultados de facturas recientes y su asociación con Bunker:', res.rows);
    } catch (err) {
        console.error('Error:', err);
    } finally {
        await pool.end();
    }
}

testJoin();
