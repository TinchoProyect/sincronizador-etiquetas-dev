const { Pool } = require('pg');
const pool = new Pool({
    user: 'postgres',
    host: 'localhost',
    database: 'etiquetas',
    password: 'ta3Mionga',
    port: 5432,
});

async function inspectArticles() {
    const testIds = ['BFX50G', 'MFSx5', 'CSC88-110x5R', 'AGPx10', 'NUEZx1'];
    
    for (const id of testIds) {
        console.log(`\n=================== ARTÍCULO: ${id} ===================`);
        const resBA = await pool.query('SELECT * FROM bunker_articulos WHERE articulo_id = $1', [id]);
        console.log('BUNKER_ARTICULO:', resBA.rows[0]);

        const resLA = await pool.query('SELECT * FROM bunker_lista_articulos WHERE articulo_numero = $1 ORDER BY lista_id ASC', [id]);
        console.log('LISTAS DE PRECIOS:', resLA.rows);

        const resReceta = await pool.query(`
            SELECT r.*, ri.nombre_ingrediente, ri.cantidad, i.costo_patron
            FROM recetas r
            JOIN receta_ingredientes ri ON ri.receta_id = r.id
            JOIN ingredientes i ON i.id = ri.ingrediente_id
            WHERE r.articulo_numero = $1
        `, [id]);
        console.log('RECETA:', resReceta.rows);

        const resInsumos = await pool.query(`
            SELECT li.*, a.nombre, p.costo
            FROM bunker_lista_insumos li
            LEFT JOIN bunker_lista_articulos la ON la.id = li.lista_articulo_id
            LEFT JOIN articulos a ON a.numero = li.insumo_articulo_numero
            LEFT JOIN precios_articulos p ON p.articulo = li.insumo_articulo_numero
            WHERE la.articulo_numero = $1
        `, [id]);
        console.log('INSUMOS:', resInsumos.rows);
    }

    pool.end();
}
inspectArticles();
