const pool = require('../src/produccion/config/database');

async function checkAlmendras() {
    try {
        console.log('=== BUSCANDO ARTÍCULOS CON "ALMENDRA" O "22.68" EN TODAS LAS TABLAS DE ARTÍCULOS ===');
        
        const bArt = await pool.query(`SELECT articulo_id, descripcion, descripcion_generada FROM public.bunker_articulos WHERE descripcion ILIKE '%almendra%' OR descripcion_generada ILIKE '%almendra%' OR articulo_id ILIKE '%alm%'`);
        console.log('\n--- public.bunker_articulos ---');
        console.table(bArt.rows);

        const art = await pool.query(`SELECT numero, nombre FROM public.articulos WHERE nombre ILIKE '%almendra%' OR numero ILIKE '%alm%'`);
        console.log('\n--- public.articulos ---');
        console.table(art.rows);

        const rec = await pool.query(`SELECT id, articulo_numero, descripcion FROM public.recetas WHERE descripcion ILIKE '%almendra%' OR articulo_numero ILIKE '%alm%'`);
        console.log('\n--- public.recetas ---');
        console.table(rec.rows);

        const recArt = await pool.query(`
            SELECT ra.receta_id, ra.articulo_numero, ra.cantidad, r.articulo_numero as receta_padre, r.descripcion as receta_desc
            FROM public.receta_articulos ra
            JOIN public.recetas r ON ra.receta_id = r.id
            WHERE ra.articulo_numero ILIKE '%alm%' OR r.descripcion ILIKE '%almendra%'
        `);
        console.log('\n--- public.receta_articulos ---');
        console.table(recArt.rows);

    } catch (err) {
        console.error(err);
    } finally {
        await pool.end();
    }
}

checkAlmendras();
