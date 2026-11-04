const { Pool } = require('pg');
require('dotenv').config();

const pool = new Pool({
    user: process.env.DB_USER || 'postgres',
    host: process.env.DB_HOST || 'localhost',
    database: process.env.DB_NAME || 'etiquetas',
    password: process.env.DB_PASSWORD || 'ta3Mionga',
    port: parseInt(process.env.DB_PORT || '5432')
});

function obtenerTextoBusquedaBunker(art) {
    const tokens = [];
    if (art.descripcion_generada) tokens.push(art.descripcion_generada);
    if ((art.descripcion || art.description) && (art.descripcion || art.description) !== art.descripcion_generada) {
        tokens.push(art.descripcion || art.description);
    }
    const famNombre = art.familia_nombre || art.familia || art.nombre_familia || art.propiedades_dinamicas?.familia_nombre;
    if (famNombre) tokens.push(famNombre);

    if (art.propiedades_dinamicas) {
        let pd = art.propiedades_dinamicas;
        if (typeof pd === 'string') {
            try { pd = JSON.parse(pd); } catch(e) {}
        }
        if (pd && typeof pd === 'object') {
            if (pd.articulo_principal) tokens.push(pd.articulo_principal);
            const posObj = pd.posiciones || pd;
            if (posObj && typeof posObj === 'object') {
                Object.keys(posObj).forEach(key => {
                    if (key.startsWith('asistente_') || key.startsWith('rendimiento_') || key.startsWith('tostadero_') || key.startsWith('_meta')) return;
                    const item = posObj[key];
                    if (item && typeof item === 'object' && item.valor) tokens.push(item.valor);
                    else if (typeof item === 'string' && key !== 'articulo_principal' && key !== 'familia_nombre') tokens.push(item);
                });
            }
        }
    }
    return tokens.filter(Boolean).join(' ').toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
}

async function diagnosePasas() {
    const client = await pool.connect();
    try {
        console.log('=== 🔍 DIAGNÓSTICO EMPÍRICO: ARTÍCULOS CON "PASAS" EN BD ===\n');

        const query = `
            SELECT 
                a.articulo_id,
                a.descripcion,
                a.descripcion_generada,
                a.propiedades_dinamicas,
                f.nombre as familia_nombre
            FROM public.bunker_articulos a
            LEFT JOIN public.bunker_familias f ON a.familia_id = f.id
            WHERE a.descripcion ILIKE '%pasas%'
               OR a.descripcion_generada ILIKE '%pasas%'
               OR CAST(a.propiedades_dinamicas AS TEXT) ILIKE '%pasas%'
            ORDER BY a.articulo_id ASC;
        `;
        const res = await client.query(query);

        console.log(`1. Total de artículos en public.bunker_articulos con la palabra 'pasas': ${res.rows.length}\n`);

        res.rows.forEach((r, i) => {
            let pd = r.propiedades_dinamicas;
            if (typeof pd === 'string') { try { pd = JSON.parse(pd); } catch(e) {} }
            r.propiedades_dinamicas = pd;

            const textBunker = obtenerTextoBusquedaBunker(r);
            console.log(`--- [Artículo #${i + 1}] ID: ${r.articulo_id} ---`);
            console.log(`- Descripción Generada: "${r.descripcion_generada}"`);
            console.log(`- Atributo Principal: "${pd?.articulo_principal}"`);
            console.log(`- Posiciones:`, JSON.stringify(pd?.posiciones));
            console.log(`- Texto Indexado Búnker Resultante:\n  "${textBunker}"\n`);
        });

    } catch (err) {
        console.error('Error en diagnóstico:', err);
    } finally {
        client.release();
        await pool.end();
    }
}

diagnosePasas();
