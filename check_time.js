const pool = require('./src/produccion/config/database');
async function run() {
    try {
        let res = await pool.query(`
            SELECT p.id, p.fecha, pd.cantidad, pd.valor1, pd.precio1
            FROM presupuestos p
            JOIN presupuestos_detalles pd ON pd.id_presupuesto = p.id
            WHERE p.tipo_comprobante = 'Orden de Retiro'
            ORDER BY p.id DESC LIMIT 5;
        `);
        console.log(res.rows);
    } catch(e) {
        console.error(e);
    } finally {
        pool.end();
    }
}
run();
