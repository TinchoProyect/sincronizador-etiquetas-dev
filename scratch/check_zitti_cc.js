const { pool } = require('../src/logistica/config/database');

async function check() {
    try {
        console.log("=== CLIENTE ===");
        const cliRes = await pool.query("SELECT * FROM public.bunker_clientes WHERE codigo_bunker_cliente = 'CB-0010'");
        console.log(cliRes.rows);

        console.log("\n=== CUENTAS CORRIENTES ===");
        const ccRes = await pool.query("SELECT * FROM public.factura_cuentas_corrientes WHERE codigo_bunker_cliente = 'CB-0010'");
        console.log(ccRes.rows);

        if (ccRes.rows.length > 0) {
            const ccId = ccRes.rows[0].id;
            console.log(`\n=== MOVIMIENTOS DE LA CUENTA ID ${ccId} ===`);
            const movsRes = await pool.query(`
                SELECT m.*, f.pto_vta, f.cbte_nro, f.nro_interno, f.cae, f.estado as factura_estado
                FROM public.factura_cuenta_corriente_movimientos m
                LEFT JOIN public.factura_facturas f ON m.comprobante_id = f.id
                WHERE m.cuenta_corriente_id = $1
                ORDER BY m.fecha_movimiento ASC, m.id ASC
            `, [ccId]);
            console.log(movsRes.rows);
        }

    } catch (err) {
        console.error(err);
    } finally {
        pool.end();
    }
}

check();
