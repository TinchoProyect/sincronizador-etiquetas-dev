'use strict';

/**
 * Helper Unificado de Stock Comprometido (Reservas Activas LAMDA + Tiendas Nodos + Combos LDN 8)
 * -------------------------------------------------------------------------------------------
 * Garantiza Single Source of Truth y CERO doble conteo across:
 *   1. :3003 Presupuestos (obtenerSugerenciasArticulos, preservando CTEs MATERIALIZED y <25ms)
 *   2. :3004/:3002 Producción (routes/produccion.js)
 *   3. historialPreciosService.js (cargarCatalogoDisponibilidadYAlternativas)
 *   4. planificacionProduccionService.js (informe compras / stock disponible)
 *   5. combosCompuestosService.js (obtenerMapaCombosYStockArmable) y nodosBarrialesService.js (/tienda/:slug y /gestor/:slug)
 *
 * REGLA ANTI-DOBLE CONTEO:
 *   - Los pedidos vecinales PENDIENTE_TRANSFERENCIA reservan stock mientras:
 *       npv.presupuesto_id_local IS NULL
 *       AND npv.reserva_stock_estado = 'ACTIVA'
 *       AND npv.reserva_stock_expira_at > NOW()
 *       AND COALESCE(npv.estado_operativo, '') <> 'ANULADO'
 *       AND COALESCE(npv.stock_descontado_deposito, false) = false
 *       AND COALESCE(npv.stock_descontado_fulfillment, false) = false
 *   - Cuando el pago se confirma y el pedido se proyecta en public.presupuestos
 *     (presupuesto_id_local IS NOT NULL y reserva_stock_estado = 'CONFIRMADA'),
 *     el compromiso pasa exclusivamente a presupuestos_detalles (1x).
 *   - Cuando el stock se descuenta físicamente o vence el TTL (reserva_stock_expira_at <= NOW()),
 *     deja de reservar (0x).
 *   - Explosión de Combos LDN 8 (mutuamente excluyente en 3 ramas):
 *       Rama A: Ítems simples (NO combo) -> SKU directo * cantidad
 *       Rama B: Ítems combo de Nodos con componentes_combo_snapshot JSONB -> componentes * cantidad
 *       Rama C: Ítems combo en Presupuestos (o Nodos sin snapshot) -> bunker_combos_componentes * cantidad
 */

