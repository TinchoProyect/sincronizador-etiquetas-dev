const { Pool } = require('pg');
require('dotenv').config();

const pool = new Pool({
    user: process.env.DB_USER || 'postgres',
    host: process.env.DB_HOST || 'localhost',
    database: process.env.DB_NAME || 'etiquetas',
    password: process.env.DB_PASSWORD || 'ta3Mionga',
    port: parseInt(process.env.DB_PORT || '5432')
});

async function diagDisparateQueries() {
    try {
        console.log('=== 🔬 DIAGNÓSTICO FORENSE: CONSULTAS DISPARES Y DIVERGENCIA DE DESCRIPCIONES ===\n');

        // 1. Consulta ejecutada en BÚSQUEDA / ALTA (buscarConsolidado)
        console.log('1. Resultado de buscarConsolidado (LEFT JOIN precios_articulos p):');
        const resAlta = await pool.query(`
            SELECT 
                s.articulo_numero as id, 
                s.codigo_barras, 
                s.descripcion as descripcion_stock_consolidado,
                p.descripcion as descripcion_precios_articulos,
                COALESCE(NULLIF(p.descripcion, ''), s.descripcion) as descripcion_resultante_en_alta
            FROM public.stock_real_consolidado s
            LEFT JOIN public.precios_articulos p ON p.articulo = s.articulo_numero
            WHERE s.articulo_numero = 'GSGN'
        `);
        console.table(resAlta.rows);

        // 2. Consulta ejecutada en REAPERTURA / EDICIÓN (obtenerArticulo)
        console.log('2. Resultado de obtenerArticulo (SIN JOIN a precios_articulos):');
        const resEdicion = await pool.query(`
            SELECT descripcion as descripcion_resultante_en_edicion, codigo_barras 
            FROM public.stock_real_consolidado 
            WHERE articulo_numero = 'GSGN'
        `);
        console.table(resEdicion.rows);

        // 3. Buscar diferencias globales en la base de datos entre stock_real_consolidado y precios_articulos
        console.log('3. Artículos globales con descripciones dispares entre stock_real_consolidado y precios_articulos:');
        const resDivergencias = await pool.query(`
            SELECT 
                s.articulo_numero,
                s.descripcion as desc_stock_consolidado,
                p.descripcion as desc_precios_articulos
            FROM public.stock_real_consolidado s
            JOIN public.precios_articulos p ON p.articulo = s.articulo_numero
            WHERE LOWER(TRIM(s.descripcion)) != LOWER(TRIM(p.descripcion))
            LIMIT 10;
        `);
        console.log(`   Se encontraron ${resDivergencias.rows.length} divergencias en la BD (mostrando primeras 10):`);
        console.table(resDivergencias.rows);

    } catch (e) {
        console.error('Error:', e);
    } finally {
        await pool.end();
    }
}

diagDisparateQueries();
