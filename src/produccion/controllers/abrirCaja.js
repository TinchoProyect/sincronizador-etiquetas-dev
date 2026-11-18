/**
 * Controlador para la funcionalidad "Abrir Caja" (v5.1 - Exclusivo Búnker + Diccionario Completo + Herencia de Lote)
 * Permite desempacar cajas cerradas de Búnker a unidades Búnker con aprendizaje automático,
 * búsqueda por palabras completas del diccionario Búnker, herencia de lote del padre e impresión Zebra.
 *
 * @module controllers/abrirCaja
 */

const pool = require('../config/database');

let tablaAprendizajeInicializada = false;

/**
 * Asegura la existencia de public.abrir_caja_aprendizaje y migra de forma idempotente
 * el historial previo registrado en stock_ventas_movimientos (solo entre artículos Búnker).
 */
async function ensureTablaAprendizaje(db = pool) {
    if (tablaAprendizajeInicializada && db === pool) return;

    await db.query(`
        CREATE TABLE IF NOT EXISTS public.abrir_caja_aprendizaje (
            codigo_caja VARCHAR(80) NOT NULL,
            codigo_unidad VARCHAR(80) NOT NULL,
            unidades_por_caja INTEGER NOT NULL DEFAULT 1,
            veces_usado INTEGER NOT NULL DEFAULT 1,
            ultimo_usuario_id INTEGER,
            ultima_apertura TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            CONSTRAINT abrir_caja_aprendizaje_pkey PRIMARY KEY (codigo_caja, codigo_unidad)
        )
    `);

    await db.query(`
        INSERT INTO public.abrir_caja_aprendizaje (
            codigo_caja,
            codigo_unidad,
            unidades_por_caja,
            veces_usado,
            ultimo_usuario_id,
            ultima_apertura
        )
        SELECT
            BTRIM(svm.origen_ingreso) AS codigo_caja,
            BTRIM(svm.articulo_numero) AS codigo_unidad,
            GREATEST(
                1,
                COALESCE(
                    MODE() WITHIN GROUP (ORDER BY GREATEST(1, ROUND(svm.cantidad)::int)),
                    ROUND(AVG(svm.cantidad))::int,
                    1
                )
            ) AS unidades_por_caja,
            COUNT(*)::int AS veces_usado,
            (ARRAY_AGG(svm.usuario_id ORDER BY svm.fecha DESC))[1] AS ultimo_usuario_id,
            MAX(svm.fecha) AS ultima_apertura
        FROM public.stock_ventas_movimientos svm
        INNER JOIN public.bunker_articulos ba_caja ON BTRIM(ba_caja.articulo_id) = BTRIM(svm.origen_ingreso)
        INNER JOIN public.bunker_articulos ba_unid ON BTRIM(ba_unid.articulo_id) = BTRIM(svm.articulo_numero)
        WHERE svm.tipo = 'apertura_caja_entrada'
          AND svm.origen_ingreso IS NOT NULL
          AND BTRIM(svm.origen_ingreso) <> ''
          AND BTRIM(svm.origen_ingreso) <> BTRIM(svm.articulo_numero)
        GROUP BY BTRIM(svm.origen_ingreso), BTRIM(svm.articulo_numero)
        ON CONFLICT (codigo_caja, codigo_unidad) DO NOTHING
    `);

    if (db === pool) {
        tablaAprendizajeInicializada = true;
    }
}

/**
 * Deduce unidades por caja y peso hijo sugerido exclusivamente desde la anatomía Búnker
 * (pack_unidades, descripcion_generada y kilos_unidad).
 */
function deducirFormatoCajaServidor(art) {
    if (!art) return { unidades_sugeridas: null, peso_hijo: null, unidad_peso: null, fuente: null };

    const packUnid = parseInt(art.pack_unidades, 10) || 0;
    const textos = [
        art.descripcion_generada,
        art.descripcion
    ].filter(Boolean);

    const regexNxM = /\b(\d{1,3})\s*[xX]\s*(\d+(?:[.,]\d+)?)\s*(kg|kilos?|k|g|gr|gramos?|un|u)?\b/i;
    for (const txt of textos) {
        const m = String(txt).match(regexNxM);
        if (m) {
            const mult = parseInt(m[1], 10);
            const peso = parseFloat(String(m[2]).replace(',', '.'));
            const uPeso = (m[3] || '').toLowerCase();
            if (mult >= 2 && mult <= 200) {
                return {
                    unidades_sugeridas: packUnid > 1 ? packUnid : mult,
                    peso_hijo: peso > 0 ? peso : null,
                    unidad_peso: uPeso.startsWith('g') ? 'g' : (uPeso.startsWith('k') || peso <= 25 ? 'kg' : null),
                    fuente: packUnid > 1 ? 'pack_unidades' : 'descripcion_bunker'
                };
            }
        }
    }

    if (packUnid > 1) {
        return { unidades_sugeridas: packUnid, peso_hijo: null, unidad_peso: null, fuente: 'pack_unidades' };
    }

    return { unidades_sugeridas: null, peso_hijo: null, unidad_peso: null, fuente: null };
}