function construirCteReservasUnificadas(opciones = {}) {
    const incluirStockPorBarras = Boolean(opciones.incluirStockPorBarras);
    const incluirReservasPadres = opciones.incluirReservasPadres !== false;
    const materializedTag = opciones.materialized === false ? '' : 'AS MATERIALIZED';

    const reservasPadresCte = incluirReservasPadres
        ? `,
      reservas_padres ${materializedTag} (
        SELECT bp.pack_hijo_codigo, SUM(rc.cantidad_reservada * COALESCE(bp.pack_unidades, 1)) AS reservado_en_packs
        FROM public.bunker_articulos bp
        JOIN reservas_crudas rc ON UPPER(BTRIM(rc.articulo_numero)) = UPPER(BTRIM(bp.articulo_id))
        WHERE (bp.es_pack = true OR bp.pack_unidades > 1)
          AND bp.pack_hijo_codigo IS NOT NULL
        GROUP BY bp.pack_hijo_codigo
      )`
        : '';

    const stockPorBarrasCte = incluirStockPorBarras
        ? `,
      stock_por_barras ${materializedTag} (
        SELECT DISTINCT ON (codigo_barras)
          codigo_barras, articulo_numero, descripcion, stock_consolidado,
          kilos_unidad, es_pack, pack_unidades, pack_hijo_codigo
        FROM public.stock_real_consolidado
        WHERE codigo_barras IS NOT NULL AND codigo_barras <> ''
        ORDER BY codigo_barras, articulo_numero
      )`
        : '';

    return `
      WITH presupuestos_lineas_crudos ${materializedTag} (
        SELECT pd.articulo AS sku_ref, SUM(pd.cantidad) AS cant
        FROM public.presupuestos_detalles pd
        JOIN public.presupuestos p ON p.id = pd.id_presupuesto
        WHERE p.activo = true
          AND COALESCE(p.archivado, false) = false
          AND COALESCE(p.tipo_comprobante, '') != 'Orden de Retiro'
          AND COALESCE(p.estado, '') NOT IN ('Anulado', 'Anulado por el Cliente', 'ANULADO', 'Sin Confirmar', 'Standby', 'STANDBY', 'Facturado', 'Entregado', 'Conciliado', 'Retirado', 'Recibido', 'Administrativa NC', 'Muestra de Fraccionados', 'Orden de Retiro')
          AND COALESCE(p.secuencia, 'Imprimir') NOT IN ('Standby', 'STANDBY', 'Entregado', 'Finalizado', 'Cancelado')
          AND COALESCE(p.estado_logistico, '') NOT IN ('ENTREGADO', 'ENTREGADO_DEPOSITO')
          AND p.factura_id IS NULL
          AND p.id_factura_lomasoft IS NULL
          AND (p.comprobante_lomasoft IS NULL OR p.comprobante_lomasoft = '')
        GROUP BY pd.articulo
      ),
      nodos_reservas_temporales_lineas ${materializedTag} (
        SELECT
          COALESCE(NULLIF(BTRIM(npi.sku_nodo), ''), nac.sku_nodo) AS sku_ref,
          npi.cantidad::numeric AS cant,
          COALESCE(npi.es_combo, nac.es_combo, false) AS es_combo_flag,
          npi.componentes_combo_snapshot
        FROM public.nodos_pedidos_items npi
        JOIN public.nodos_pedidos_vecinos npv ON npv.id = npi.pedido_id
        LEFT JOIN public.nodos_articulos_catalogo nac ON nac.id = npi.articulo_catalogo_id
        WHERE npv.presupuesto_id_local IS NULL
          AND npv.reserva_stock_estado = 'ACTIVA'
          AND npv.reserva_stock_expira_at > NOW()
          AND COALESCE(npv.estado_operativo, '') <> 'ANULADO'
          AND COALESCE(npv.stock_descontado_deposito, false) = false
          AND COALESCE(npv.stock_descontado_fulfillment, false) = false
      ),
      pedidos_activos_pre_explosion ${materializedTag} (
        SELECT
          COALESCE(src1_r.articulo_numero, src2_r.articulo_numero, ba1_r.articulo_id, ba2_r.articulo_id, a1_r.numero, a2_r.numero, u.sku_ref) AS articulo_numero,
          u.cant,
          COALESCE(ba_eff.es_combo, u.es_combo_flag, false) AS es_combo_eff,
          u.componentes_combo_snapshot
        FROM (
          SELECT sku_ref, cant, false AS es_combo_flag, NULL::jsonb AS componentes_combo_snapshot
          FROM presupuestos_lineas_crudos
          UNION ALL
          SELECT sku_ref, cant, es_combo_flag, componentes_combo_snapshot
          FROM nodos_reservas_temporales_lineas
          WHERE sku_ref IS NOT NULL AND BTRIM(sku_ref) <> ''
        ) u
        LEFT JOIN public.stock_real_consolidado src1_r ON src1_r.articulo_numero = u.sku_ref
        LEFT JOIN public.stock_real_consolidado src2_r ON src2_r.codigo_barras = u.sku_ref
        LEFT JOIN public.bunker_articulos ba1_r ON ba1_r.articulo_id = u.sku_ref
        LEFT JOIN public.bunker_articulos ba2_r ON ba2_r.codigo_barras = u.sku_ref
        LEFT JOIN public.articulos a1_r ON a1_r.numero = u.sku_ref
        LEFT JOIN public.articulos a2_r ON a2_r.codigo_barras = u.sku_ref
        LEFT JOIN public.bunker_articulos ba_eff
          ON UPPER(BTRIM(ba_eff.articulo_id)) = UPPER(BTRIM(COALESCE(src1_r.articulo_numero, src2_r.articulo_numero, ba1_r.articulo_id, ba2_r.articulo_id, a1_r.numero, a2_r.numero, u.sku_ref)))
      ),
      reservas_crudas ${materializedTag} (
        SELECT
          ex.articulo_numero,
          SUM(ex.cant)::numeric(14,3) AS cantidad_reservada
        FROM (
          -- Rama A: Artículos simples o packs (no combo)
          SELECT p.articulo_numero, p.cant
          FROM pedidos_activos_pre_explosion p
          WHERE p.es_combo_eff = false

          UNION ALL

          -- Rama B: Combos Nodos con snapshot inmutable de componentes
          SELECT
            COALESCE(NULLIF(BTRIM(snap.elem->>'sku'), ''), snap.elem->>'componente_articulo_id') AS articulo_numero,
            (p.cant * GREATEST(1, COALESCE((snap.elem->>'cantidad')::numeric, 1))) AS cant
          FROM pedidos_activos_pre_explosion p
          CROSS JOIN LATERAL jsonb_array_elements(p.componentes_combo_snapshot) AS snap(elem)
          WHERE p.es_combo_eff = true
            AND p.componentes_combo_snapshot IS NOT NULL
            AND jsonb_typeof(p.componentes_combo_snapshot) = 'array'
            AND jsonb_array_length(p.componentes_combo_snapshot) > 0

          UNION ALL

          -- Rama C: Combos en presupuestos o sin snapshot -> explosión viva en bunker_combos_componentes
          SELECT
            bcc.componente_articulo_id AS articulo_numero,
            (p.cant * COALESCE(bcc.cantidad, 1)) AS cant
          FROM pedidos_activos_pre_explosion p
          JOIN public.bunker_combos_componentes bcc
            ON UPPER(BTRIM(bcc.combo_articulo_id)) = UPPER(BTRIM(p.articulo_numero))
          WHERE p.es_combo_eff = true
            AND (
              p.componentes_combo_snapshot IS NULL
              OR jsonb_typeof(p.componentes_combo_snapshot) <> 'array'
              OR jsonb_array_length(p.componentes_combo_snapshot) = 0
            )
        ) ex
        WHERE ex.articulo_numero IS NOT NULL AND BTRIM(ex.articulo_numero) <> ''
        GROUP BY ex.articulo_numero
      )${reservasPadresCte}${stockPorBarrasCte}
    `;
}

