const { Pool } = require('pg');
require('dotenv').config();

const pool = new Pool({
    user: process.env.DB_USER || 'postgres',
    host: process.env.DB_HOST || 'localhost',
    database: process.env.DB_NAME || 'etiquetas',
    password: process.env.DB_PASSWORD || 'ta3Mionga',
    port: parseInt(process.env.DB_PORT || '5432')
});

async function sanitizeUnlinkedDescriptions() {
    const client = await pool.connect();
    try {
        console.log('=== 🧹 SANEAMIENTO PREVENTIVO: RECLASIFICACIÓN DE NOMBRES COMPLETOS HUÉRFANOS EN DICCIONARIO ===\n');

        await client.query('BEGIN');

        // Reclasificar aquellos registros etiquetados como 'articulo_principal' que no poseen NINGUNA vinculación relacional FK en bunker_relacion_atributo_principal y cuyo término contenga espacios u homologaciones compuestas de catálogo
        const updateQuery = `
            UPDATE public.bunker_diccionario d
            SET categoria = 'general'
            WHERE LOWER(TRIM(d.categoria)) = 'articulo_principal'
              AND d.id NOT IN (
                  SELECT articulo_principal_id FROM public.bunker_relacion_atributo_principal WHERE articulo_principal_id IS NOT NULL
                  UNION
                  SELECT termino_id FROM public.bunker_relacion_atributo_principal WHERE termino_id IS NOT NULL
              )
              AND (
                  d.termino ILIKE '% % %' -- 3 o más palabras (nombres de catálogo legados)
               OR d.termino ILIKE 'PROD %'
               OR d.termino ILIKE '%/%'
               OR d.termino ILIKE 'ALMENDRA %'
               OR d.termino ILIKE 'Avellanas %'
               OR d.termino ILIKE 'Ciruela %'
              )
            RETURNING id, termino, categoria;
        `;
        const resUpdate = await client.query(updateQuery);

        await client.query('COMMIT');

        console.log(`🟢 SANEAMIENTO EXITOSO: Reclasificados ${resUpdate.rows.length} registros legados de 'articulo_principal' a 'general'.`);
        console.table(resUpdate.rows.slice(0, 25));

    } catch (err) {
        await client.query('ROLLBACK');
        console.error('Error durante el saneamiento:', err);
        process.exit(1);
    } finally {
        client.release();
        await pool.end();
    }
}

sanitizeUnlinkedDescriptions();
