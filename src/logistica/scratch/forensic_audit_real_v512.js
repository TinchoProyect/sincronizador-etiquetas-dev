const { Pool } = require('pg');
require('dotenv').config();

const pool = new Pool({
    user: process.env.DB_USER || 'postgres',
    host: process.env.DB_HOST || 'localhost',
    database: process.env.DB_NAME || 'etiquetas',
    password: process.env.DB_PASSWORD || 'ta3Mionga',
    port: parseInt(process.env.DB_PORT || '5432')
});

async function runRealAuditV512() {
    console.log('🔍 ====================================================================');
    console.log('🔍 AUDITORÍA REAL DE DATOS DE LA BASE DE DATOS (READ-ONLY v5.12)');
    console.log('🔍 ====================================================================\n');

    const client = await pool.connect();
    try {
        // 1. Obtener la taxonomía maestra activa por familia
        const taxRes = await client.query(`
            SELECT familia_id, categoria
            FROM public.bunker_familia_categorias
            ORDER BY familia_id, orden_posicional ASC
        `);

        const taxMasterByFam = {};
        taxRes.rows.forEach(r => {
            if (!taxMasterByFam[r.familia_id]) taxMasterByFam[r.familia_id] = [];
            taxMasterByFam[r.familia_id].push(r.categoria.toLowerCase());
        });

        const famRes = await client.query(`SELECT id, nombre FROM public.bunker_familias`);
        const famMap = {};
        famRes.rows.forEach(f => famMap[f.id] = f.nombre);

        // 2. Escanear todos los artículos en bunker_articulos
        const artRes = await client.query(`
            SELECT ctid, descripcion, familia_id, propiedades_dinamicas
            FROM public.bunker_articulos
            WHERE propiedades_dinamicas IS NOT NULL
        `);

        const systemKeysList = [
            'familia_id', 'familia_nombre', 'posiciones', 'articulo_principal', 'pos_1',
            'incluir_familia', 'posicion_familia', 'modo_display_familia', 'abreviatura_familia',
            'silencioso_principal', 'modo_display_principal', 'presentacion_variable_wip', 'sufijo_wip',
            'asistente_minutos', 'asistente_colaborador_id', 'codigo_barras_local', 'exencion_operativa', '_meta'
        ];

        let metadatosSistemaCount = 0;
        let metadatosDetalles = {};
        let datosBasuraObsolescentes = [];
        let datosAusentesFaltantes = [];

        artRes.rows.forEach(art => {
            const famId = art.familia_id;
            const masterCats = taxMasterByFam[famId] || [];
            const propsJSON = art.propiedades_dinamicas || {};

            // A. Clasificar Metadatos de Sistema
            Object.keys(propsJSON).forEach(k => {
                if (systemKeysList.includes(k)) {
                    metadatosSistemaCount++;
                    metadatosDetalles[k] = (metadatosDetalles[k] || 0) + 1;
                }
            });

            // B. Clasificar Datos Posicionales Presentes vs Basura Residual
            const presentCategoriesInArt = [];

            if (propsJSON.posiciones && typeof propsJSON.posiciones === 'object') {
                Object.values(propsJSON.posiciones).forEach(p => {
                    if (p && p.eje) {
                        const ejeStr = String(p.eje).trim();
                        const ejeLower = ejeStr.toLowerCase();
                        presentCategoriesInArt.push(ejeLower);

                        // Si la clave no pertenece a la plantilla de la familia ni como canonical ni como variant
                        const isMaster = masterCats.some(m => m === ejeLower || m.normalize("NFD").replace(/[\u0300-\u036f]/g, "") === ejeLower.normalize("NFD").replace(/[\u0300-\u036f]/g, ""));
                        if (!isMaster) {
                            datosBasuraObsolescentes.push({
                                ctid: art.ctid,
                                descripcion: art.descripcion || `CTID ${art.ctid}`,
                                familia_id: famId,
                                familia_nombre: famMap[famId] || `Familia ${famId}`,
                                clave_obsoleta: ejeStr,
                                valor_actual: p.valor || '(Vacio)'
                            });
                        }
                    }
                });
            }

            // C. Clasificar Datos Ausentes / Faltantes (Posiciones de la plantilla maestra que el artículo no tiene cargadas)
            masterCats.forEach(mCat => {
                const hasCategory = presentCategoriesInArt.some(pCat => pCat === mCat || pCat.normalize("NFD").replace(/[\u0300-\u036f]/g, "") === mCat.normalize("NFD").replace(/[\u0300-\u036f]/g, ""));
                if (!hasCategory) {
                    datosAusentesFaltantes.push({
                        ctid: art.ctid,
                        descripcion: art.descripcion || `CTID ${art.ctid}`,
                        familia_id: famId,
                        familia_nombre: famMap[famId] || `Familia ${famId}`,
                        categoria_faltante: mCat
                    });
                }
            });
        });

        console.log('--- 1. CONFIGURACIONES DE SISTEMA (METADATOS LEGÍTIMOS A IGNORAR) ---');
        console.log(`Total claves de sistema detectadas en JSONB: ${metadatosSistemaCount}`);
        console.log('Desglose por tipo de metadato:', metadatosDetalles);

        console.log('\n--- 2. DATOS LEGÍTIMAMENTE BASURA / RESIDUALES (OBSOLETOS A PURGAR) ---');
        console.log(`Total propiedades residuales obsoletas: ${datosBasuraObsolescentes.length}`);
        datosBasuraObsolescentes.forEach(d => {
            console.log(` * SKU: "${d.descripcion}" | Familia: ${d.familia_nombre} | Clave Obsoleta: "${d.clave_obsoleta}" | Valor: "${d.valor_actual}"`);
        });

        console.log('\n--- 3. DATOS AUSENTES O FALTANTES (POSICIONES MAESTRAS SIN ASIGNAR) ---');
        console.log(`Total posiciones faltantes según plantilla activa: ${datosAusentesFaltantes.length}`);
        datosAusentesFaltantes.slice(0, 10).forEach(d => {
            console.log(` * SKU: "${d.descripcion}" | Familia: ${d.familia_nombre} | Categoría Faltante: "${d.categoria_faltante}"`);
        });

    } catch (err) {
        console.error('❌ Error en auditoría real:', err);
    } finally {
        client.release();
        await pool.end();
    }
}

runRealAuditV512();
