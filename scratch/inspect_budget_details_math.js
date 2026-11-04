const { Pool } = require('c:/Users/Martin/Documents/sincronizador-etiquetas - copia/node_modules/pg');
const pool = new Pool({ connectionString: 'postgres://postgres:ta3Mionga@localhost:5432/etiquetas' });

pool.query(`
    SELECT articulo, cantidad, valor1, precio1, iva1
    FROM public.presupuestos_detalles
    WHERE id_presupuesto = 8234410
`)
.then(res => {
    console.log('Items of budget 8234410:');
    let sumPrecio1 = 0;
    let sumValor1 = 0;
    let sumIva1 = 0;
    res.rows.forEach(row => {
        console.log(`Art: ${row.articulo}, Qty: ${row.cantidad}, valor1 (Net): ${row.valor1}, precio1 (Total): ${row.precio1}, iva1 (IVA): ${row.iva1}`);
        sumPrecio1 += parseFloat(row.precio1) || 0;
        sumValor1 += parseFloat(row.valor1) || 0;
        sumIva1 += parseFloat(row.iva1) || 0;
    });
    console.log(`Sum of precio1 (Total with IVA): $${sumPrecio1}`);
    console.log(`Discounted Sum (5% off): $${sumPrecio1 * 0.95}`);
    console.log(`Expected CC Monto: $324046.35`);
    console.log(`Difference: $${(sumPrecio1 * 0.95) - 324046.35}`);
    pool.end();
})
.catch(err => {
    console.error(err);
    pool.end();
});
