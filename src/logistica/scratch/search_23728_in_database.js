const { pool } = require('../config/database');

async function searchDatabaseForValue() {
    console.log('================================================================================');
    console.log('🔍 BÚSQUEDA DE VALOR EXPLICITO 23728 O 5296 EN LA BASE DE DATOS');
    console.log('================================================================================\n');

    try {
        // 1. Buscar en bunker_articulos
        const resArt = await pool.query(`
            SELECT articulo_id, descripcion, costo_base 
            FROM public.bunker_articulos 
            WHERE costo_base::text LIKE '%23728%' OR costo_base::text LIKE '%5296%'
        `);
        console.log('1. Coincidencias en bunker_articulos:');
        console.table(resArt.rows);

        // 2. Buscar en bunker_lista_articulos
        const resLista = await pool.query(`
            SELECT id, articulo_numero, lista_id, precio_final, costo_base_sobrescrito 
            FROM public.bunker_lista_articulos 
            WHERE costo_base_sobrescrito::text LIKE '%23728%' OR precio_final::text LIKE '%23728%'
               OR costo_base_sobrescrito::text LIKE '%5296%' OR precio_final::text LIKE '%5296%'
        `);
        console.log('2. Coincidencias en bunker_lista_articulos:');
        console.table(resLista.rows);

        // 3. Buscar en lotes o historial de compras
        const resLotes = await pool.query(`
            SELECT * FROM public.bunker_lotes 
            WHERE costo_kilo_al_momento::text LIKE '%23728%' OR costo_kilo_al_momento::text LIKE '%5296%'
        `);
        console.log('3. Coincidencias en bunker_lotes:');
        console.table(resLotes.rows);

        process.exit(0);
    } catch (e) {
        console.error(e);
        process.exit(1);
    }
}

searchDatabaseForValue();
