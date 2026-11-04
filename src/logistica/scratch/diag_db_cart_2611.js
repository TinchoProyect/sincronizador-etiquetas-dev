require('dotenv').config();
const { Pool } = require('pg');

const pool = new Pool({
    user: process.env.DB_USER || 'postgres',
    host: process.env.DB_HOST || 'localhost',
    database: process.env.DB_NAME || 'etiquetas',
    password: process.env.DB_PASSWORD || 'ta3Mionga',
    port: parseInt(process.env.DB_PORT || '5432')
});

async function inspectRecipes() {
    const client = await pool.connect();
    try {
        console.log('🔍 Consultando todas las recetas para BFX50G, BFXP, BFXUNI...');
        const resRecetas = await client.query(`
            SELECT id, articulo_numero FROM public.recetas
            WHERE articulo_numero IN ('BFX50G', 'BFXP', 'BFXUNI')
        `);
        console.log('Recetas encontradas:', resRecetas.rows);

        for (const rec of resRecetas.rows) {
            console.log(`\n--- Receta id ${rec.id} (articulo_numero: ${rec.articulo_numero}) ---`);
            const resArts = await client.query(`
                SELECT ra.*, a.nombre 
                FROM public.receta_articulos ra 
                LEFT JOIN public.articulos a ON a.numero = ra.articulo_numero 
                WHERE ra.receta_id = $1
            `, [rec.id]);
            console.log('receta_articulos:', resArts.rows);

            const resIngs = await client.query(`
                SELECT ri.*, i.nombre 
                FROM public.receta_ingredientes ri 
                LEFT JOIN public.ingredientes i ON i.id = ri.ingrediente_id 
                WHERE ri.receta_id = $1
            `, [rec.id]);
            console.log('receta_ingredientes:', resIngs.rows);
        }

    } catch (err) {
        console.error('Error in inspectRecipes:', err);
    } finally {
        client.release();
        await pool.end();
    }
}

inspectRecipes();