/**
 * Obtiene un Map<SKU_UPPER, { stock_fisico, stock_reservado, stock_disponible }> considerando
 * presupuestos activos + reservas PENDIENTE_TRANSFERENCIA + packs + explosión de combos LDN 8.
 */
async function obtenerMapaStockDisponibleNetoPorSku(runner, skus = null) {
    const filtro = Array.isArray(skus) && skus.length > 0
        ? skus.map(s => String(s || '').trim().toUpperCase()).filter(Boolean)
        : null;
    const params = [];
    const whereSku = filtro ? (params.push(filtro), 'WHERE UPPER(BTRIM(ba.articulo_id)) = ANY($1::text[])') : '';

    const sql = `
      ${construirCteReservasUnificadas({ incluirReservasPadres: true, incluirStockPorBarras: false })}
      SELECT
        UPPER(BTRIM(ba.articulo_id)) AS sku_key,
        CASE
          WHEN (COALESCE(ba.es_pack, false) = true OR ba.pack_hijo_codigo IS NOT NULL) AND COALESCE(ba.pack_unidades, 1) > 1
          THEN COALESCE(src.stock_consolidado, 0) + FLOOR(COALESCE(src_hijo.stock_consolidado, 0) / COALESCE(ba.pack_unidades, 1))
          ELSE COALESCE(src.stock_consolidado, 0)
        END::numeric(14,3) AS stock_fisico,
        CASE
          WHEN (COALESCE(ba.es_pack, false) = true OR ba.pack_hijo_codigo IS NOT NULL) AND COALESCE(ba.pack_unidades, 1) > 1
          THEN COALESCE(res_art.cantidad_reservada, 0) + CEIL(COALESCE(res_hijo.cantidad_reservada, 0) / COALESCE(ba.pack_unidades, 1)::numeric)
          ELSE COALESCE(res_art.cantidad_reservada, 0) + COALESCE(res_padres.reservado_en_packs, 0)
        END::numeric(14,3) AS stock_reservado,
        CASE
          WHEN (COALESCE(ba.es_pack, false) = true OR ba.pack_hijo_codigo IS NOT NULL) AND COALESCE(ba.pack_unidades, 1) > 1
          THEN
            GREATEST(0, COALESCE(src.stock_consolidado, 0) - COALESCE(res_art.cantidad_reservada, 0)) +
            FLOOR(
              GREATEST(0,
                COALESCE(src_hijo.stock_consolidado, 0) - (
                  COALESCE(res_hijo.cantidad_reservada, 0) + (COALESCE(res_art.cantidad_reservada, 0) * COALESCE(ba.pack_unidades, 1))
                )
              ) / COALESCE(ba.pack_unidades, 1)
            )
          ELSE
            GREATEST(0, COALESCE(src.stock_consolidado, 0) - (COALESCE(res_art.cantidad_reservada, 0) + COALESCE(res_padres.reservado_en_packs, 0)))
        END::numeric(14,3) AS stock_disponible
      FROM public.bunker_articulos ba
      LEFT JOIN public.stock_real_consolidado src ON (src.articulo_numero = ba.articulo_id OR src.codigo_barras = ba.articulo_id)
      LEFT JOIN public.stock_real_consolidado src_hijo ON (
        src_hijo.articulo_numero = ba.pack_hijo_codigo OR src_hijo.codigo_barras = ba.pack_hijo_codigo
      )
      LEFT JOIN reservas_crudas res_art ON UPPER(BTRIM(res_art.articulo_numero)) = UPPER(BTRIM(ba.articulo_id))
      LEFT JOIN reservas_crudas res_hijo ON UPPER(BTRIM(res_hijo.articulo_numero)) = UPPER(BTRIM(src_hijo.articulo_numero))
      LEFT JOIN reservas_padres res_padres ON UPPER(BTRIM(res_padres.pack_hijo_codigo)) = UPPER(BTRIM(ba.articulo_id))
      ${whereSku}
    `;

    const res = await runner.query(sql, params);
    const map = new Map();
    for (const r of res.rows) {
        map.set(r.sku_key, {
            stock_fisico: Number(r.stock_fisico || 0),
            stock_reservado: Number(r.stock_reservado || 0),
            stock_disponible: Math.max(0, Number(r.stock_disponible || 0))
        });
    }
    return map;
}

module.exports = {
    construirCteReservasUnificadas,
    obtenerMapaStockDisponibleNetoPorSku
};
