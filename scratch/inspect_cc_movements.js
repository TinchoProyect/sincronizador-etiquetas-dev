const { pool } = require('../src/logistica/config/database');

async function inspect() {
    try {
        const id = 6;
        const ccRes = await pool.query(
            'SELECT * FROM public.factura_cuentas_corrientes WHERE id = $1',
            [id]
        );
        console.log("CUENTA CORRIENTE:", ccRes.rows[0]);
        
        const movsRes = await pool.query(
            'SELECT * FROM public.factura_cuenta_corriente_movimientos WHERE cuenta_corriente_id = $1 ORDER BY fecha_movimiento ASC, id ASC',
            [id]
        );
        console.log(`TOTAL MOVIMIENTOS: ${movsRes.rows.length}`);
        movsRes.rows.forEach(m => {
            console.log(`- ID: ${m.id}, Fecha: ${m.fecha_movimiento}, Desc: ${m.descripcion}, Tipo: ${m.tipo_movimiento}, Monto: ${m.monto}, Saldo: ${m.saldo_resultante}`);
        });
    } catch (err) {
        console.error(err);
    }
}
inspect().then(() => pool.end());
