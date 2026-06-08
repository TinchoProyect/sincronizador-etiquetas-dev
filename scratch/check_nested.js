const pool = require('../src/produccion/config/database');

async function run() {
    try {
        const totalRecetas = await pool.query("SELECT COUNT(*)::integer as count FROM recetas");
        console.log(`Total recetas: ${totalRecetas.rows[0].count}`);

        const totalIngRecetas = await pool.query("SELECT COUNT(*)::integer as count FROM receta_ingredientes");
        console.log(`Total receta_ingredientes: ${totalIngRecetas.rows[0].count}`);

        const units = await pool.query("SELECT distinct unidad_medida FROM receta_ingredientes");
        console.log("Distinct units in receta_ingredientes:", units.rows);

        const nested = await pool.query(`
            SELECT r.articulo_numero as parent_recipe, ra.articulo_numero as child_article
            FROM recetas r
            JOIN receta_articulos ra ON r.id = ra.receta_id
        `);
        console.log(`Nested recipes (receta_articulos):`, nested.rows);

        const mixComposition = await pool.query("SELECT COUNT(*)::integer as count FROM ingrediente_composicion");
        console.log(`Total ingrediente_composicion: ${mixComposition.rows[0].count}`);

    } catch (e) {
        console.error("Error:", e);
    } finally {
        pool.end();
    }
}

run();
