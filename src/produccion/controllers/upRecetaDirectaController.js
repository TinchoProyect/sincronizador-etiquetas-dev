const pool = require('../config/database');
const { sincronizarManifestIngredientesB2B } = require('../services/desgloseIngredientesComercialService');

/**
 * Resuelve información determinista de un artículo (UP, AP, Pre-Mezcla o Fracción)
 * junto con su receta completa (receta_articulos + receta_ingredientes) y vínculo UP -> AP -> Ingrediente,
 * sin depender de carros de producción abiertos.
 */
async function obtenerConfiguracionUpRecetaDirecta(req, res) {
    try {
        const codigoParam = String(req.params.codigo || '').trim();
        if (!codigoParam) {
            return res.status(400).json({ error: 'Se requiere el código SKU del artículo' });
        }

        const forzarSku = String(req.query.forzar_sku || '').toLowerCase() === 'true';
        let skuObjetivo = codigoParam;
        let solicitadoDesdeSku = null;
        let skuAlternativo = null;

        // Si el usuario abrió el editor desde un AP (articulo_kilo_codigo) que no tiene receta propia
        // pero es salida de una UP en articulos_produccion_externa_relacion, abrimos directamente su UP madre
        // dejando disponible el conmutador para inspeccionar ambos extremos.
        const relComoApRes = await pool.query(
            `SELECT id, articulo_produccion_codigo, articulo_kilo_codigo, multiplicador_ingredientes
             FROM public.articulos_produccion_externa_relacion
             WHERE UPPER(BTRIM(articulo_kilo_codigo)) = UPPER(BTRIM($1))
               AND UPPER(BTRIM(articulo_produccion_codigo)) <> UPPER(BTRIM(articulo_kilo_codigo))
             ORDER BY id ASC`,
            [codigoParam]
        );

        if (!forzarSku && relComoApRes.rows.length > 0) {
            const tieneRecetaPropiaRes = await pool.query(
                `SELECT r.id
                 FROM public.recetas r
                 WHERE UPPER(BTRIM(r.articulo_numero)) = UPPER(BTRIM($1))
                   AND (
                     EXISTS (SELECT 1 FROM public.receta_articulos ra WHERE ra.receta_id = r.id)
                     OR EXISTS (SELECT 1 FROM public.receta_ingredientes ri WHERE ri.receta_id = r.id)
                   )
                 LIMIT 1`,
                [codigoParam]
            );
            if (tieneRecetaPropiaRes.rows.length === 0) {
                solicitadoDesdeSku = codigoParam;
                skuObjetivo = relComoApRes.rows[0].articulo_produccion_codigo;
                skuAlternativo = codigoParam;
            }
        }

        const artRes = await pool.query(
            `SELECT
                COALESCE(ba.articulo_id, a.numero, src.articulo_numero) AS sku,
                COALESCE(NULLIF(BTRIM(ba.descripcion_generada), ''), NULLIF(BTRIM(ba.descripcion), ''), a.nombre, src.descripcion, $1) AS descripcion_bunker,
                ba.familia_id,
                COALESCE(ba.kilos_unidad, CAST(src.kilos_unidad AS numeric(14,4)), 1.0000) AS kilos_unidad,
                COALESCE(src.solo_produccion_externa, false) AS solo_produccion_externa,
                COALESCE(ba.no_producido_por_lambda, src.no_producido_por_lambda, false) AS no_producido_por_lambda,
                COALESCE(CAST(src.stock_consolidado AS numeric(14,2)), 0) AS stock_bultos,
                COALESCE(ba.costo_base, 0) AS costo_bulto
             FROM (SELECT $1::text AS codigo_buscado) q
             LEFT JOIN public.bunker_articulos ba ON UPPER(BTRIM(ba.articulo_id)) = UPPER(BTRIM(q.codigo_buscado))
             LEFT JOIN public.articulos a ON UPPER(BTRIM(a.numero)) = UPPER(BTRIM(q.codigo_buscado))
             LEFT JOIN public.stock_real_consolidado src ON UPPER(BTRIM(src.articulo_numero)) = UPPER(BTRIM(q.codigo_buscado))`,
            [skuObjetivo]
        );

        const artRow = artRes.rows[0];
        if (!artRow || !artRow.sku) {
            return res.status(404).json({ error: `No se encontró el artículo ${skuObjetivo} en el padrón LAMDA` });
        }

        const kilosUnidad = Number(artRow.kilos_unidad) > 0 ? Number(artRow.kilos_unidad) : 1;
        const stockBultos = Number(artRow.stock_bultos) || 0;
        const costoBulto = Number(artRow.costo_bulto) || 0;

        // Receta actual (si existe)
        const recetaRes = await pool.query(
            `SELECT id, articulo_numero, descripcion, COALESCE(enlazado_externo, false) AS enlazado_externo, articulo_sugerido_numero
             FROM public.recetas
             WHERE UPPER(BTRIM(articulo_numero)) = UPPER(BTRIM($1))
             ORDER BY (articulo_numero = $1) DESC, id ASC
             LIMIT 1`,
            [artRow.sku]
        );
        const receta = recetaRes.rows[0] || null;

        let recetaArticulos = [];
        let recetaIngredientes = [];

        if (receta) {
            const [raRes, riRes] = await Promise.all([
                pool.query(
                    `SELECT
                        ra.id,
                        ra.articulo_numero,
                        CAST(ra.cantidad AS numeric(14,4)) AS cantidad,
                        COALESCE(NULLIF(BTRIM(ba.descripcion_generada), ''), NULLIF(BTRIM(ba.descripcion), ''), a.nombre, src.descripcion, ra.articulo_numero) AS descripcion_bunker,
                        COALESCE(ba.kilos_unidad, CAST(src.kilos_unidad AS numeric(14,4)), 1.0000) AS kilos_unidad,
                        COALESCE(CAST(src.stock_consolidado AS numeric(14,2)), 0) AS stock_bultos,
                        COALESCE(ba.costo_base, 0) AS costo_bulto
                     FROM public.receta_articulos ra
                     LEFT JOIN public.bunker_articulos ba ON UPPER(BTRIM(ba.articulo_id)) = UPPER(BTRIM(ra.articulo_numero))
                     LEFT JOIN public.articulos a ON UPPER(BTRIM(a.numero)) = UPPER(BTRIM(ra.articulo_numero))
                     LEFT JOIN public.stock_real_consolidado src ON UPPER(BTRIM(src.articulo_numero)) = UPPER(BTRIM(ra.articulo_numero))
                     WHERE ra.receta_id = $1
                     ORDER BY ra.id ASC`,
                    [receta.id]
                ),
                pool.query(
                    `SELECT
                        ri.id,
                        ri.ingrediente_id,
                        i.codigo::text AS codigo,
                        COALESCE(i.nombre, ri.nombre_ingrediente) AS nombre,
                        COALESCE(ri.unidad_medida, i.unidad_medida, 'kg') AS unidad_medida,
                        CAST(ri.cantidad AS numeric(14,4)) AS cantidad,
                        COALESCE(ri.fase_produccion, 'externa') AS fase_produccion,
                        COALESCE(CAST(i.stock_actual AS numeric(14,2)), 0) AS stock_actual,
                        COALESCE(CAST(i.costo_patron AS numeric(14,2)), 0) AS costo_patron,
                        COALESCE(i.es_insumo, false) AS es_insumo,
                        i.articulo_vinculado_numero
                     FROM public.receta_ingredientes ri
                     LEFT JOIN public.ingredientes i ON i.id = ri.ingrediente_id
                     WHERE ri.receta_id = $1
                     ORDER BY ri.id ASC`,
                    [receta.id]
                )
            ]);

            recetaArticulos = raRes.rows.map((r) => {
                const ku = Number(r.kilos_unidad) > 0 ? Number(r.kilos_unidad) : 1;
                const sb = Number(r.stock_bultos) || 0;
                const cb = Number(r.costo_bulto) || 0;
                return {
                    id: r.id,
                    articulo_numero: r.articulo_numero,
                    descripcion_bunker: r.descripcion_bunker,
                    cantidad: Number(r.cantidad) || 0,
                    kilos_unidad: ku,
                    stock_bultos: sb,
                    stock_kilos: Number((sb * ku).toFixed(2)),
                    costo_bulto: cb,
                    costo_kilo: ku > 0 ? Number((cb / ku).toFixed(2)) : cb
                };
            });

            recetaIngredientes = riRes.rows.map((r) => ({
                id: r.id,
                ingrediente_id: r.ingrediente_id,
                codigo: r.codigo || '',
                nombre: r.nombre || '',
                unidad_medida: r.unidad_medida || 'kg',
                cantidad: Number(r.cantidad) || 0,
                fase_produccion: r.fase_produccion || 'externa',
                stock_actual: Number(r.stock_actual) || 0,
                costo_patron: Number(r.costo_patron) || 0,
                es_insumo: Boolean(r.es_insumo),
                articulo_vinculado_numero: r.articulo_vinculado_numero || null
            }));
        }

        // Relación UP -> AP (si este SKU actúa como UP)
        const relUpRes = await pool.query(
            `SELECT
                rel.id,
                rel.articulo_produccion_codigo,
                rel.articulo_kilo_codigo,
                rel.multiplicador_ingredientes,
                rel.ingredientes_custom,
                COALESCE(NULLIF(BTRIM(ba_ap.descripcion_generada), ''), NULLIF(BTRIM(ba_ap.descripcion), ''), a_ap.nombre, rel.articulo_kilo_codigo) AS ap_descripcion,
                COALESCE(CAST(src_ap.stock_consolidado AS numeric(14,2)), 0) AS ap_stock_kilos,
                ing.id AS ingrediente_espejo_id,
                ing.codigo::text AS ingrediente_espejo_codigo,
                ing.nombre AS ingrediente_espejo_nombre,
                COALESCE(CAST(ing.costo_patron AS numeric(14,2)), 0) AS ingrediente_espejo_costo
             FROM public.articulos_produccion_externa_relacion rel
             LEFT JOIN public.bunker_articulos ba_ap ON UPPER(BTRIM(ba_ap.articulo_id)) = UPPER(BTRIM(rel.articulo_kilo_codigo))
             LEFT JOIN public.articulos a_ap ON UPPER(BTRIM(a_ap.numero)) = UPPER(BTRIM(rel.articulo_kilo_codigo))
             LEFT JOIN public.stock_real_consolidado src_ap ON UPPER(BTRIM(src_ap.articulo_numero)) = UPPER(BTRIM(rel.articulo_kilo_codigo))
             LEFT JOIN public.ingredientes ing ON UPPER(BTRIM(ing.articulo_vinculado_numero)) = UPPER(BTRIM(rel.articulo_kilo_codigo))
             WHERE UPPER(BTRIM(rel.articulo_produccion_codigo)) = UPPER(BTRIM($1))
               AND UPPER(BTRIM(rel.articulo_produccion_codigo)) <> UPPER(BTRIM(rel.articulo_kilo_codigo))
             ORDER BY rel.id ASC
             LIMIT 1`,
            [artRow.sku]
        );
        const relacionUpAp = relUpRes.rows[0] || null;
        if (relacionUpAp && !skuAlternativo) {
            skuAlternativo = relacionUpAp.articulo_kilo_codigo;
        }

        // Ingrediente espejo directo si el propio SKU es un AP (ej. MFSPXK o APTSPGXK)
        const ingPropioRes = await pool.query(
            `SELECT id, codigo::text AS codigo, nombre, COALESCE(CAST(stock_actual AS numeric(14,2)), 0) AS stock_actual, COALESCE(CAST(costo_patron AS numeric(14,2)), 0) AS costo_patron
             FROM public.ingredientes
             WHERE UPPER(BTRIM(articulo_vinculado_numero)) = UPPER(BTRIM($1))
             ORDER BY id ASC`,
            [artRow.sku]
        );

        // Catálogos deterministas livianos para selectores con búsqueda instantánea
        const [catArtRes, catIngRes] = await Promise.all([
            pool.query(
                `SELECT
                    ba.articulo_id AS sku,
                    COALESCE(NULLIF(BTRIM(ba.descripcion_generada), ''), NULLIF(BTRIM(ba.descripcion), ''), a.nombre, ba.articulo_id) AS descripcion_bunker,
                    ba.familia_id,
                    COALESCE(ba.kilos_unidad, CAST(src.kilos_unidad AS numeric(14,4)), 1.0000) AS kilos_unidad,
                    COALESCE(CAST(src.stock_consolidado AS numeric(14,2)), 0) AS stock_bultos,
                    COALESCE(ba.costo_base, 0) AS costo_bulto,
                    COALESCE(src.solo_produccion_externa, false) AS solo_produccion_externa,
                    COALESCE(ba.no_producido_por_lambda, src.no_producido_por_lambda, false) AS no_producido_por_lambda
                 FROM public.bunker_articulos ba
                 LEFT JOIN public.articulos a ON UPPER(BTRIM(a.numero)) = UPPER(BTRIM(ba.articulo_id))
                 LEFT JOIN public.stock_real_consolidado src ON UPPER(BTRIM(src.articulo_numero)) = UPPER(BTRIM(ba.articulo_id))
                 WHERE COALESCE((ba.propiedades_dinamicas->>'obsoleto')::boolean, false) = false
                 ORDER BY ba.articulo_id ASC`
            ),
            pool.query(
                `SELECT
                    id,
                    codigo::text AS codigo,
                    nombre,
                    COALESCE(unidad_medida, 'kg') AS unidad_medida,
                    COALESCE(CAST(stock_actual AS numeric(14,2)), 0) AS stock_actual,
                    COALESCE(CAST(costo_patron AS numeric(14,2)), 0) AS costo_patron,
                    COALESCE(es_insumo, false) AS es_insumo,
                    articulo_vinculado_numero
                 FROM public.ingredientes
                 ORDER BY COALESCE(es_insumo, false) ASC, nombre ASC`
            )
        ]);

        const catalogoArticulos = catArtRes.rows.map((r) => {
            const ku = Number(r.kilos_unidad) > 0 ? Number(r.kilos_unidad) : 1;
            const sb = Number(r.stock_bultos) || 0;
            const cb = Number(r.costo_bulto) || 0;
            return {
                sku: r.sku,
                descripcion_bunker: r.descripcion_bunker,
                familia_id: r.familia_id,
                kilos_unidad: ku,
                stock_bultos: sb,
                stock_kilos: Number((sb * ku).toFixed(2)),
                costo_bulto: cb,
                costo_kilo: ku > 0 ? Number((cb / ku).toFixed(2)) : cb,
                solo_produccion_externa: Boolean(r.solo_produccion_externa),
                no_producido_por_lambda: Boolean(r.no_producido_por_lambda)
            };
        });

        return res.json({
            articulo: {
                sku: artRow.sku,
                descripcion_bunker: artRow.descripcion_bunker,
                familia_id: artRow.familia_id,
                kilos_unidad: kilosUnidad,
                solo_produccion_externa: Boolean(artRow.solo_produccion_externa),
                no_producido_por_lambda: Boolean(artRow.no_producido_por_lambda),
                stock_bultos: stockBultos,
                stock_kilos: Number((stockBultos * kilosUnidad).toFixed(2)),
                costo_bulto: costoBulto,
                costo_kilo: kilosUnidad > 0 ? Number((costoBulto / kilosUnidad).toFixed(2)) : costoBulto,
                solicitado_desde_sku: solicitadoDesdeSku,
                sku_alternativo: skuAlternativo,
                ingredientes_espejo_propios: ingPropioRes.rows
            },
            receta,
            receta_articulos: recetaArticulos,
            receta_ingredientes: recetaIngredientes,
            relacion_up_ap: relacionUpAp,
            relaciones_como_ap: relComoApRes.rows,
            catalogo_articulos: catalogoArticulos,
            catalogo_ingredientes: catIngRes.rows
        });
    } catch (error) {
        console.error('❌ [UP-RECETA-DIRECTA] Error en GET:', error);
        return res.status(500).json({ error: 'Error al consultar configuración directa de UP/Receta', detalle: error.message });
    }
}

