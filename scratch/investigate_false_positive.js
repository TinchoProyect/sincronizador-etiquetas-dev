const pool = require('../src/produccion/config/database');

async function investigate() {
    try {
        console.log('🔍 Buscando todos los artículos en bunker_articulos...');
        const artRes = await pool.query(`
            SELECT articulo_id, descripcion, descripcion_generada, pack_hijo_codigo, kilos_unidad 
            FROM public.bunker_articulos 
            ORDER BY descripcion ASC
        `);
        console.log(`Total artículos en bunker_articulos: ${artRes.rows.length}`);
        
        for (const art of artRes.rows) {
            // Check 1: public.recetas (articulo_numero = art.articulo_id)
            const recHeader = await pool.query(`SELECT id, articulo_numero, descripcion FROM public.recetas WHERE articulo_numero = $1`, [art.articulo_id]);
            
            // Check 2: public.receta_articulos (articulo_numero = art.articulo_id)
            const recArt = await pool.query(`
                SELECT ra.receta_id, ra.articulo_numero, ra.cantidad, r.articulo_numero as receta_padre_articulo, r.descripcion as receta_padre_desc
                FROM public.receta_articulos ra
                JOIN public.recetas r ON ra.receta_id = r.id
                WHERE ra.articulo_numero = $1
            `, [art.articulo_id]);

            const tieneRecetaHeader = recHeader.rows.length > 0;
            const tieneRecetaInsumo = recArt.rows.length > 0;

            if (tieneRecetaHeader || tieneRecetaInsumo) {
                console.log(`\n📌 SKU: [${art.articulo_id}] ${art.descripcion}`);
                console.log(`   Header en public.recetas (${recHeader.rows.length}):`, recHeader.rows);
                console.log(`   Insumo en public.receta_articulos (${recArt.rows.length}):`, recArt.rows);
            }
        }
    } catch (err) {
        console.error('Error:', err);
    } finally {
        await pool.end();
    }
}

investigate();
