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
        console.log('=== 🔍 DRY-RUN AUDIT PREVIO A MIGRACIÓN DDL (v5.67-rev2) ===\n');

        // 1. Total de filas en bunker_relacion_atributo_principal
        const resTotal = await pool.query(`SELECT COUNT(*)::int as total FROM public.bunker_relacion_atributo_principal`);
        const totalRows = resTotal.rows[0].total;
        console.log(`1. Total de filas en bunker_relacion_atributo_principal: ${totalRows}`);

        // 2. Coincidencias exactas de JOIN por (familia_id, LOWER(TRIM(categoria)))
        const resExact = await pool.query(`
            SELECT COUNT(*)::int as vinculadas
            FROM public.bunker_relacion_atributo_principal r
            JOIN public.bunker_familia_categorias fc 
              ON fc.familia_id = r.familia_id 
             AND LOWER(TRIM(fc.categoria)) = LOWER(TRIM(r.categoria))
        `);
        const vinculadasExactas = resExact.rows[0].vinculadas;
        console.log(`2. Filas con coincidencia exacta en bunker_familia_categorias: ${vinculadasExactas}`);

        // 3. Filas de 'articulo_principal' (donde la categoría es el encabezado del principal)
        const resPrincipales = await pool.query(`
            SELECT COUNT(*)::int as principales
            FROM public.bunker_relacion_atributo_principal
            WHERE LOWER(TRIM(categoria)) = 'articulo_principal'
        `);
        const filasPrincipales = resPrincipales.rows[0].principales;
        console.log(`3. Filas correspondientes a 'articulo_principal' (Categoría Nivel 2): ${filasPrincipales}`);

        // 4. Filas huérfanas (sin coincidencia en bunker_familia_categorias y que NO son articulo_principal)
        const resHuerfanas = await pool.query(`
            SELECT r.id, r.familia_id, f.nombre as familia_nombre, r.articulo_principal_texto, 
                   r.termino_texto, r.categoria
            FROM public.bunker_relacion_atributo_principal r
            LEFT JOIN public.bunker_familias f ON f.id = r.familia_id
            LEFT JOIN public.bunker_familia_categorias fc 
              ON fc.familia_id = r.familia_id 
             AND LOWER(TRIM(fc.categoria)) = LOWER(TRIM(r.categoria))
            WHERE fc.id IS NULL 
              AND LOWER(TRIM(r.categoria)) != 'articulo_principal'
        `);
        console.log(`\n4. Filas Huérfanas Detectadas (Sin Plantilla Posicional en la Familia): ${resHuerfanas.rows.length}`);
        if (resHuerfanas.rows.length > 0) {
            console.table(resHuerfanas.rows);
        } else {
            console.log('   🟢 ¡CERO FILAS HUÉRFANAS DETECTADAS!');
        }

        // 5. Verificación de duplicados en bunker_familia_categorias
        const resDupFc = await pool.query(`
            SELECT familia_id, LOWER(TRIM(categoria)) as cat, COUNT(*)
            FROM public.bunker_familia_categorias
            GROUP BY familia_id, LOWER(TRIM(categoria))
            HAVING COUNT(*) > 1
        `);
        console.log(`\n5. Duplicados en bunker_familia_categorias por (familia_id, categoria): ${resDupFc.rows.length}`);
        if (resDupFc.rows.length > 0) {
            console.table(resDupFc.rows);
        } else {
            console.log('   🟢 ¡CERO DUPLICADOS EN PLANTILLAS DE FAMILIAS!');
        }

        console.log('\n=== 📊 RESUMEN FINAL DRY-RUN ===');
        console.log(`- Total Filas: ${totalRows}`);
        console.log(`- Categorías Nivel 3+ Vinculables a fc.id: ${vinculadasExactas}`);
        console.log(`- Atributos Principales Nivel 2 (categoria_id = NULL): ${filasPrincipales}`);
        console.log(`- Huérfanas Incompatibles: ${resHuerfanas.rows.length}`);
        console.log(`- Cobertura Total de Migración: ${((vinculadasExactas + filasPrincipales) / totalRows * 100).toFixed(2)}%`);

    } catch (e) {
        console.error('Error en Dry-Run Audit:', e);
    } finally {
        await pool.end();
    }
}

main();