/**
 * Obtiene el catálogo EXCLUSIVO de public.bunker_articulos con todas sus propiedades_dinamicas
 * (palabras completas del diccionario Búnker), códigos de barras, lotes activos y vínculos aprendidos.
 * GET /api/produccion/abrir-caja/catalogo
 */
async function obtenerCatalogoAbrirCaja(req, res) {
    try {
        await ensureTablaAprendizaje();

        const catalogoQuery = `
            SELECT DISTINCT ON (BTRIM(ba.articulo_id))
                BTRIM(ba.articulo_id) AS articulo_numero,
                BTRIM(ba.articulo_id) AS articulo_id,
                COALESCE(
                    NULLIF(BTRIM(ba.descripcion_generada), ''),
                    NULLIF(BTRIM(ba.descripcion), ''),
                    BTRIM(ba.articulo_id)
                ) AS descripcion,
                ba.descripcion_generada,
                ba.descripcion AS descripcion_corta,
                COALESCE(
                    NULLIF(BTRIM(ba.codigo_barras), ''),
                    NULLIF(BTRIM(ba.propiedades_dinamicas->>'codigo_barras_local'), ''),
                    NULLIF(BTRIM(a.codigo_barras), ''),
                    NULLIF(BTRIM(src.codigo_barras), '')
                ) AS codigo_barras,
                ba.propiedades_dinamicas->>'codigo_barras_local' AS codigo_barras_local,
                ROUND(CAST(COALESCE(src.stock_consolidado, 0) AS NUMERIC), 2) AS stock_actual,
                COALESCE(NULLIF(ba.kilos_unidad, 0), NULLIF(src.kilos_unidad, 0), 0) AS kilos_unidad,
                COALESCE(ba.es_pack, src.es_pack, false) AS es_pack,
                COALESCE(NULLIF(BTRIM(ba.pack_hijo_codigo), ''), NULLIF(BTRIM(src.pack_hijo_codigo), '')) AS pack_hijo_codigo,
                COALESCE(NULLIF(ba.pack_unidades, 0), NULLIF(src.pack_unidades, 0), 0) AS pack_unidades,
                ba.familia_id,
                COALESCE(bf.nombre, ba.propiedades_dinamicas->>'familia_nombre') AS familia_nombre,
                ba.rubro,
                ba.sub_rubro,
                ba.propiedades_dinamicas,
                lote_activo.lote_codigo_corto AS lote_padre_activo,
                lote_activo.proveedor_nombre AS lote_padre_proveedor
            FROM public.bunker_articulos ba
            LEFT JOIN public.bunker_familias bf ON bf.id = ba.familia_id
            LEFT JOIN public.stock_real_consolidado src ON BTRIM(src.articulo_numero) = BTRIM(ba.articulo_id)
            LEFT JOIN public.articulos a ON BTRIM(a.numero) = BTRIM(ba.articulo_id)
            LEFT JOIN LATERAL (
                SELECT
                    v.lote_codigo_corto,
                    v.proveedor_nombre
                FROM public.bunker_lotes_destinos d
                JOIN public.bunker_lotes_vinculos v ON d.vinculo_id = v.id
                WHERE (d.tipo_destino = 'ARTICULO_BUNKER' OR d.tipo_destino = 'BUNKER')
                  AND BTRIM(d.destino_id) = BTRIM(ba.articulo_id)
                  AND v.lote_codigo_corto IS NOT NULL
                  AND BTRIM(v.lote_codigo_corto) <> ''
                ORDER BY
                    CASE WHEN (d.cantidad_asignada - COALESCE(d.cantidad_abierta, 0)) > 0 THEN 0 ELSE 1 END ASC,
                    CASE WHEN (d.cantidad_asignada - COALESCE(d.cantidad_abierta, 0)) > 0 THEN v.fecha_vinculacion END ASC,
                    v.fecha_vinculacion DESC
                LIMIT 1
            ) lote_activo ON true
            WHERE ba.articulo_id IS NOT NULL
              AND BTRIM(ba.articulo_id) <> ''
            ORDER BY BTRIM(ba.articulo_id)
        `;

        const aprendizajeQuery = `
            SELECT
                apr.codigo_caja,
                apr.codigo_unidad,
                apr.unidades_por_caja,
                apr.veces_usado,
                apr.ultimo_usuario_id,
                apr.ultima_apertura
            FROM public.abrir_caja_aprendizaje apr
            INNER JOIN public.bunker_articulos ba_caja ON BTRIM(ba_caja.articulo_id) = BTRIM(apr.codigo_caja)
            INNER JOIN public.bunker_articulos ba_unid ON BTRIM(ba_unid.articulo_id) = BTRIM(apr.codigo_unidad)
            ORDER BY apr.ultima_apertura DESC, apr.veces_usado DESC
        `;

        const [catResult, aprResult] = await Promise.all([
            pool.query(catalogoQuery),
            pool.query(aprendizajeQuery)
        ]);

        const articulos = catResult.rows.sort((x, y) =>
            String(x.descripcion || '').localeCompare(String(y.descripcion || ''), 'es', { sensitivity: 'base' })
        );
        const aprendizajes = aprResult.rows;

        // Acceso rápido a las últimas cajas Búnker aprendidas que hoy tienen stock >= 1
        const mapaArticulos = new Map();
        for (const art of articulos) {
            mapaArticulos.set(art.articulo_numero, art);
        }

        const cajasVistas = new Set();
        const ultimasCajasConStock = [];
        for (const apr of aprendizajes) {
            if (cajasVistas.has(apr.codigo_caja)) continue;
            const cajaArt = mapaArticulos.get(apr.codigo_caja);
            const unidArt = mapaArticulos.get(apr.codigo_unidad);
            if (!cajaArt || !unidArt) continue;
            if (parseFloat(cajaArt.stock_actual || 0) < 1) continue;

            cajasVistas.add(apr.codigo_caja);
            ultimasCajasConStock.push({
                codigo_caja: apr.codigo_caja,
                descripcion_caja: cajaArt.descripcion,
                stock_caja: cajaArt.stock_actual,
                lote_padre_activo: cajaArt.lote_padre_activo || null,
                codigo_unidad: apr.codigo_unidad,
                descripcion_unidad: unidArt.descripcion,
                unidades_por_caja: apr.unidades_por_caja,
                veces_usado: apr.veces_usado,
                ultima_apertura: apr.ultima_apertura
            });

            if (ultimasCajasConStock.length >= 6) break;
        }

        res.json({
            success: true,
            articulos,
            aprendizajes,
            ultimas_cajas_con_stock: ultimasCajasConStock
        });
    } catch (error) {
        console.error('❌ [ABRIR-CAJA] Error al obtener catálogo Búnker:', error);
        res.status(500).json({
            success: false,
            error: 'Error al obtener catálogo Búnker de Abrir Caja',
            detalle: error.message
        });
    }
}

