const { pool } = require('../config/database');

async function checkFam() {
    try {
        console.log('--- INSPECCIÓN DE ARTÍCULOS PRINCIPALES EN FAMILIAS ---');
        
        // Frutos Secos (id 1)
        const resFS = await pool.query(`
            SELECT r.id, r.familia_id, f.nombre as familia_nombre, r.articulo_principal_id, d.termino, r.categoria
            FROM public.bunker_relacion_atributo_principal r
            JOIN public.bunker_familias f ON f.id = r.familia_id
            JOIN public.bunker_diccionario d ON d.id = r.articulo_principal_id
            WHERE r.familia_id = 1 AND r.categoria = 'articulo_principal'
            ORDER BY d.termino ASC
        `);
        console.log('\nArtículos Principales en FRUTOS SECOS (id=1):');
        console.table(resFS.rows);

        // Frutas Disecadas (id 26)
        const resFD = await pool.query(`
            SELECT r.id, r.familia_id, f.nombre as familia_nombre, r.articulo_principal_id, d.termino, r.categoria
            FROM public.bunker_relacion_atributo_principal r
            JOIN public.bunker_familias f ON f.id = r.familia_id
            JOIN public.bunker_diccionario d ON d.id = r.articulo_principal_id
            WHERE r.familia_id = 26 AND r.categoria = 'articulo_principal'
            ORDER BY d.termino ASC
        `);
        console.log('\nArtículos Principales en FRUTAS DISECADAS (id=26):');
        console.table(resFD.rows);

        process.exit(0);
    } catch (e) {
        console.error(e);
        process.exit(1);
    }
}

checkFam();
