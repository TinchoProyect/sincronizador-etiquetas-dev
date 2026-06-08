const pool = require('../src/produccion/config/database');

async function run() {
    try {
        console.log("--- 5 RECETAS EJEMPLO ---");
        const recetas = await pool.query("SELECT * FROM recetas LIMIT 5");
        console.log(recetas.rows);

        console.log("\n--- 5 INGREDIENTES EJEMPLO ---");
        const ingredientes = await pool.query("SELECT * FROM ingredientes LIMIT 5");
        console.log(ingredientes.rows);

        console.log("\n--- 5 RECETA_INGREDIENTES EJEMPLO ---");
        const recetaIng = await pool.query("SELECT * FROM receta_ingredientes LIMIT 5");
        console.log(recetaIng.rows);

        console.log("\n--- 5 RECETA_ARTICULOS EJEMPLO ---");
        const recetaArt = await pool.query("SELECT * FROM receta_articulos LIMIT 5");
        console.log(recetaArt.rows);

        console.log("\n--- 5 ARTICULOS EJEMPLO ---");
        const articulos = await pool.query("SELECT * FROM articulos LIMIT 5");
        console.log(articulos.rows);

        console.log("\n--- 5 BUNKER_ARTICULOS EJEMPLO ---");
        const bunker = await pool.query("SELECT * FROM bunker_articulos LIMIT 5");
        console.log(bunker.rows);

        // Let's search for the bananas case mentioned in the ticket: "chip de banana por 2 kg"
        console.log("\n--- BUSQUEDA TESTIGO: chip de banana por 2 kg ---");
        const testArt = await pool.query("SELECT * FROM articulos WHERE LOWER(nombre) LIKE '%banana%'");
        console.log("Artículos que contienen 'banana':", testArt.rows);
        
        if (testArt.rows.length > 0) {
            const numeros = testArt.rows.map(r => r.numero);
            const testRecetas = await pool.query("SELECT * FROM recetas WHERE articulo_numero = ANY($1)", [numeros]);
            console.log("Recetas asociadas:", testRecetas.rows);
            
            if (testRecetas.rows.length > 0) {
                const recetaIds = testRecetas.rows.map(r => r.id);
                const testIngs = await pool.query("SELECT * FROM receta_ingredientes WHERE receta_id = ANY($1)", [recetaIds]);
                console.log("Ingredientes de esas recetas:", testIngs.rows);
            }
        }
    } catch (e) {
        console.error("Error:", e);
    } finally {
        pool.end();
    }
}

run();
