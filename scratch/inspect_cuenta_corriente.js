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
        console.log("--- CLIENT CB-0010 DETAILS ---");
        const clientRes = await pool.query(
            "SELECT * FROM public.bunker_clientes WHERE codigo_bunker_cliente = 'CB-0010' OR lomas_soft_id = '0016' OR lomas_soft_id = '16'"
        );
        console.table(clientRes.rows);

        if (clientRes.rows.length > 0) {
            const clientBunkerCode = clientRes.rows[0].codigo_bunker_cliente;

            console.log("--- ACCOUNT BALANCE (factura_cuentas_corrientes) ---");
            const balanceRes = await pool.query(
                "SELECT * FROM public.factura_cuentas_corrientes WHERE codigo_bunker_cliente = $1",
                [clientBunkerCode]
            );
            console.table(balanceRes.rows);

            if (balanceRes.rows.length > 0) {
                const ccId = balanceRes.rows[0].id;

                console.log("--- MOVEMENTS (factura_cuenta_corriente_movimientos) ---");
                const movsRes = await pool.query(
                    "SELECT * FROM public.factura_cuenta_corriente_movimientos WHERE cuenta_corriente_id = $1 ORDER BY fecha_movimiento DESC, id DESC",
                    [ccId]
                );
                console.table(movsRes.rows);
            }
        }
    } catch (e) {
        console.error(e);
    } finally {
        await pool.end();
    }
}
run();
