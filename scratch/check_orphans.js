const pool = require('../src/produccion/config/database');

async function run() {
    try {
        const query = `
            SELECT r.articulo_numero, r.descripcion
            FROM recetas r
            LEFT JOIN articulos a ON r.articulo_numero = a.numero
            WHERE a.numero IS NULL
            LIMIT 20;
        `;
        const res = await pool.query(query);
        console.log("Recipes without direct article mapping:", res.rows);
    } catch (e) {
        console.error("Error:", e);
    } finally {
        pool.end();
    }
}

run();
