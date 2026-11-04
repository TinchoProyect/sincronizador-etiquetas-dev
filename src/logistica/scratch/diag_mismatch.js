const { Pool } = require('pg');
require('dotenv').config();

const pool = new Pool({
    user: process.env.DB_USER || 'postgres',
    host: process.env.DB_HOST || 'localhost',
    database: process.env.DB_NAME || 'etiquetas',
    password: process.env.DB_PASSWORD || 'ta3Mionga',
    port: parseInt(process.env.DB_PORT || '5432')
});

async function main() {
    try {
        console.log('=== 🔍 DIAGNÓSTICO DE COINCIDENCIAS Y STRING MISMATCH ===\n');

        // Check bunker_relacion_atributo_principal categories vs bunker_familia_categorias
        const resMismatch = await pool.query(`
            SELECT r.id, r.familia_id, r.articulo_principal_id, r.articulo_principal_texto, 
                   r.termino_id, r.termino_texto, r.categoria as r_cat,
                   fc.categoria as fc_cat
            FROM public.bunker_relacion_atributo_principal r
            LEFT JOIN public.bunker_familia_categorias fc 
                ON (fc.familia_id = r.familia_id AND LOWER(TRIM(fc.categoria)) = LOWER(TRIM(r.categoria)))
            ORDER BY r.id DESC
        `);
        console.log('Relaciones y sus categorías asociadas en plantillas:');
        console.table(resMismatch.rows);

        // Check if there are any r.categoria that don't match fc.categoria exactly in case/accents
        const resDiff = await pool.query(`
            SELECT r.categoria as r_cat, fc.categoria as fc_cat, COUNT(*)
            FROM public.bunker_relacion_atributo_principal r
            LEFT JOIN public.bunker_familia_categorias fc ON fc.familia_id = r.familia_id AND fc.categoria = r.categoria
            GROUP BY r.categoria, fc.categoria
        `);
        console.log('\nDiferencia exacta de join r.categoria = fc.categoria:');
        console.table(resDiff.rows);

    } catch (e) {
        console.error('Error en diagnóstico:', e);
    } finally {
        await pool.end();
    }
}

main();
