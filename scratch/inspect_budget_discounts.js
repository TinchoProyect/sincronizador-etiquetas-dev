const { Pool } = require('c:/Users/Martin/Documents/sincronizador-etiquetas - copia/node_modules/pg');
const pool = new Pool({ connectionString: 'postgres://postgres:ta3Mionga@localhost:5432/etiquetas' });

pool.query(`
    SELECT id, fecha, descuento, id_cliente, nota 
    FROM public.presupuestos 
    WHERE descuento > 0 
    LIMIT 10
`)
.then(res => {
    console.log('Sample budgets with discount:');
    res.rows.forEach(row => {
        console.log(`ID: ${row.id}, fecha: ${row.fecha}, id_cliente: ${row.id_cliente}, descuento: ${row.descuento}, nota: ${row.nota}`);
    });
    pool.end();
})
.catch(err => {
    console.error(err);
    pool.end();
});