/**
 * Obtener aprendizaje directo para una caja puntual de Búnker
 * GET /api/produccion/abrir-caja/aprendizaje?codigo_caja=XXX
 */
async function obtenerAprendizajeCaja(req, res) {
    try {
        await ensureTablaAprendizaje();
        const { codigo_caja } = req.query;

        if (!codigo_caja) {
            return res.status(400).json({ success: false, error: 'Se requiere codigo_caja' });
        }

        const aprRes = await pool.query(`
            SELECT
                apr.codigo_caja,
                apr.codigo_unidad,
                apr.unidades_por_caja,
                apr.veces_usado,
                apr.ultimo_usuario_id,
                apr.ultima_apertura,
                COALESCE(ba.descripcion_generada, ba.descripcion, apr.codigo_unidad) AS descripcion_unidad,
                COALESCE(NULLIF(BTRIM(ba.codigo_barras), ''), NULLIF(BTRIM(ba.propiedades_dinamicas->>'codigo_barras_local'), ''), NULLIF(BTRIM(a.codigo_barras), ''), NULLIF(BTRIM(src.codigo_barras), '')) AS codigo_barras_unidad,
                ROUND(CAST(COALESCE(src.stock_consolidado, 0) AS NUMERIC), 2) AS stock_unidad,
                COALESCE(NULLIF(ba.kilos_unidad, 0), NULLIF(src.kilos_unidad, 0), 0) AS kilos_unidad
            FROM public.abrir_caja_aprendizaje apr
            INNER JOIN public.bunker_articulos ba ON BTRIM(ba.articulo_id) = BTRIM(apr.codigo_unidad)
            LEFT JOIN public.articulos a ON BTRIM(a.numero) = BTRIM(ba.articulo_id)
            LEFT JOIN public.stock_real_consolidado src ON BTRIM(src.articulo_numero) = BTRIM(ba.articulo_id)
            WHERE BTRIM(apr.codigo_caja) = BTRIM($1)
            ORDER BY apr.ultima_apertura DESC, apr.veces_usado DESC
            LIMIT 5
        `, [codigo_caja.trim()]);

        const cajaRes = await pool.query(`
            SELECT
                ba.articulo_id AS articulo_numero,
                COALESCE(ba.descripcion_generada, ba.descripcion) AS descripcion,
                ba.descripcion_generada,
                COALESCE(NULLIF(ba.pack_unidades, 0), NULLIF(src.pack_unidades, 0), 0) AS pack_unidades,
                COALESCE(NULLIF(BTRIM(ba.pack_hijo_codigo), ''), NULLIF(BTRIM(src.pack_hijo_codigo), '')) AS pack_hijo_codigo
            FROM public.bunker_articulos ba
            LEFT JOIN public.stock_real_consolidado src ON BTRIM(src.articulo_numero) = BTRIM(ba.articulo_id)
            WHERE BTRIM(ba.articulo_id) = BTRIM($1)
            LIMIT 1
        `, [codigo_caja.trim()]);

        const deduccion = deducirFormatoCajaServidor(cajaRes.rows[0] || { articulo_numero: codigo_caja });

        res.json({
            success: true,
            aprendizajes: aprRes.rows,
            deduccion
        });
    } catch (error) {
        console.error('❌ [ABRIR-CAJA] Error al consultar aprendizaje de caja:', error);
        res.status(500).json({ success: false, error: error.message });
    }
}

