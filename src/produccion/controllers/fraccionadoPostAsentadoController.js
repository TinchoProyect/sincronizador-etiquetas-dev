const pool = require('../config/database');
const { crearCarro, agregarArticulo } = require('./carro');

/**
 * GET /api/produccion/articulos-puente/:sku/fracciones-deterministas
 * Cadena determinista 100% por ID/código (cero búsqueda por texto):
 * AP.numero = public.ingredientes.articulo_vinculado_numero
 *   -> public.receta_ingredientes.ingrediente_id
 *   -> public.recetas.articulo_numero
 *   -> public.bunker_articulos.articulo_id
 * Excluye Familia 42 (APs/UPs), Packs (es_pack / pack_hijo_codigo), obsoletos,
 * artículos no producidos por LAMDA y códigos huérfanos fuera de bunker_articulos.
 */
async function obtenerFraccionesDeterministasPorAp(req, res) {
    try {
        const skuAp = String(req.params.sku || '').trim();
        if (!skuAp) {
            return res.status(400).json({ error: 'Se requiere el SKU del Artículo Puente (AP)' });
        }

        const apRes = await pool.query(
            `SELECT
                COALESCE(ba.articulo_id, a.numero, src.articulo_numero, $1) AS sku_ap,
                COALESCE(NULLIF(BTRIM(ba.descripcion_generada), ''), NULLIF(BTRIM(ba.descripcion), ''), a.nombre, src.descripcion, $1) AS ap_descripcion,
                COALESCE(CAST(src.stock_consolidado AS numeric(14,2)), 0) AS stock_ap_actual
             FROM (SELECT $1::text AS buscado) q
             LEFT JOIN public.bunker_articulos ba ON UPPER(BTRIM(ba.articulo_id)) = UPPER(BTRIM(q.buscado))
             LEFT JOIN public.articulos a ON UPPER(BTRIM(a.numero)) = UPPER(BTRIM(q.buscado))
             LEFT JOIN public.stock_real_consolidado src ON UPPER(BTRIM(src.articulo_numero)) = UPPER(BTRIM(q.buscado))`,
            [skuAp]
        );
        const apInfo = apRes.rows[0] || { sku_ap: skuAp, ap_descripcion: skuAp, stock_ap_actual: 0 };

        const queryFracciones = `
            SELECT
                i.id AS ingrediente_id,
                i.codigo::text AS ingrediente_codigo,
                i.nombre AS ingrediente_nombre,
                ba.articulo_id AS sku,
                COALESCE(NULLIF(BTRIM(ba.descripcion_generada), ''), NULLIF(BTRIM(ba.descripcion), ''), a.nombre, ba.articulo_id) AS descripcion_generada,
                CAST(ri.cantidad AS numeric(14,4)) AS kilos_ingrediente_por_unidad,
                COALESCE(ba.kilos_unidad, CAST(src.kilos_unidad AS numeric(14,4)), CAST(ri.cantidad AS numeric(14,4))) AS kilos_unidad,
                COALESCE(CAST(src.stock_consolidado AS numeric(14,2)), 0) AS stock_actual,
                COALESCE(env.envase_nombre, env_bunker.envase_nombre, 'Sin envase asignado') AS envase_nombre
            FROM public.ingredientes i
            JOIN public.receta_ingredientes ri ON ri.ingrediente_id = i.id
            JOIN public.recetas r ON r.id = ri.receta_id
            JOIN public.bunker_articulos ba ON UPPER(BTRIM(ba.articulo_id)) = UPPER(BTRIM(r.articulo_numero))
            LEFT JOIN public.articulos a ON UPPER(BTRIM(a.numero)) = UPPER(BTRIM(ba.articulo_id))
            LEFT JOIN public.stock_real_consolidado src ON UPPER(BTRIM(src.articulo_numero)) = UPPER(BTRIM(ba.articulo_id))
            LEFT JOIN LATERAL (
                SELECT STRING_AGG('[' || COALESCE(ie.codigo::text, '#' || ie.id::text) || '] ' || ie.nombre, ' + ') AS envase_nombre
                FROM public.receta_ingredientes rie
                JOIN public.ingredientes ie ON ie.id = rie.ingrediente_id
                WHERE rie.receta_id = r.id
                  AND ie.id <> i.id
                  AND (COALESCE(ie.es_insumo, false) = true OR LOWER(COALESCE(rie.unidad_medida, '')) LIKE 'uni%')
            ) env ON true
            LEFT JOIN LATERAL (
                SELECT STRING_AGG('[' || COALESCE(ib.codigo::text, bli.insumo_articulo_numero::text) || '] ' || COALESCE(ib.nombre, ai.nombre, bli.insumo_articulo_numero::text), ' + ') AS envase_nombre
                FROM public.bunker_lista_articulos bla
                JOIN public.bunker_lista_insumos bli ON bli.lista_articulo_id = bla.id AND COALESCE(bli.incluido, true) = true
                LEFT JOIN public.ingredientes ib ON ib.codigo::text = bli.insumo_articulo_numero::text OR ib.id::text = bli.insumo_articulo_numero::text
                LEFT JOIN public.articulos ai ON UPPER(BTRIM(ai.numero)) = UPPER(BTRIM(bli.insumo_articulo_numero::text))
                WHERE UPPER(BTRIM(bla.articulo_numero)) = UPPER(BTRIM(ba.articulo_id))
                  AND bla.lista_id = 1
            ) env_bunker ON true
            WHERE UPPER(BTRIM(i.articulo_vinculado_numero)) = UPPER(BTRIM($1))
              AND COALESCE(ba.familia_id, 0) <> 42
              AND COALESCE(ba.es_pack, false) = false
              AND NULLIF(BTRIM(COALESCE(ba.pack_hijo_codigo, '')), '') IS NULL
              AND COALESCE(ba.no_producido_por_lambda, src.no_producido_por_lambda, false) = false
              AND COALESCE(src.solo_produccion_externa, false) = false
              AND COALESCE((ba.propiedades_dinamicas->>'obsoleto')::boolean, false) = false
            ORDER BY kilos_ingrediente_por_unidad ASC, ba.articulo_id ASC
        `;

        const fracRes = await pool.query(queryFracciones, [skuAp]);
        const primeraFila = fracRes.rows[0] || null;

        return res.json({
            sku_ap: apInfo.sku_ap,
            ap_descripcion: apInfo.ap_descripcion,
            stock_ap_actual: Number(apInfo.stock_ap_actual) || 0,
            ingrediente_vinculado: primeraFila
                ? {
                    id: primeraFila.ingrediente_id,
                    codigo: primeraFila.ingrediente_codigo,
                    nombre: primeraFila.ingrediente_nombre
                }
                : null,
            fracciones: fracRes.rows.map((r) => ({
                sku: r.sku,
                descripcion_generada: r.descripcion_generada,
                kilos_ingrediente_por_unidad: Number(r.kilos_ingrediente_por_unidad) || Number(r.kilos_unidad) || 0,
                kilos_unidad: Number(r.kilos_unidad) || Number(r.kilos_ingrediente_por_unidad) || 0,
                stock_actual: Number(r.stock_actual) || 0,
                envase_nombre: r.envase_nombre || 'Sin envase asignado'
            }))
        });
    } catch (error) {
        console.error('❌ [FRACCIONADO-POST-ASENTADO] Error consultando fracciones deterministas:', error);
        return res.status(500).json({
            error: 'Error al consultar fracciones comerciales deterministas del Artículo Puente',
            detalle: error.message
        });
    }
}

