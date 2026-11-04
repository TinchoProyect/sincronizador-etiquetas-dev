require('dotenv').config();
const { Pool } = require('pg');

const pool = new Pool({
    user: process.env.DB_USER || 'postgres',
    host: process.env.DB_HOST || 'localhost',
    database: process.env.DB_NAME || 'etiquetas',
    password: process.env.DB_PASSWORD || 'ta3Mionga',
    port: parseInt(process.env.DB_PORT || '5432'),
});

async function run() {
    try {
        console.log("--- QUERYING ALL maintenance movements for AATGX5/3256419852 ---");
        const res = await pool.query(
            "SELECT id, articulo_numero, cantidad, usuario, tipo_movimiento, observaciones, estado, fecha_movimiento FROM public.mantenimiento_movimientos WHERE articulo_numero IN ('AATGX5', '3256419852') ORDER BY id ASC"
        );
        console.table(res.rows);
    } catch (e) {
        console.error(e);
    } finally {
        await pool.end();
    }
}
run();