/**
 * Guarda de forma transaccional y no destructiva la receta (receta_articulos + receta_ingredientes)
 * y opcionalmente el vínculo UP -> AP en articulos_produccion_externa_relacion,
 * sin crear, alterar ni cerrar ningún carro de producción.
 */
async function guardarConfiguracionUpRecetaDirecta(req, res) {
    const client = await pool.connect();
    try {
        const sku = String(req.params.codigo || '').trim();
        if (!sku) {
            return res.status(400).json({ error: 'Se requiere el código SKU del artículo' });
        }

        const {
            descripcion,
            enlazado_externo,
            articulos,
            ingredientes,
            actualizar_relacion_up,
            relacion_up_ap
        } = req.body || {};

        const enviaArticulos = Array.isArray(articulos);
        const enviaIngredientes = Array.isArray(ingredientes);

        // Validar artículos e ingredientes enviados
        if (enviaArticulos) {
            for (const art of articulos) {
                const cod = String(art.articulo_numero || '').trim();
                const cant = Number(art.cantidad);
                if (!cod || !Number.isFinite(cant) || cant <= 0) {
                    return res.status(400).json({ error: 'Cada artículo/bulto de la receta debe tener código válido y cantidad mayor a 0' });
                }
                if (cod.toUpperCase() === sku.toUpperCase()) {
                    return res.status(400).json({ error: `El artículo ${sku} no puede referenciarse a sí mismo dentro de receta_articulos` });
                }
            }
        }

        if (enviaIngredientes) {
            for (const ing of ingredientes) {
                const ingId = parseInt(ing.ingrediente_id, 10);
                const cant = Number(ing.cantidad);
                if (!ingId || !Number.isFinite(cant) || cant <= 0) {
                    return res.status(400).json({ error: 'Cada ingrediente de la receta debe tener ID válido y cantidad mayor a 0' });
                }
            }
        }

        if (actualizar_relacion_up === true && relacion_up_ap && relacion_up_ap.articulo_kilo_codigo) {
            const apCod = String(relacion_up_ap.articulo_kilo_codigo || '').trim();
            if (apCod.toUpperCase() === sku.toUpperCase()) {
                return res.status(400).json({
                    error: 'Auto-vínculo bloqueado: una Unidad Productiva (UP) no puede apuntarse a sí misma como Artículo Puente (AP).'
                });
            }
        }

        await client.query('BEGIN');

        // 1. Obtener o crear receta preservando campos existentes (ej. articulo_sugerido_numero)
        const recRes = await client.query(
            `SELECT id, descripcion, COALESCE(enlazado_externo, false) AS enlazado_externo, articulo_sugerido_numero
             FROM public.recetas
             WHERE UPPER(BTRIM(articulo_numero)) = UPPER(BTRIM($1))
             ORDER BY (articulo_numero = $1) DESC, id ASC
             LIMIT 1`,
            [sku]
        );

        let recetaId = recRes.rows[0]?.id || null;
        const tieneItemsNuevos = (enviaArticulos && articulos.length > 0) || (enviaIngredientes && ingredientes.length > 0);

        if (!recetaId && tieneItemsNuevos) {
            const insRec = await client.query(
                `INSERT INTO public.recetas (articulo_numero, descripcion, fecha_creacion, enlazado_externo)
                 VALUES ($1, $2, NOW(), $3)
                 RETURNING id`,
                [
                    sku,
                    descripcion !== undefined ? String(descripcion).trim() : `Receta de ${sku}`,
                    enlazado_externo === true
                ]
            );
            recetaId = insRec.rows[0].id;
        } else if (recetaId) {
            const existente = recRes.rows[0];
            const descFinal = descripcion !== undefined ? String(descripcion).trim() : existente.descripcion;
            const enlazadoFinal = enlazado_externo !== undefined ? (enlazado_externo === true) : existente.enlazado_externo;
            await client.query(
                `UPDATE public.recetas
                 SET descripcion = $1,
                     enlazado_externo = $2
                 WHERE id = $3`,
                [descFinal, enlazadoFinal, recetaId]
            );
        }

        if (recetaId) {
            if (enviaArticulos) {
                await client.query(`DELETE FROM public.receta_articulos WHERE receta_id = $1`, [recetaId]);
                for (const art of articulos) {
                    await client.query(
                        `INSERT INTO public.receta_articulos (receta_id, articulo_numero, cantidad)
                         VALUES ($1, $2, $3)`,
                        [recetaId, String(art.articulo_numero).trim(), Number(art.cantidad)]
                    );
                }
            }

            if (enviaIngredientes) {
                await client.query(`DELETE FROM public.receta_ingredientes WHERE receta_id = $1`, [recetaId]);
                for (const ing of ingredientes) {
                    const ingInfoRes = await client.query(
                        `SELECT id, nombre, COALESCE(unidad_medida, 'kg') AS unidad_medida FROM public.ingredientes WHERE id = $1`,
                        [parseInt(ing.ingrediente_id, 10)]
                    );
                    const ingDb = ingInfoRes.rows[0];
                    if (!ingDb) {
                        throw new Error(`Ingrediente #${ing.ingrediente_id} inexistente en public.ingredientes`);
                    }
                    await client.query(
                        `INSERT INTO public.receta_ingredientes (receta_id, ingrediente_id, nombre_ingrediente, unidad_medida, cantidad, fase_produccion)
                         VALUES ($1, $2, $3, $4, $5, $6)`,
                        [
                            recetaId,
                            ingDb.id,
                            ingDb.nombre,
                            String(ing.unidad_medida || ingDb.unidad_medida || 'kg').trim(),
                            Number(ing.cantidad),
                            String(ing.fase_produccion || 'externa').trim()
                        ]
                    );
                }
            }
        }

        // 2. Actualizar vínculo UP -> AP de forma no destructiva (preservando multiplicador_ingredientes e ingredientes_custom)
        let relacionActualizada = null;
        if (actualizar_relacion_up === true) {
            const apCodigo = String(relacion_up_ap?.articulo_kilo_codigo || '').trim();
            const relPrevRes = await client.query(
                `SELECT id, articulo_produccion_codigo, articulo_kilo_codigo, multiplicador_ingredientes, ingredientes_custom
                 FROM public.articulos_produccion_externa_relacion
                 WHERE UPPER(BTRIM(articulo_produccion_codigo)) = UPPER(BTRIM($1))
                 ORDER BY id ASC
                 LIMIT 1`,
                [sku]
            );
            const relPrev = relPrevRes.rows[0] || null;

            if (apCodigo) {
                const multFinal = (relacion_up_ap && relacion_up_ap.multiplicador_ingredientes !== undefined && relacion_up_ap.multiplicador_ingredientes !== null && relacion_up_ap.multiplicador_ingredientes !== '')
                    ? Number(relacion_up_ap.multiplicador_ingredientes)
                    : (relPrev && relPrev.multiplicador_ingredientes !== null ? Number(relPrev.multiplicador_ingredientes) : 1.0);

                if (relPrev) {
                    const upRel = await client.query(
                        `UPDATE public.articulos_produccion_externa_relacion
                         SET articulo_kilo_codigo = $1,
                             multiplicador_ingredientes = $2
                         WHERE id = $3
                         RETURNING id, articulo_produccion_codigo, articulo_kilo_codigo, multiplicador_ingredientes`,
                        [apCodigo, multFinal, relPrev.id]
                    );
                    relacionActualizada = upRel.rows[0];
                } else {
                    const insRel = await client.query(
                        `INSERT INTO public.articulos_produccion_externa_relacion
                         (articulo_produccion_codigo, articulo_kilo_codigo, multiplicador_ingredientes)
                         VALUES ($1, $2, $3)
                         RETURNING id, articulo_produccion_codigo, articulo_kilo_codigo, multiplicador_ingredientes`,
                        [sku, apCodigo, multFinal]
                    );
                    relacionActualizada = insRel.rows[0];
                }
            } else if (relPrev && relacion_up_ap?.desvincular_ap === true) {
                await client.query(`DELETE FROM public.articulos_produccion_externa_relacion WHERE id = $1`, [relPrev.id]);
            }
        }

        await client.query('COMMIT');
        sincronizarManifestIngredientesB2B().catch(() => {});

        return res.json({
            success: true,
            sku,
            receta_id: recetaId,
            relacion_up_ap: relacionActualizada,
            mensaje: `Configuración de ${sku} guardada correctamente sin afectar carros de producción.`
        });
    } catch (error) {
        await client.query('ROLLBACK');
        console.error('❌ [UP-RECETA-DIRECTA] Error en PUT:', error);
        return res.status(500).json({ error: 'Error al guardar configuración directa de UP/Receta', detalle: error.message });
    } finally {
        client.release();
    }
}

module.exports = {
    obtenerConfiguracionUpRecetaDirecta,
    guardarConfiguracionUpRecetaDirecta
};
