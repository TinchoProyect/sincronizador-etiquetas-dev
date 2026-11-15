/**
 * Helper determinista para identificar Artículos Puente (AP) que operan por kilo (kilos_unidad = 1.00)
 * tanto en Producción Externa (Líneas 4, 5, 6) como en Producción Interna de Mixes (Línea 3).
 */
async function esArticuloPuentePorKilo(db, articuloNumero) {
    const sku = String(articuloNumero || '').trim();
    if (!sku) return false;

    const { rows } = await db.query(
        `SELECT
            ba.articulo_id,
            ba.familia_id,
            ba.kilos_unidad AS ba_kilos_unidad,
            src.kilos_unidad AS src_kilos_unidad,
            COALESCE(src.solo_produccion_externa, false) AS solo_produccion_externa,
            EXISTS (
                SELECT 1
                FROM public.articulos_produccion_externa_relacion aper
                WHERE UPPER(BTRIM(aper.articulo_kilo_codigo)) = UPPER(BTRIM($1))
                  AND UPPER(BTRIM(aper.articulo_produccion_codigo)) <> UPPER(BTRIM(aper.articulo_kilo_codigo))
            ) AS es_ap_externo,
            EXISTS (
                SELECT 1
                FROM public.recetas r
                WHERE UPPER(BTRIM(r.articulo_sugerido_numero)) = UPPER(BTRIM($1))
            ) AS es_ap_sugerido,
            EXISTS (
                SELECT 1
                FROM public.ingredientes i
                WHERE UPPER(BTRIM(i.articulo_vinculado_numero)) = UPPER(BTRIM($1))
            ) AS vinculado_a_ingrediente
         FROM public.articulos a
         LEFT JOIN public.bunker_articulos ba ON UPPER(BTRIM(ba.articulo_id)) = UPPER(BTRIM(a.numero))
         LEFT JOIN public.stock_real_consolidado src ON UPPER(BTRIM(src.articulo_numero)) = UPPER(BTRIM(a.numero))
         WHERE UPPER(BTRIM(a.numero)) = UPPER(BTRIM($1))
         LIMIT 1`,
        [sku]
    );

    if (rows.length === 0) return false;
    const row = rows[0];

    // Las UPs puras (solo_produccion_externa = true) no son Artículos Puente de stock por kilo
    if (row.solo_produccion_externa === true) return false;

    const famId = Number(row.familia_id || 0);
    const baKu = row.ba_kilos_unidad !== null && row.ba_kilos_unidad !== undefined ? parseFloat(row.ba_kilos_unidad) : null;

    if (row.es_ap_externo === true) return true;
    if (famId === 42 && (baKu === null || Math.abs(baKu - 1) < 0.001)) return true;
    if (famId === 42 && (row.es_ap_sugerido === true || row.vinculado_a_ingrediente === true)) return true;

    return false;
}

/**
 * Calcula las unidades reales a impactar en stock_real_consolidado.stock_movimientos
 * para un movimiento de 'ingreso a producción'.
 * - Si es un Artículo Puente por kilo (1 u = 1 kg), descuenta/revierte exactamente |kilos|
 *   cuando |kilos| > 0 (evitando descontar 1 sola unidad cuando cantidad = 1 y kilos = 9.5 o 19.18).
 * - Si es un bulto cerrado normal (ej. caja de 10 kg o 22.68 kg), descuenta/revierte |cantidad| bultos.
 */
async function calcularUnidadesMovimientoIngresoProduccion(db, articuloNumero, cantidad, kilos) {
    const cantAbs = Math.abs(parseFloat(cantidad) || 0) || 1;
    const kilosAbs = Math.abs(parseFloat(kilos) || 0);

    const esAp = await esArticuloPuentePorKilo(db, articuloNumero);
    if (esAp && kilosAbs > 0) {
        return Number(kilosAbs.toFixed(4));
    }
    return Number(cantAbs.toFixed(4));
}

module.exports = {
    esArticuloPuentePorKilo,
    calcularUnidadesMovimientoIngresoProduccion
};