/**
 * Obtener sugerencias inteligentes de cajas Búnker basadas en aprendizaje (modo contextual Unidad -> Caja)
 */
async function obtenerSugerenciasCajas(req, res) {
    try {
        await ensureTablaAprendizaje();
        const { articulo_unidad } = req.query;

        if (!articulo_unidad) {
            return res.status(400).json({
                error: 'Se requiere el código del artículo unidad'
            });
        }

        const query = `
            SELECT
                apr.codigo_caja,
                COALESCE(ba.descripcion_generada, ba.descripcion, apr.codigo_caja) AS descripcion_caja,
                COALESCE(NULLIF(BTRIM(ba.codigo_barras), ''), NULLIF(BTRIM(ba.propiedades_dinamicas->>'codigo_barras_local'), ''), NULLIF(BTRIM(a.codigo_barras), ''), NULLIF(BTRIM(src.codigo_barras), '')) AS codigo_barras,
                ROUND(CAST(COALESCE(src.stock_consolidado, 0) AS NUMERIC), 2) AS stock_actual,
                COALESCE(apr.unidades_por_caja, NULLIF(ba.pack_unidades, 0), NULLIF(src.pack_unidades, 0), 1) AS pack_unidades,
                apr.unidades_por_caja,
                apr.ultima_apertura,
                apr.veces_usado
            FROM public.abrir_caja_aprendizaje apr
            INNER JOIN public.bunker_articulos ba ON BTRIM(ba.articulo_id) = BTRIM(apr.codigo_caja)
            LEFT JOIN public.stock_real_consolidado src ON BTRIM(src.articulo_numero) = BTRIM(ba.articulo_id)
            LEFT JOIN public.articulos a ON BTRIM(a.numero) = BTRIM(ba.articulo_id)
            WHERE BTRIM(apr.codigo_unidad) = BTRIM($1)
              AND ROUND(CAST(COALESCE(src.stock_consolidado, 0) AS NUMERIC), 2) >= 1.00
            ORDER BY apr.ultima_apertura DESC, apr.veces_usado DESC
            LIMIT 5
        `;

        const result = await pool.query(query, [articulo_unidad]);

        res.json({
            success: true,
            sugerencias: result.rows
        });
    } catch (error) {
        console.error('❌ [ABRIR-CAJA] Error al obtener sugerencias:', error);
        res.status(500).json({
            error: 'Error al obtener sugerencias de cajas',
            detalle: error.message
        });
    }
}

/**
 * Buscar cajas exclusivamente en public.bunker_articulos (código de barras o palabras completas diccionario Búnker)
 */
