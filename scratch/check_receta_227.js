const pool = require('../src/produccion/config/database');

async function check227() {
    try {
        console.log('=== AUDITORÍA DE RECETA ID 227 Y SUS SALIDAS/ARTÍCULOS ===');
        const rec = await pool.query(`SELECT * FROM public.recetas WHERE id = 227`);
        console.log('Cabecera de Receta 227:', rec.rows);

        const recArt = await pool.query(`SELECT * FROM public.receta_articulos WHERE receta_id = 227`);
        console.log('Artículos vinculados en receta_articulos para receta 227:', recArt.rows);

        const recIng = await pool.query(`
            SELECT ri.*, i.nombre as ingrediente_nombre 
            FROM public.receta_ingredientes ri 
            JOIN public.ingredientes i ON ri.ingrediente_id = i.id 
            WHERE ri.receta_id = 227
        `);
        console.log('Ingredientes de Receta 227:', recIng.rows);

    } catch (err) {
        console.error(err);
    } finally {
        await pool.end();
    }
}

check227();
