require('dotenv').config();
const { Pool } = require('pg');
const pool = new Pool({
    user: process.env.DB_USER || 'postgres',
    host: process.env.DB_HOST || 'localhost',
    database: process.env.DB_NAME || 'etiquetas',
    password: process.env.DB_PASSWORD || '1234',
    port: process.env.DB_PORT || 5432,
});

async function test() {
    try {
        console.log("Conectando...");
        const res3 = await pool.query(`
            SELECT id, articulo_numero, tipo_movimiento, id_presupuesto_origen FROM mantenimiento_movimientos WHERE articulo_numero = 'NMELCHx5' AND tipo_movimiento = 'INGRESO';
        `);
        console.log("Movements for NMELCHx5:", res3.rows);

        const res2 = await pool.query(`
            SELECT id, cliente_id, estado, presupuesto_id FROM factura_facturas WHERE cliente_id = 1 AND estado = 'APROBADA';
        `);
        console.log("Approved invoices for client 1:", res2.rows);

        const res = await pool.query(`
            SELECT mm.id as mm_id, mm.articulo_numero, mm.tipo_movimiento, mm.id_presupuesto_origen, f.id as f_id, f.estado as f_estado, f.cliente_id as f_cliente
            FROM mantenimiento_movimientos mm
            LEFT JOIN factura_facturas f ON f.presupuesto_id = mm.id_presupuesto_origen
            WHERE mm.articulo_numero = 'NMELCHx5' AND mm.tipo_movimiento = 'INGRESO'
            ORDER BY mm.fecha_movimiento DESC LIMIT 10;
        `);
        console.log("Joined Result:", res.rows);

        process.exit(0);
    } catch (e) {
        console.error(e);
        process.exit(1);
    }
}
test();
