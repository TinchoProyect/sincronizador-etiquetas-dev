const { Pool } = require('pg');
require('dotenv').config();

const pool = new Pool({
    user: process.env.DB_USER || 'postgres',
    host: process.env.DB_HOST || 'localhost',
    database: process.env.DB_NAME || 'etiquetas',
    password: process.env.DB_PASSWORD || 'ta3Mionga',
    port: parseInt(process.env.DB_PORT || '5432')
});

function obtenerTextoBusquedaArticuloPropuesto(art) {
    if (!art) return '';

    const tokens = [];

    // 1. Identificadores y Nomenclador / Descripción Generada visible
    if (art.articulo_id) tokens.push(art.articulo_id);
    if (art.descripcion) tokens.push(art.descripcion);
    if (art.descripcion_generada && art.descripcion_generada !== art.descripcion) {
        tokens.push(art.descripcion_generada);
    }

    // 2. Nombre de la Familia
    const famNombre = art.familia_nombre || art.familia || art.nombre_familia || art.propiedades_dinamicas?.familia_nombre;
    if (famNombre) tokens.push(famNombre);

    // 3. Atributos descriptivos completos (palabras completas 'valor', omitiendo abreviaturas)
    if (art.propiedades_dinamicas && typeof art.propiedades_dinamicas === 'object') {
        const pd = art.propiedades_dinamicas;

        // Atributo Principal completo (ej. "Mix", "Almendra", "Zapallo")
        if (pd.articulo_principal) tokens.push(pd.articulo_principal);

        // Atributos de Posiciones (únicamente las palabras completas 'valor')
        const posObj = pd.posiciones || pd;
        if (posObj && typeof posObj === 'object') {
            Object.keys(posObj).forEach(key => {
                if (key.startsWith('asistente_') || key.startsWith('rendimiento_') || key.startsWith('tostadero_') || key.startsWith('_meta')) {
                    return;
                }
                const item = posObj[key];
                if (item && typeof item === 'object' && item.valor) {
                    tokens.push(item.valor);
                } else if (typeof item === 'string' && key !== 'articulo_principal' && key !== 'familia_nombre') {
                    tokens.push(item);
                }
            });
        }
    }

    // Normalización: minúsculas y sin acentos
    return tokens
        .filter(Boolean)
        .join(' ')
        .toLowerCase()
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "");
}

async function generateAuditTable() {
    const client = await pool.connect();
    try {
        const query = `
            SELECT 
                a.articulo_id,
                a.descripcion,
                a.descripcion_generada,
                a.propiedades_dinamicas,
                f.nombre as familia_nombre
            FROM public.bunker_articulos a
            LEFT JOIN public.bunker_familias f ON a.familia_id = f.id
            ORDER BY a.articulo_id DESC
            LIMIT 20;
        `;
        const res = await client.query(query);

        const rowsData = res.rows.map(art => {
            let props = art.propiedades_dinamicas;
            if (typeof props === 'string') {
                try { props = JSON.parse(props); } catch(e) {}
            }
            art.propiedades_dinamicas = props;

            const familia = art.familia_nombre || props?.familia_nombre || 'N/A';
            const principal = props?.articulo_principal || 'N/A';
            
            // Extraer palabras completas de posiciones
            const posValores = [];
            if (props?.posiciones && typeof props.posiciones === 'object') {
                Object.values(props.posiciones).forEach(v => {
                    if (v && v.valor) posValores.push(v.valor);
                });
            }
            const atributosCompletos = [principal, ...posValores].join(', ');
            const cadenaResultante = obtenerTextoBusquedaArticuloPropuesto(art);

            return {
                id: art.articulo_id,
                nomenclador: art.descripcion || art.descripcion_generada || 'S/D',
                familia: familia,
                atributos: atributosCompletos,
                cadena_busqueda: cadenaResultante
            };
        });

        console.log(JSON.stringify(rowsData, null, 2));

    } catch (err) {
        console.error('Error:', err);
    } finally {
        client.release();
        await pool.end();
    }
}

generateAuditTable();