/**
 * POST /api/produccion/articulos-puente/:sku/crear-carro-fraccionado
 * Crea un carro de producción interna con las unidades elegidas por el operador
 * y lo devuelve listo para abrir en pantalla (manteniendo el clic manual "Ingresar" intacto).
 */
async function crearCarroInternoFraccionadoDesdeAp(req, res) {
    try {
        const skuAp = String(req.params.sku || '').trim();
        const { usuarioId, items } = req.body || {};

        const uid = parseInt(usuarioId, 10);
        if (!uid) {
            return res.status(400).json({ error: 'Se requiere usuarioId válido para crear el carro interno' });
        }

        const itemsValidos = (Array.isArray(items) ? items : [])
            .map((it) => ({
                articulo_numero: String(it.articulo_numero || it.sku || '').trim(),
                descripcion: String(it.descripcion || it.descripcion_generada || it.articulo_numero || '').trim(),
                cantidad: Number(it.cantidad)
            }))
            .filter((it) => it.articulo_numero && Number.isFinite(it.cantidad) && it.cantidad > 0);

        if (itemsValidos.length === 0) {
            return res.status(400).json({ error: 'Debe ingresar una cantidad mayor a 0 en al menos una fracción comercial' });
        }

        const nuevoCarroId = await crearCarro(uid, true, 'interna', 2);

        for (const item of itemsValidos) {
            await agregarArticulo(
                nuevoCarroId,
                item.articulo_numero,
                item.descripcion,
                item.cantidad,
                uid
            );
        }

        return res.status(201).json({
            success: true,
            sku_ap: skuAp,
            carro_id: nuevoCarroId,
            items_agregados: itemsValidos.length
        });
    } catch (error) {
        console.error('❌ [FRACCIONADO-POST-ASENTADO] Error creando carro interno:', error);
        return res.status(500).json({
            error: 'Error al crear el carro interno de fraccionado',
            detalle: error.message
        });
    }
}

module.exports = {
    obtenerFraccionesDeterministasPorAp,
    crearCarroInternoFraccionadoDesdeAp
};
