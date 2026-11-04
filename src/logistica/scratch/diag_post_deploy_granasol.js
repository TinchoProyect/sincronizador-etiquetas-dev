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
        console.log('=== 🔍 DIAGNÓSTICO FORENSE EMPÍRICO: INCIDENTE "Grana sol" (v5.69) ===\n');

        // 1. Consultar public.bunker_diccionario para "Grana sol"
        const resDic = await pool.query(`
            SELECT id, termino, abreviatura, categoria, en_revision, obsoleto
            FROM public.bunker_diccionario
            WHERE LOWER(termino) LIKE '%grana%sol%' OR LOWER(termino) = 'grana sol';
        `);
        console.log('1. Registros en public.bunker_diccionario para "Grana sol":');
        console.table(resDic.rows);

        // 2. Consultar public.bunker_relacion_atributo_principal para "Grana sol" o término IDs de Grana sol
        const resRel = await pool.query(`
            SELECT id, familia_id, articulo_principal_id, articulo_principal_texto, 
                   termino_id, termino_texto, categoria, categoria_id
            FROM public.bunker_relacion_atributo_principal
            WHERE LOWER(termino_texto) LIKE '%grana%sol%' OR termino_id IN (SELECT id FROM public.bunker_diccionario WHERE LOWER(termino) LIKE '%grana%sol%')
            ORDER BY id DESC;
        `);
        console.log('\n2. Registros en public.bunker_relacion_atributo_principal para "Grana sol":');
        console.table(resRel.rows);

        // 3. Ejecutar la consulta SQL de obtenerJerarquiaPorPrincipal (Familia 42, Artículo 902)
        const sqlJerarquia = `
            SELECT 
                fc.id AS categoria_id,
                fc.categoria AS categoria_nombre,
                COALESCE(fc.orden_posicional, 99) AS orden_posicional,
                d.id AS termino_id,
                d.termino,
                d.abreviatura,
                d.en_revision,
                d.obsoleto
            FROM public.bunker_relacion_atributo_principal r
            JOIN public.bunker_diccionario d ON r.termino_id = d.id
            JOIN public.bunker_familia_categorias fc ON fc.id = r.categoria_id
            WHERE r.familia_id = 42
              AND r.articulo_principal_id = 902
            ORDER BY fc.orden_posicional ASC, d.termino ASC;
        `;
        const resJer = await pool.query(sqlJerarquia);
        console.log('\n3. Ejecución directa de obtenerJerarquiaPorPrincipal en PGSQL (Familia 42, Artículo 902):');
        console.table(resJer.rows);

    } catch (e) {
        console.error('Error en diagnóstico forense:', e);
    } finally {
        await pool.end();
    }
}

main();
