const { Pool } = require('pg');
const pool = new Pool({
    user: 'postgres',
    host: 'localhost',
    database: 'etiquetas',
    password: 'ta3Mionga',
    port: 5432,
});

async function checkFactura(facturaId) {
    const res = await pool.query(`
        SELECT f.id, f.presupuesto_id, f.imp_neto, f.imp_total,
               pd.articulo, pd.cantidad, pd.valor1, pd.precio1,
               a.numero as a_numero, a.nombre as a_nombre,
               ba.articulo_id as ba_id, ba.descripcion as ba_desc, ba.kilos_unidad, ba.costo_base as ba_costo_base
        FROM factura_facturas f
        JOIN presupuestos_detalles pd ON pd.id_presupuesto = f.presupuesto_id
        LEFT JOIN articulos a ON (a.codigo_barras = pd.articulo OR a.numero = pd.articulo)
        LEFT JOIN bunker_articulos ba ON (ba.articulo_id = pd.articulo OR ba.articulo_id = a.numero)
        WHERE f.id = $1
    `, [facturaId]);

    console.log(`FACTURA ${facturaId} DETALLES:`);
    for (const r of res.rows) {
        console.log(r);
        const artId = r.ba_id || r.a_numero;
        const resLA = await pool.query('SELECT * FROM bunker_lista_articulos WHERE articulo_numero = $1', [artId]);
        console.log(`LISTA ARTICULOS FOR ${artId}:`, resLA.rows);
        const resReceta = await pool.query(`
            SELECT r.*, ri.nombre_ingrediente, ri.cantidad, i.costo_patron
            FROM recetas r
            JOIN receta_ingredientes ri ON ri.receta_id = r.id
            JOIN ingredientes i ON i.id = ri.ingrediente_id
            WHERE r.articulo_numero = $1
        `, [artId]);
        console.log(`RECETA FOR ${artId}:`, resReceta.rows);
    }
    pool.end();
}
checkFactura(process.argv[2] ? parseInt(process.argv[2]) : 137);