async function buscarCajas(req, res) {
    try {
        const { codigo_barras, descripcion } = req.query;

        if (!codigo_barras && !descripcion) {
            return res.status(400).json({
                error: 'Se requiere código de barras o descripción para buscar'
            });
        }

        let query;
        let params;

        if (codigo_barras) {
            const cod = codigo_barras.trim();
            query = `
                SELECT
                    ba.articulo_id AS articulo_numero,
                    COALESCE(ba.descripcion_generada, ba.descripcion, ba.articulo_id) AS descripcion,
                    COALESCE(NULLIF(BTRIM(ba.codigo_barras), ''), NULLIF(BTRIM(ba.propiedades_dinamicas->>'codigo_barras_local'), ''), NULLIF(BTRIM(a.codigo_barras), ''), NULLIF(BTRIM(src.codigo_barras), '')) AS codigo_barras,
                    ROUND(CAST(COALESCE(src.stock_consolidado, 0) AS NUMERIC), 2) AS stock_actual,
                    COALESCE(NULLIF(ba.pack_unidades, 0), NULLIF(src.pack_unidades, 0), 0) AS pack_unidades
                FROM public.bunker_articulos ba
                LEFT JOIN public.stock_real_consolidado src ON BTRIM(src.articulo_numero) = BTRIM(ba.articulo_id)
                LEFT JOIN public.articulos a ON BTRIM(a.numero) = BTRIM(ba.articulo_id)
                WHERE (
                    ba.codigo_barras = $1
                    OR ba.propiedades_dinamicas->>'codigo_barras_local' = $1
                    OR a.codigo_barras = $1
                    OR src.codigo_barras = $1
                    OR UPPER(BTRIM(ba.articulo_id)) = UPPER($1)
                )
                  AND ROUND(CAST(COALESCE(src.stock_consolidado, 0) AS NUMERIC), 2) >= 1.00
                LIMIT 5
            `;
            params = [cod];
        } else {
            const palabras = descripcion.trim().split(/\s+/).filter(p => p.length > 0);
            const condiciones = palabras.map((_, idx) => {
                const pIdx = idx + 1;
                return `(
                    COALESCE(ba.descripcion_generada, ba.descripcion, '') ILIKE $${pIdx}
                    OR COALESCE(bf.nombre, '') ILIKE $${pIdx}
                    OR COALESCE(ba.propiedades_dinamicas::text, '') ILIKE $${pIdx}
                    OR REPLACE(COALESCE(ba.descripcion_generada, ''), ' ', '') ILIKE $${pIdx}
                )`;
            }).join(' AND ');
            const valores = palabras.map(p => `%${p}%`);

            query = `
                SELECT
                    ba.articulo_id AS articulo_numero,
                    COALESCE(ba.descripcion_generada, ba.descripcion, ba.articulo_id) AS descripcion,
                    COALESCE(NULLIF(BTRIM(ba.codigo_barras), ''), NULLIF(BTRIM(ba.propiedades_dinamicas->>'codigo_barras_local'), ''), NULLIF(BTRIM(a.codigo_barras), ''), NULLIF(BTRIM(src.codigo_barras), '')) AS codigo_barras,
                    ROUND(CAST(COALESCE(src.stock_consolidado, 0) AS NUMERIC), 2) AS stock_actual,
                    COALESCE(NULLIF(ba.pack_unidades, 0), NULLIF(src.pack_unidades, 0), 0) AS pack_unidades
                FROM public.bunker_articulos ba
                LEFT JOIN public.bunker_familias bf ON bf.id = ba.familia_id
                LEFT JOIN public.stock_real_consolidado src ON BTRIM(src.articulo_numero) = BTRIM(ba.articulo_id)
                LEFT JOIN public.articulos a ON BTRIM(a.numero) = BTRIM(ba.articulo_id)
                WHERE ${condiciones}
                  AND ROUND(CAST(COALESCE(src.stock_consolidado, 0) AS NUMERIC), 2) >= 1.00
                ORDER BY descripcion
                LIMIT 30
            `;
            params = valores;
        }

        const result = await pool.query(query, params);

        res.json({
            success: true,
            resultados: result.rows
        });
    } catch (error) {
        console.error('❌ [ABRIR-CAJA] Error al buscar cajas Búnker:', error);
        res.status(500).json({
            error: 'Error al buscar cajas',
            detalle: error.message
        });
    }
}

/**
 * Obtener lote heredado de la caja padre (FIFO cerrado primero, luego último lote vinculado al padre)
 * o generar lote canónico solo si el padre no posee lote asignado.
 * GET /api/produccion/abrir-caja/lote-sugerido?codigo_caja=XXX&forzar_nuevo=0|1
 */
async function obtenerLoteSugerido(req, res) {
    try {
        const { codigo_caja, forzar_nuevo } = req.query;
        const forzarNuevo = String(forzar_nuevo || '0') === '1';
        let loteSugerido = null;
        let proveedor = null;
        let origen = 'generado';

        // 1. Si no se fuerza lote nuevo y se proporciona código de caja padre, heredar su lote de trazabilidad
        if (!forzarNuevo && codigo_caja) {
            const query = `
                SELECT
                    v.lote_codigo_corto,
                    v.lote_id_supabase,
                    v.proveedor_nombre,
                    (d.cantidad_asignada - COALESCE(d.cantidad_abierta, 0)) AS cajas_cerradas_lote
                FROM public.bunker_lotes_destinos d
                JOIN public.bunker_lotes_vinculos v ON d.vinculo_id = v.id
                WHERE (d.tipo_destino = 'ARTICULO_BUNKER' OR d.tipo_destino = 'BUNKER')
                  AND BTRIM(d.destino_id) = BTRIM($1)
                  AND v.lote_codigo_corto IS NOT NULL
                  AND BTRIM(v.lote_codigo_corto) <> ''
                ORDER BY
                    CASE WHEN (d.cantidad_asignada - COALESCE(d.cantidad_abierta, 0)) > 0 THEN 0 ELSE 1 END ASC,
                    CASE WHEN (d.cantidad_asignada - COALESCE(d.cantidad_abierta, 0)) > 0 THEN v.fecha_vinculacion END ASC,
                    v.fecha_vinculacion DESC
                LIMIT 1
            `;
            const result = await pool.query(query, [codigo_caja.trim()]);
            if (result.rows.length > 0 && result.rows[0].lote_codigo_corto) {
                loteSugerido = result.rows[0].lote_codigo_corto.trim();
                proveedor = result.rows[0].proveedor_nombre || null;
                origen = 'lote_caja';
            }
        }

        // 2. Solo si la caja padre no tiene ningún lote vinculado (o se forzó nuevo), generar alias L + 7 caracteres
        if (!loteSugerido) {
            const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
            let alias = 'L';
            for (let i = 0; i < 7; i++) {
                alias += chars.charAt(Math.floor(Math.random() * chars.length));
            }
            loteSugerido = alias;
            origen = 'generado';
        }

        res.json({
            success: true,
            lote: loteSugerido,
            proveedor,
            origen
        });
    } catch (error) {
        console.error('❌ [ABRIR-CAJA] Error al sugerir lote:', error);
        res.status(500).json({ success: false, error: error.message });
    }
}

