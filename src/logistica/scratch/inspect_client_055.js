const { Pool } = require('pg');

const pool = new Pool({
    user: 'postgres',
    host: 'localhost',
    database: 'etiquetas',
    password: 'ta3Mionga',
    port: 5432,
});

async function main() {
    try {
        console.log('--- MOVEMENTS FOR CB-0011 (CC ID 7) ---');
        const resMov = await pool.query("SELECT id, tipo_movimiento, tipo_comprobante, monto, saldo_resultante, descripcion, fecha_movimiento FROM public.factura_cuenta_corriente_movimientos WHERE cuenta_corriente_id = 7 ORDER BY fecha_movimiento DESC, id DESC LIMIT 10");
        console.log(resMov.rows);
    } catch (e) {
        console.error(e);
    } finally {
        await pool.end();
    }
}

main();
