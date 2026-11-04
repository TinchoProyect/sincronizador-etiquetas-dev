const { Pool } = require('pg');
require('dotenv').config();

const pool = new Pool({
    user: process.env.DB_USER || 'postgres',
    host: process.env.DB_HOST || 'localhost',
    database: process.env.DB_NAME || 'etiquetas',
    password: process.env.DB_PASSWORD || 'ta3Mionga',
    port: parseInt(process.env.DB_PORT || '5432')
});

function obtenerTextoBusquedaArticuloRefactored(art) {
    if (!art) return '';

    let searchTokens = [];

    if (art.articulo_id) searchTokens.push(String(art.articulo_id));
    if (art.articulo_numero) searchTokens.push(String(art.articulo_numero));
    if (art.nombre) searchTokens.push(String(art.nombre));
    if (art.descripcion) searchTokens.push(String(art.descripcion));
    if (art.descripcion_generada) searchTokens.push(String(art.descripcion_generada));
    if (art.rubro) searchTokens.push(String(art.rubro));
    if (art.subrubro || art.sub_rubro) searchTokens.push(String(art.subrubro || art.sub_rubro));

    if (art.familia_nombre) searchTokens.push(String(art.familia_nombre));
    if (art.familia) searchTokens.push(String(art.familia));
    if (art.nombre_familia) searchTokens.push(String(art.nombre_familia));

    if (art.propiedades_dinamicas && typeof art.propiedades_dinamicas === 'object') {
        const pd = art.propiedades_dinamicas;

        if (pd.familia_nombre) searchTokens.push(String(pd.familia_nombre));
        if (pd.articulo_principal) searchTokens.push(String(pd.articulo_principal));
        if (pd.abreviatura_familia) searchTokens.push(String(pd.abreviatura_familia));
        if (pd.sufijo_wip) searchTokens.push(String(pd.sufijo_wip));

        const scanObj = (obj) => {
            if (!obj || typeof obj !== 'object') return;
            Object.keys(obj).forEach(key => {
                if (key.startsWith('asistente_') || key.startsWith('rendimiento_') || key.startsWith('tostadero_') || key.startsWith('_meta')) {
                    return;
                }
                const val = obj[key];
                if (val && typeof val === 'object') {
                    if (val.valor) searchTokens.push(String(val.valor));
                    if (val.abreviatura) searchTokens.push(String(val.abreviatura));
                    if (val.eje) searchTokens.push(String(val.eje));
                    if (val.nombre) searchTokens.push(String(val.nombre));
                    if (val.termino) searchTokens.push(String(val.termino));
                } else if (typeof val === 'string' || typeof val === 'number') {
                    searchTokens.push(String(val));
                }
            });
        };

        if (pd.posiciones && typeof pd.posiciones === 'object') {
            scanObj(pd.posiciones);
        }
        scanObj(pd);
    }

    const codigoLocal = art.metadatos_sistema?.codigo_barras_local || art.codigo_barras_local;
    if (codigoLocal) searchTokens.push(String(codigoLocal));

    return searchTokens
        .filter(Boolean)
        .join(' ')
        .toLowerCase()
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "");
}

async function diagnoseSearch() {
    const client = await pool.connect();
    try {
        console.log('=== 🧪 VERIFICACIÓN DEL NUEVO INDEXADOR DE BÚSQUEDA BÚNKER (v5.77) ===\n');

        const query = `
            SELECT 
                a.articulo_id,
                a.descripcion,
                a.descripcion_generada,
                a.rubro,
                a.sub_rubro,
                a.propiedades_dinamicas,
                f.nombre as familia_nombre
            FROM public.bunker_articulos a
            LEFT JOIN public.bunker_familias f ON a.familia_id = f.id
            ORDER BY a.articulo_id DESC
            LIMIT 15;
        `;
        const res = await client.query(query);

        res.rows.forEach((art, index) => {
            let props = art.propiedades_dinamicas;
            if (typeof props === 'string') {
                try { props = JSON.parse(props); } catch(e) {}
            }
            art.propiedades_dinamicas = props;

            const textIndexadoNUEVO = obtenerTextoBusquedaArticuloRefactored(art);
            const hasFamilia = art.familia_nombre ? textIndexadoNUEVO.includes(art.familia_nombre.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "")) : false;

            console.log(`--- [Artículo #${index + 1}] ID: ${art.articulo_id} ---`);
            console.log(`- Descripción: "${art.descripcion || art.descripcion_generada}"`);
            console.log(`- Familia Nombre (BD): "${art.familia_nombre || 'N/A'}"`);
            console.log(`- ¿Nombre de Familia Indexado?: ${hasFamilia ? '✅ SÍ (100% OK)' : '❌ NO'}`);
            console.log(`- Texto Indexado Resultante (NUEVO):\n  "${textIndexadoNUEVO}"\n`);
        });

    } catch (err) {
        console.error('Error en diagnóstico de búsqueda:', err);
    } finally {
        client.release();
        await pool.end();
    }
}

diagnoseSearch();