/**
 * Registrar apertura de caja Búnker (transacción atómica con herencia de lote, multi-caja y aprendizaje)
 */
async function registrarAperturaCaja(req, res) {
    await ensureTablaAprendizaje();
    const client = await pool.connect();

    try {
        const {
            codigo_caja,
            codigo_unidad,
            cantidad_unidades,
            unidades_por_caja,
            cantidad_cajas,
            usuario_id,
            kilos_caja,
            kilos_unidad,
            lote
        } = req.body;

        const cantCajas = Math.max(1, parseInt(cantidad_cajas, 10) || 1);
        const unidPorCaja = parseInt(unidades_por_caja, 10) > 0
            ? parseInt(unidades_por_caja, 10)
            : (cantCajas === 1 ? (parseInt(cantidad_unidades, 10) || 0) : Math.floor((parseInt(cantidad_unidades, 10) || 0) / cantCajas));
        const totalUnidades = parseInt(cantidad_unidades, 10) > 0 && !unidades_por_caja
            ? parseInt(cantidad_unidades, 10)
            : (cantCajas * unidPorCaja);

        if (!codigo_caja || !codigo_unidad || totalUnidades < 1 || unidPorCaja < 1 || !usuario_id) {
            return res.status(400).json({
                error: 'Faltan datos requeridos para abrir la caja',
                requeridos: ['codigo_caja', 'codigo_unidad', 'unidades_por_caja', 'usuario_id']
            });
        }

        if (String(codigo_caja).trim().toUpperCase() === String(codigo_unidad).trim().toUpperCase()) {
            return res.status(400).json({
                error: 'Artículo inválido',
                detalle: 'La caja de origen y la fracción destino no pueden ser el mismo artículo.'
            });
        }

        console.log(`\n🔓 [ABRIR-CAJA] ===== INICIANDO APERTURA BÚNKER =====`);
        console.log(`📦 Caja Padre: ${codigo_caja} (x${cantCajas} caja/s)`);
        console.log(`🎯 Fracción Hija: ${codigo_unidad} (${unidPorCaja} un/caja => +${totalUnidades} un.)`);
        console.log(`👤 Usuario: ${usuario_id} | 🏷️ Lote Heredado/Asignado: ${lote || 'Sin lote'}`);

        await client.query('BEGIN');

        // Validar pertenencia a Búnker de ambos artículos
        const bunkerCheck = await client.query(`
            SELECT articulo_id, descripcion_generada, kilos_unidad
            FROM public.bunker_articulos
            WHERE BTRIM(articulo_id) = ANY($1)
        `, [[String(codigo_caja).trim(), String(codigo_unidad).trim()]]);

        const mapaBunker = new Map();
        for (const r of bunkerCheck.rows) {
            mapaBunker.set(String(r.articulo_id).trim(), r);
        }

        if (!mapaBunker.has(String(codigo_caja).trim())) {
            throw new Error(`La caja ${codigo_caja} no pertenece al catálogo activo de Búnker.`);
        }
        if (!mapaBunker.has(String(codigo_unidad).trim())) {
            throw new Error(`El artículo destino ${codigo_unidad} no pertenece al catálogo activo de Búnker.`);
        }

        // 1. Verificar stock de la caja con bloqueo FOR UPDATE
        const stockCajaResult = await client.query(`
            SELECT
                articulo_numero,
                descripcion,
                stock_consolidado
            FROM public.stock_real_consolidado
            WHERE BTRIM(articulo_numero) = BTRIM($1)
            FOR UPDATE
        `, [codigo_caja]);

        if (stockCajaResult.rows.length === 0) {
            throw new Error(`La caja ${codigo_caja} no posee registro de stock consolidado`);
        }

        const stockCaja = parseFloat(stockCajaResult.rows[0].stock_consolidado) || 0;
        if (stockCaja < cantCajas) {
            throw new Error(`Stock insuficiente de caja ${codigo_caja}. Disponible: ${stockCaja.toFixed(2)}, solicitado abrir: ${cantCajas}`);
        }

        const kilosCajaFinal = parseFloat(kilos_caja) > 0
            ? parseFloat(kilos_caja)
            : (parseFloat(mapaBunker.get(String(codigo_caja).trim())?.kilos_unidad) || 0);
        const kilosUnidadFinal = parseFloat(kilos_unidad) > 0
            ? parseFloat(kilos_unidad)
            : (parseFloat(mapaBunker.get(String(codigo_unidad).trim())?.kilos_unidad) || 0);

        const obsEntrada = cantCajas > 1
            ? `Apertura de ${cantCajas} cajas ${codigo_caja} (${unidPorCaja} un/caja)${lote ? ' - Lote: ' + lote : ''}`
            : `Apertura de caja ${codigo_caja}${lote ? ' - Lote: ' + lote : ''}`;

        const obsSalida = cantCajas > 1
            ? `Desempacadas ${cantCajas} cajas (${unidPorCaja} un/caja = ${totalUnidades} un.) de ${codigo_unidad}${lote ? ' - Lote: ' + lote : ''}`
            : `Desempacada en ${totalUnidades} un. de ${codigo_unidad}${lote ? ' - Lote: ' + lote : ''}`;

        // 2. Registrar ENTRADA de fracciones (tipo='apertura_caja_entrada') con trazabilidad de lote
        const entradaResult = await client.query(`
            INSERT INTO public.stock_ventas_movimientos (
                articulo_numero,
                codigo_barras,
                kilos,
                cantidad,
                tipo,
                origen_ingreso,
                usuario_id,
                fecha,
                carro_id,
                observaciones
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, NOW(), NULL, $8)
            RETURNING id
        `, [
            String(codigo_unidad).trim(),
            null,
            kilosUnidadFinal,
            totalUnidades,
            'apertura_caja_entrada',
            String(codigo_caja).trim(),
            usuario_id,
            obsEntrada
        ]);
        const movimientoEntradaId = entradaResult.rows[0].id;

        // 3. Registrar SALIDA de cajas padre (tipo='apertura_caja_salida')
        const salidaResult = await client.query(`
            INSERT INTO public.stock_ventas_movimientos (
                articulo_numero,
                codigo_barras,
                kilos,
                cantidad,
                tipo,
                origen_ingreso,
                usuario_id,
                fecha,
                carro_id,
                observaciones
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, NOW(), NULL, $8)
            RETURNING id
        `, [
            String(codigo_caja).trim(),
            null,
            kilosCajaFinal,
            -cantCajas,
            'apertura_caja_salida',
            String(codigo_unidad).trim(),
            usuario_id,
            obsSalida
        ]);
        const movimientoSalidaId = salidaResult.rows[0].id;

        // 4. Actualizar bunker_lotes_destinos de la caja padre (primero lote heredado, luego FIFO)
        try {
            await client.query('SAVEPOINT sp_lote');
            let cajasRestantesLote = cantCajas;

            if (lote && cajasRestantesLote > 0) {
                const lotesCoincidentes = await client.query(`
                    SELECT d.id, (d.cantidad_asignada - COALESCE(d.cantidad_abierta, 0)) AS disponibles
                    FROM public.bunker_lotes_destinos d
                    JOIN public.bunker_lotes_vinculos v ON d.vinculo_id = v.id
                    WHERE (d.tipo_destino = 'ARTICULO_BUNKER' OR d.tipo_destino = 'BUNKER')
                      AND BTRIM(d.destino_id) = BTRIM($1)
                      AND (v.lote_codigo_corto = $2 OR v.lote_id_supabase = $2)
                      AND (d.cantidad_asignada - COALESCE(d.cantidad_abierta, 0)) > 0
                    ORDER BY v.fecha_vinculacion ASC
                    FOR UPDATE OF d
                `, [codigo_caja, lote]);

                for (const row of lotesCoincidentes.rows) {
                    if (cajasRestantesLote <= 0) break;
                    const consumir = Math.min(cajasRestantesLote, parseFloat(row.disponibles) || 0);
                    if (consumir > 0) {
                        await client.query(`
                            UPDATE public.bunker_lotes_destinos
                            SET cantidad_abierta = COALESCE(cantidad_abierta, 0) + $1
                            WHERE id = $2
                        `, [consumir, row.id]);
                        cajasRestantesLote -= consumir;
                    }
                }
            }

            if (cajasRestantesLote > 0) {
                const lotesFifo = await client.query(`
                    SELECT d.id, (d.cantidad_asignada - COALESCE(d.cantidad_abierta, 0)) AS disponibles
                    FROM public.bunker_lotes_destinos d
                    JOIN public.bunker_lotes_vinculos v ON d.vinculo_id = v.id
                    WHERE (d.tipo_destino = 'ARTICULO_BUNKER' OR d.tipo_destino = 'BUNKER')
                      AND BTRIM(d.destino_id) = BTRIM($1)
                      AND (d.cantidad_asignada - COALESCE(d.cantidad_abierta, 0)) > 0
                    ORDER BY v.fecha_vinculacion ASC
                    FOR UPDATE OF d
                `, [codigo_caja]);

                for (const row of lotesFifo.rows) {
                    if (cajasRestantesLote <= 0) break;
                    const consumir = Math.min(cajasRestantesLote, parseFloat(row.disponibles) || 0);
                    if (consumir > 0) {
                        await client.query(`
                            UPDATE public.bunker_lotes_destinos
                            SET cantidad_abierta = COALESCE(cantidad_abierta, 0) + $1
                            WHERE id = $2
                        `, [consumir, row.id]);
                        cajasRestantesLote -= consumir;
                    }
                }
            }

            await client.query('RELEASE SAVEPOINT sp_lote');
        } catch (loteErr) {
            await client.query('ROLLBACK TO SAVEPOINT sp_lote').catch(() => {});
            console.warn('⚠️ [ABRIR-CAJA] Registro en bunker_lotes_destinos omitido:', loteErr.message);
        }

        // 5. Actualizar stock_real_consolidado para UNIDAD (+totalUnidades) y CAJA (-cantCajas)
        await client.query(`
            INSERT INTO public.stock_real_consolidado (
                articulo_numero,
                descripcion,
                stock_movimientos,
                stock_lomasoft,
                stock_ajustes,
                stock_consolidado,
                ultima_actualizacion
            ) VALUES ($1, $2, $3, 0, 0, $3, NOW())
            ON CONFLICT (articulo_numero)
            DO UPDATE SET
                stock_movimientos = COALESCE(public.stock_real_consolidado.stock_movimientos, 0) + $3,
                ultima_actualizacion = NOW()
        `, [
            String(codigo_unidad).trim(),
            mapaBunker.get(String(codigo_unidad).trim())?.descripcion_generada || String(codigo_unidad).trim(),
            totalUnidades
        ]);

        await client.query(`
            UPDATE public.stock_real_consolidado
            SET
                stock_movimientos = COALESCE(stock_movimientos, 0) - $2,
                ultima_actualizacion = NOW()
            WHERE BTRIM(articulo_numero) = BTRIM($1)
        `, [codigo_caja, cantCajas]);

        // 6. Recalcular stock_consolidado para ambos artículos
        const { recalcularStockConsolidado } = require('../utils/recalcularStock');
        await recalcularStockConsolidado(client, String(codigo_unidad).trim());
        await recalcularStockConsolidado(client, String(codigo_caja).trim());

        // 7. Persistir aprendizaje automático Caja -> Unidad + unidades_por_caja
        await client.query(`
            INSERT INTO public.abrir_caja_aprendizaje (
                codigo_caja,
                codigo_unidad,
                unidades_por_caja,
                veces_usado,
                ultimo_usuario_id,
                ultima_apertura
            ) VALUES ($1, $2, $3, $4, $5, NOW())
            ON CONFLICT (codigo_caja, codigo_unidad)
            DO UPDATE SET
                unidades_por_caja = EXCLUDED.unidades_por_caja,
                veces_usado = public.abrir_caja_aprendizaje.veces_usado + EXCLUDED.veces_usado,
                ultimo_usuario_id = EXCLUDED.ultimo_usuario_id,
                ultima_apertura = NOW()
        `, [
            String(codigo_caja).trim(),
            String(codigo_unidad).trim(),
            unidPorCaja,
            cantCajas,
            usuario_id
        ]);

        // 8. Leer stocks actualizados
        const nuevosStocksRes = await client.query(`
            SELECT BTRIM(articulo_numero) AS articulo_numero, ROUND(CAST(COALESCE(stock_consolidado, 0) AS NUMERIC), 2) AS stock_actual
            FROM public.stock_real_consolidado
            WHERE BTRIM(articulo_numero) = ANY($1)
        `, [[String(codigo_caja).trim(), String(codigo_unidad).trim()]]);

        const mapaNuevosStocks = {};
        for (const r of nuevosStocksRes.rows) {
            mapaNuevosStocks[r.articulo_numero] = parseFloat(r.stock_actual);
        }

        await client.query('COMMIT');

        // Evaluar caducidad automática de fotos de lote si aplica (no bloqueante)
        try {
            const FotosLotesService = require('../../logistica/services/fotosLotesService');
            await FotosLotesService.evaluarCaducidadAutomaticaLotes(pool);
        } catch (_) {}

        console.log(`🎉 [ABRIR-CAJA] ===== APERTURA COMPLETADA (${cantCajas} caja/s -> +${totalUnidades} un. | Lote: ${lote || 'S/L'}) =====\n`);

        res.json({
            success: true,
            mensaje: 'Caja abierta exitosamente',
            movimientos: {
                entrada_id: movimientoEntradaId,
                salida_id: movimientoSalidaId
            },
            cantidad_cajas: cantCajas,
            unidades_por_caja: unidPorCaja,
            cantidad_unidades: totalUnidades,
            lote: lote || null,
            stocks_actualizados: mapaNuevosStocks,
            aprendizaje: {
                codigo_caja: String(codigo_caja).trim(),
                codigo_unidad: String(codigo_unidad).trim(),
                unidades_por_caja: unidPorCaja
            }
        });
    } catch (error) {
        await client.query('ROLLBACK');
        console.error('❌ [ABRIR-CAJA] Error al registrar apertura:', error);
        res.status(500).json({
            error: 'Error al abrir caja',
            detalle: error.message
        });
    } finally {
        client.release();
    }
}

module.exports = {
    ensureTablaAprendizaje,
    obtenerCatalogoAbrirCaja,
    obtenerAprendizajeCaja,
    obtenerSugerenciasCajas,
    buscarCajas,
    obtenerLoteSugerido,
    registrarAperturaCaja
};
