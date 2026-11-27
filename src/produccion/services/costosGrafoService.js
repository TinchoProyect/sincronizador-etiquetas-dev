'use strict';

/**
 * Motor Unificado de Costos y Precios sobre el Grafo Completo LAMDA (Etapa 2)
 * ---------------------------------------------------------------------------
 * Modela determinísticamente en memoria (Snapshot -> Subgrafo Impactado -> Simulación -> Aplicación)
 * las 7 capas del circuito real de costos:
 *   LDN 1 (Bulto Cerrado Directo)
 *   -> LDN 4 (Tostaderos / UP Simple)
 *   -> LDN 3 (Mixes & Pre-Mezclas FORMULA_INTERNA -> Puentes Elaborados)
 *   -> LDN 5 (Barritas UNIDADES_POR_TANDA)
 *   -> LDN 6 (Granolas Doble Mezcla + Merma Horno + Post-Horno)
 *   -> LDN 2 (Fraccionados Mono/Mix/Elaborado + Packs Multi-Unidad)
 *   -> LDN 8 (Combos Compuestos)
 *   -> Listas Comerciales B2B (public.bunker_lista_articulos)
 *   -> Canal Nodos Escalón 1 (nodos_articulos_catalogo) y Escalón 2 (nodos_ofertas_gestor)
 *
 * Blindajes sellados:
 *  1. Un Bulto LDN 1 compartido por 2+ ingredientes de distinta calidad (p.ej. PRx10 -> #35/#59,
 *     AGRX10Q -> #74/#117) jamás iguala calidades ni propaga a ciegas sin selección explícita.
 *  2. simularCascada es 100% solo lectura; aplicarCascada preserva margen_gestor_pct y recalcula
 *     precio_venta_vecino, ganancia_unitaria_gestor y alerta_cambio_costo = true.
 *  3. Cualquier insumo activo con costo <= $0,00 (p.ej. #156 en HDMCX5 o #183 en CRx5) dispara
 *     alerta_costo_cero y bloquea únicamente su rama sin frenar ni pisar el resto del grafo.
 *  4. Recetas huérfanas sin fila en public.bunker_articulos se omiten limpiamente sin errores.
 */

const defaultPool = require('../config/database');
const historialPreciosService = require('./historialPreciosService');
const { triggerB2BSync } = require('../../actualizaPrecios/b2bAutoSyncTrigger');

const normSku = (s) => String(s || '').trim().toUpperCase();
const round2 = (n) => {
    const val = Number(n) || 0;
    return Math.round((val + Math.sign(val) * 1e-11) * 100) / 100;
};
const round3 = (n) => Number((Number(n) || 0).toFixed(3));
const round4 = (n) => Number((Number(n) || 0).toFixed(4));

function calcularPrecioB2BLista(listaRow, kilosUnidad, costoBaseKilo, insumosTotal, overrideUsoCostoBase = null, opciones = {}) {
    if (String(listaRow.modo_calculo || 'AUTOMATIC').toUpperCase() === 'MANUAL') {
        return {
            omitido_manual: true,
            precio_final: round2(listaRow.precio_final),
            cBaseKg: overrideUsoCostoBase !== null ? Number(overrideUsoCostoBase) : Number(costoBaseKilo || 0)
        };
    }
    const kilos = Math.max(0.001, Number(kilosUnidad) || 1);
    const cBaseKg = overrideUsoCostoBase !== null
        ? Number(overrideUsoCostoBase)
        : (listaRow.costo_base_sobrescrito !== null && listaRow.costo_base_sobrescrito !== undefined
            ? Number(listaRow.costo_base_sobrescrito)
            : Number(costoBaseKilo || 0));
    const baseBulto = (cBaseKg * kilos) + Number(insumosTotal || 0);
    const mo = listaRow.mano_obra_activa === false ? 0 : Number(listaRow.costo_tiempo || 0);
    const margen = Number(listaRow.margen_ganancia || 0);
    const ivaArt = opciones.porcentajeIvaArticulo !== undefined && opciones.porcentajeIvaArticulo !== null
        ? Number(opciones.porcentajeIvaArticulo)
        : null;
    const ivaBase = Number(listaRow.iva ?? ivaArt ?? 21);
    const modoIva = String(listaRow.modo_iva || 'COMPLETO').trim().toUpperCase();
    // En BD bunker_lista_articulos.iva guarda la alícuota ya aplicada (art.porcentaje_iva / 2 cuando es MEDIO).
    const ivaPct = modoIva === 'MEDIO'
        ? ((ivaArt !== null ? ivaArt : ivaBase) / 2)
        : (['SIN', 'EXENTO', 'NO'].includes(modoIva) ? 0 : ivaBase);
    const neto = baseBulto * (1 + (margen / 100)) + mo;
    const rawConIva = neto * (1 + (ivaPct / 100));
    const esCanalNodos = String(opciones.canalComercial || '').trim().toUpperCase() === 'NODOS';
    const precioFinal = esCanalNodos ? Math.round(rawConIva) : round2(rawConIva);
    return {
        omitido_manual: false,
        precio_final: precioFinal,
        cBaseKg
    };
}

function calcularEscalon2OfertaGestor(precioBaseNodoFinal, margenGestorPct, ivaPct = 21, iibbPct = 4) {
    const base = Math.max(0, Number(precioBaseNodoFinal) || 0);
    const margen = Number.isFinite(Number(margenGestorPct)) ? Number(margenGestorPct) : 0;
    const iva = Number.isFinite(Number(ivaPct)) && Number(ivaPct) >= 0 ? Math.min(90, Number(ivaPct)) : 21;
    const iibb = Number.isFinite(Number(iibbPct)) && Number(iibbPct) >= 0 ? Math.min(90, Number(iibbPct)) : 4;
    const precioVentaVecino = base > 0 ? Math.round(base * (1 + margen / 100)) : 0;
    const excedente = Math.max(0, round2(precioVentaVecino - base));
    const factorNeto = Math.max(0.01, (1 / (1 + iva / 100)) - (iibb / 100));
    const gananciaUnitariaGestor = Math.round(excedente * factorNeto);
    const retencionFiscalUnitaria = Math.max(0, round2(excedente - gananciaUnitariaGestor));
    return {
        margen_gestor_pct: round2(margen),
        precio_venta_vecino: precioVentaVecino,
        ganancia_unitaria_gestor: gananciaUnitariaGestor,
        retencion_fiscal_unitaria: retencionFiscalUnitaria
    };
}

/**
 * Carga en memoria un snapshot consistente y determinista del grafo completo de costos LAMDA.
 * 100% solo lectura (no modifica base de datos ni dispara llamadas externas).
 */
async function cargarSnapshotGrafo(runner = defaultPool) {
    const q = runner || defaultPool;
    const [
        ingRes,
        ibaRes,
        compRes,
        upRes,
        artRes,
        tarifasRes,
        recRes,
        riRes,
        listasRes,
        laRes,
        liRes,
        catRes,
        ofeRes,
        combRes
    ] = await Promise.all([
        q.query(`
            SELECT id, codigo, nombre, articulo_vinculado_numero,
                   COALESCE(costo_patron, 0)::numeric(14,2) AS costo_patron,
                   COALESCE(es_insumo, false) AS es_insumo,
                   COALESCE(rol_ingrediente, 'MATERIA_PRIMA') AS rol_ingrediente,
                   COALESCE(habilitado_solicitud_nodos, true) AS habilitado_solicitud_nodos,
                   COALESCE(NULLIF(receta_base_kg, 0), 1)::numeric(12,4) AS receta_base_kg
            FROM public.ingredientes
            ORDER BY id ASC
        `),
        q.query(`
            SELECT ingrediente_id, bunker_articulo_id, COALESCE(es_vinculo_costo_primario, false) AS es_vinculo_costo_primario
            FROM public.ingrediente_bunker_articulos
            ORDER BY ingrediente_id ASC, bunker_articulo_id ASC
        `),
        q.query(`
            SELECT mix_id, ingrediente_id, COALESCE(cantidad, 0)::numeric(14,4) AS cantidad
            FROM public.ingrediente_composicion
            ORDER BY mix_id ASC, id ASC
        `),
        q.query(`
            SELECT id, articulo_produccion_codigo, articulo_kilo_codigo,
                   COALESCE(multiplicador_ingredientes, 1)::numeric(12,4) AS multiplicador_ingredientes,
                   ingredientes_custom,
                   linea_negocio, modo_rendimiento,
                   peso_unitario_salida_kg, unidades_por_tanda_default,
                   articulo_premezcla_codigo, ingrediente_espejo_id,
                   tarifa_maquila_default, unidad_tarifa_maquila,
                   merma_default_pct, insumos_fase_externa_json
            FROM public.articulos_produccion_externa_relacion
            ORDER BY id ASC
        `),
        q.query(`
            SELECT articulo_id, descripcion, descripcion_generada,
                   COALESCE(NULLIF(kilos_unidad, 0), 1)::numeric(12,4) AS kilos_unidad,
                   COALESCE(costo_base, 0)::numeric(14,2) AS costo_base,
                   COALESCE(porcentaje_iva, 21)::numeric(6,2) AS porcentaje_iva,
                   COALESCE(es_pack, false) AS es_pack,
                   COALESCE(pack_unidades, 1) AS pack_unidades,
                   pack_hijo_codigo,
                   COALESCE(es_combo, false) AS es_combo,
                   firma_combo,
                   familia_id,
                   minutos_mano_obra,
                   tarifa_colaborador_id,
                   propiedades_dinamicas
            FROM public.bunker_articulos
            ORDER BY articulo_id ASC
        `),
        q.query(`
            SELECT id, usuario_id, COALESCE(valor_hora, 7000)::numeric(12,2) AS valor_hora
            FROM public.colaboradores_tarifas
        `),
        q.query(`
            SELECT DISTINCT ON (UPPER(BTRIM(articulo_numero)))
                   id, articulo_numero, articulo_sugerido_numero, fecha_creacion
            FROM public.recetas
            ORDER BY UPPER(BTRIM(articulo_numero)), fecha_creacion DESC NULLS LAST, id DESC
        `),
        q.query(`
            SELECT receta_id, ingrediente_id, nombre_ingrediente, unidad_medida,
                   COALESCE(cantidad, 0)::numeric(14,4) AS cantidad,
                   COALESCE(fase_produccion, 'interna') AS fase_produccion
            FROM public.receta_ingredientes
            ORDER BY id ASC
        `),
        q.query(`
            SELECT id, nombre, COALESCE(canal_comercial, 'MAYORISTA') AS canal_comercial, COALESCE(activa, true) AS activa
            FROM public.bunker_listas_precios
            ORDER BY id ASC
        `),
        q.query(`
            SELECT id, lista_id, articulo_numero,
                   COALESCE(margen_ganancia, 0) AS margen_ganancia,
                   costo_base_sobrescrito,
                   COALESCE(costo_tiempo, 0) AS costo_tiempo,
                   COALESCE(iva, 21) AS iva,
                   COALESCE(precio_final, 0) AS precio_final,
                   COALESCE(modo_calculo, 'AUTOMATIC') AS modo_calculo,
                   COALESCE(modo_iva, 'COMPLETO') AS modo_iva,
                   COALESCE(es_patron, false) AS es_patron,
                   COALESCE(disponible, false) AS disponible,
                   COALESCE(mano_obra_activa, true) AS mano_obra_activa
            FROM public.bunker_lista_articulos
            ORDER BY id ASC
        `),
        q.query(`
            SELECT lista_articulo_id, insumo_articulo_numero,
                   COALESCE(cantidad, 0)::numeric(12,4) AS cantidad,
                   COALESCE(incluido, false) AS incluido,
                   COALESCE(costo_unitario_capturado, 0)::numeric(14,2) AS costo_unitario_capturado
            FROM public.bunker_lista_insumos
            ORDER BY id ASC
        `),
        q.query(`
            SELECT id, sku_nodo, nombre_publico, flujo_lamda, origen_tipo,
                   ingrediente_origen_id, articulo_bunker_origen_codigo,
                   COALESCE(NULLIF(kilos_unidad, 0), 0.25)::numeric(12,4) AS kilos_unidad,
                   insumo_envase_id,
                   COALESCE(cantidad_envases_unidad, 1)::numeric(10,2) AS cantidad_envases_unidad,
                   COALESCE(segundos_fraccionamiento, 300)::numeric(10,2) AS segundos_fraccionamiento,
                   tarifa_colaborador_id,
                   COALESCE(valor_hora_aplicado, 7000)::numeric(12,2) AS valor_hora_aplicado,
                   COALESCE(costo_insumo_kg, 0)::numeric(14,2) AS costo_insumo_kg,
                   COALESCE(costo_insumo_fraccion, 0)::numeric(14,2) AS costo_insumo_fraccion,
                   COALESCE(costo_envase_aplicado, 0)::numeric(14,2) AS costo_envase_aplicado,
                   COALESCE(costo_mano_obra_aplicado, 0)::numeric(14,2) AS costo_mano_obra_aplicado,
                   COALESCE(margen_lamda_pct, 22)::numeric(8,2) AS margen_lamda_pct,
                   COALESCE(iva_pct, 21)::numeric(6,2) AS iva_pct,
                   COALESCE(iibb_pct, 4)::numeric(6,2) AS iibb_pct,
                   COALESCE(costo_puro_total, 0)::numeric(14,2) AS costo_puro_total,
                   COALESCE(precio_base_nodo_neto, 0)::numeric(14,2) AS precio_base_nodo_neto,
                   COALESCE(precio_base_nodo_final, 0)::numeric(14,2) AS precio_base_nodo_final,
                   COALESCE(margen_sugerido_gestor_pct, 28)::numeric(8,2) AS margen_sugerido_gestor_pct,
                   COALESCE(es_combo, false) AS es_combo,
                   COALESCE(activo, true) AS activo
            FROM public.nodos_articulos_catalogo
            WHERE COALESCE(activo, true) = true
            ORDER BY id ASC
        `),
        q.query(`
            SELECT og.id, og.nodo_id, og.articulo_catalogo_id,
                   COALESCE(og.precio_base_nodo_snapshot, 0)::numeric(14,2) AS precio_base_nodo_snapshot,
                   COALESCE(og.margen_gestor_pct, 28)::numeric(8,2) AS margen_gestor_pct,
                   COALESCE(og.precio_venta_vecino, 0)::numeric(14,2) AS precio_venta_vecino,
                   og.precio_venta_vecino_anterior::numeric(14,2) AS precio_venta_vecino_anterior,
                   COALESCE(og.ganancia_unitaria_gestor, 0)::numeric(14,2) AS ganancia_unitaria_gestor,
                   COALESCE(og.publicado_tienda, false) AS publicado_tienda,
                   COALESCE(og.alerta_cambio_costo, false) AS alerta_cambio_costo,
                   COALESCE(nm.alicuota_iva_margen_pct, 21)::numeric(6,2) AS alicuota_iva_margen_pct,
                   COALESCE(nm.alicuota_iibb_margen_pct, 4)::numeric(6,2) AS alicuota_iibb_margen_pct,
                   nm.lista_precio_bunker_id,
                   nm.nombre_marca,
                   nm.slug
            FROM public.nodos_ofertas_gestor og
            JOIN public.nodos_maestro nm ON nm.id = og.nodo_id
            ORDER BY og.id ASC
        `),
        q.query(`
            SELECT combo_articulo_id, componente_articulo_id, COALESCE(cantidad, 1)::numeric(12,4) AS cantidad, orden
            FROM public.bunker_combos_componentes
            ORDER BY combo_articulo_id ASC, orden ASC, id ASC
        `)
    ]);

    const ingById = new Map();
    for (const r of ingRes.rows) {
        ingById.set(Number(r.id), {
            ...r,
            id: Number(r.id),
            costo_patron: Number(r.costo_patron || 0),
            receta_base_kg: Number(r.receta_base_kg || 1)
        });
    }

    const mixesById = new Map();
    for (const c of compRes.rows) {
        const mId = Number(c.mix_id);
        if (!mixesById.has(mId)) mixesById.set(mId, []);
        mixesById.get(mId).push({
            ingrediente_id: Number(c.ingrediente_id),
            cantidad: Number(c.cantidad || 0)
        });
    }

    const tarifaHoraById = new Map();
    for (const t of tarifasRes.rows) {
        tarifaHoraById.set(Number(t.id), Number(t.valor_hora || 7000));
    }

    const artBySku = new Map();
    for (const a of artRes.rows) {
        const key = normSku(a.articulo_id);
        artBySku.set(key, {
            ...a,
            sku_key: key,
            kilos_unidad: Number(a.kilos_unidad || 1),
            costo_base: Number(a.costo_base || 0),
            porcentaje_iva: Number(a.porcentaje_iva ?? 21),
            pack_unidades: Number(a.pack_unidades || 1),
            minutos_mano_obra: a.minutos_mano_obra !== null && a.minutos_mano_obra !== undefined ? Number(a.minutos_mano_obra) : null,
            tarifa_colaborador_id: a.tarifa_colaborador_id ? Number(a.tarifa_colaborador_id) : null
        });
    }

    // Mapeo Bulto LDN 1 <-> Ingredientes MATERIA_PRIMA (protección multi-calidad PRx10 / AGRX10Q)
    const bultoToMps = new Map();
    const mpToBultos = new Map();
    const registrarVinculoBulto = (bultoSkuRaw, ingIdNum, esPrimario) => {
        const skuK = normSku(bultoSkuRaw);
        const ing = ingById.get(ingIdNum);
        if (!skuK || !ing || ing.es_insumo || ing.rol_ingrediente !== 'MATERIA_PRIMA') return;
        if (!bultoToMps.has(skuK)) bultoToMps.set(skuK, new Map());
        const m = bultoToMps.get(skuK);
        const prev = m.get(ingIdNum);
        m.set(ingIdNum, {
            ingrediente_id: ingIdNum,
            codigo: ing.codigo,
            nombre: ing.nombre,
            costo_patron: ing.costo_patron,
            es_vinculo_costo_primario: Boolean(esPrimario || (prev && prev.es_vinculo_costo_primario))
        });
        if (!mpToBultos.has(ingIdNum)) mpToBultos.set(ingIdNum, new Set());
        mpToBultos.get(ingIdNum).add(skuK);
    };

    for (const rel of ibaRes.rows) {
        registrarVinculoBulto(rel.bunker_articulo_id, Number(rel.ingrediente_id), rel.es_vinculo_costo_primario);
    }
    for (const ing of ingById.values()) {
        if (ing.rol_ingrediente === 'MATERIA_PRIMA' && ing.articulo_vinculado_numero) {
            const skuK = normSku(ing.articulo_vinculado_numero);
            const artLinked = artBySku.get(skuK);
            const yaPrim = bultoToMps.get(skuK)?.get(ing.id)?.es_vinculo_costo_primario;
            if (artLinked && !bultoToMps.get(skuK)?.has(ing.id)) {
                registrarVinculoBulto(ing.articulo_vinculado_numero, ing.id, yaPrim || false);
            }
        }
    }

    const itemsPorRecetaId = new Map();
    for (const ri of riRes.rows) {
        const rid = Number(ri.receta_id);
        if (!itemsPorRecetaId.has(rid)) itemsPorRecetaId.set(rid, []);
        itemsPorRecetaId.get(rid).push({
            ingrediente_id: Number(ri.ingrediente_id),
            nombre_ingrediente: ri.nombre_ingrediente,
            unidad_medida: ri.unidad_medida,
            cantidad: Number(ri.cantidad || 0),
            fase_produccion: ri.fase_produccion
        });
    }

    const recetaBySku = new Map();
    const recetasHuerfanas = [];
    for (const r of recRes.rows) {
        const key = normSku(r.articulo_numero);
        const obj = {
            id: Number(r.id),
            articulo_numero: r.articulo_numero,
            articulo_sugerido_numero: r.articulo_sugerido_numero || null,
            items: itemsPorRecetaId.get(Number(r.id)) || []
        };
        if (artBySku.has(key)) {
            recetaBySku.set(key, obj);
        } else {
            recetasHuerfanas.push(obj);
        }
    }

    const upList = upRes.rows.map(u => ({
        ...u,
        id: Number(u.id),
        linea_negocio: Number(u.linea_negocio || 4),
        ingrediente_espejo_id: u.ingrediente_espejo_id ? Number(u.ingrediente_espejo_id) : null,
        peso_unitario_salida_kg: u.peso_unitario_salida_kg ? Number(u.peso_unitario_salida_kg) : null,
        unidades_por_tanda_default: u.unidades_por_tanda_default ? Number(u.unidades_por_tanda_default) : null,
        tarifa_maquila_default: Number(u.tarifa_maquila_default || 0),
        merma_default_pct: Number(u.merma_default_pct || 0),
        up_key: normSku(u.articulo_produccion_codigo),
        ap_key: normSku(u.articulo_kilo_codigo),
        pre_key: normSku(u.articulo_premezcla_codigo)
    }));
    const upByApSku = new Map(upList.filter(u => u.ap_key).map(u => [u.ap_key, u]));
    const upByPreSku = new Map(upList.filter(u => u.pre_key).map(u => [u.pre_key, u]));
    const upByEspejoId = new Map(upList.filter(u => u.ingrediente_espejo_id).map(u => [u.ingrediente_espejo_id, u]));

    const listaById = new Map(listasRes.rows.map(l => [Number(l.id), l]));
    const insumosPorListaArtId = new Map();
    for (const li of liRes.rows) {
        const lid = Number(li.lista_articulo_id);
        if (!insumosPorListaArtId.has(lid)) insumosPorListaArtId.set(lid, []);
        insumosPorListaArtId.get(lid).push({
            insumo_articulo_numero: li.insumo_articulo_numero,
            cantidad: Number(li.cantidad || 0),
            incluido: Boolean(li.incluido),
            costo_unitario_capturado: Number(li.costo_unitario_capturado || 0)
        });
    }

    const listaArticulosBySku = new Map();
    const listaArticulosById = new Map();
    for (const la of laRes.rows) {
        const skuK = normSku(la.articulo_numero);
        const row = {
            ...la,
            id: Number(la.id),
            lista_id: Number(la.lista_id),
            sku_key: skuK,
            margen_ganancia: Number(la.margen_ganancia || 0),
            costo_base_sobrescrito: la.costo_base_sobrescrito !== null && la.costo_base_sobrescrito !== undefined ? Number(la.costo_base_sobrescrito) : null,
            costo_tiempo: Number(la.costo_tiempo || 0),
            iva: Number(la.iva ?? 21),
            precio_final: Number(la.precio_final || 0)
        };
        listaArticulosById.set(row.id, row);
        if (!listaArticulosBySku.has(skuK)) listaArticulosBySku.set(skuK, []);
        listaArticulosBySku.get(skuK).push(row);
    }

    const catalogoBySku = new Map();
    const catalogoById = new Map();
    for (const c of catRes.rows) {
        const row = {
            ...c,
            id: Number(c.id),
            sku_key: normSku(c.sku_nodo),
            ingrediente_origen_id: c.ingrediente_origen_id ? Number(c.ingrediente_origen_id) : null,
            insumo_envase_id: c.insumo_envase_id ? Number(c.insumo_envase_id) : null,
            kilos_unidad: Number(c.kilos_unidad || 0.25),
            cantidad_envases_unidad: Number(c.cantidad_envases_unidad ?? 1),
            segundos_fraccionamiento: Number(c.segundos_fraccionamiento ?? 300),
            valor_hora_aplicado: Number(c.valor_hora_aplicado ?? 7000),
            costo_insumo_kg: Number(c.costo_insumo_kg || 0),
            costo_insumo_fraccion: Number(c.costo_insumo_fraccion || 0),
            costo_envase_aplicado: Number(c.costo_envase_aplicado || 0),
            costo_mano_obra_aplicado: Number(c.costo_mano_obra_aplicado || 0),
            margen_lamda_pct: Number(c.margen_lamda_pct ?? 22),
            iva_pct: Number(c.iva_pct ?? 21),
            iibb_pct: Number(c.iibb_pct ?? 4),
            costo_puro_total: Number(c.costo_puro_total || 0),
            costo_base_nodo_neto: Number(c.precio_base_nodo_neto || 0),
            precio_base_nodo_neto: Number(c.precio_base_nodo_neto || 0),
            precio_base_nodo_final: Number(c.precio_base_nodo_final || 0),
            margen_sugerido_gestor_pct: Number(c.margen_sugerido_gestor_pct ?? 28)
        };
        catalogoById.set(row.id, row);
        catalogoBySku.set(row.sku_key, row);
    }

    const ofertasPorCatalogoId = new Map();
    for (const o of ofeRes.rows) {
        const cid = Number(o.articulo_catalogo_id);
        if (!ofertasPorCatalogoId.has(cid)) ofertasPorCatalogoId.set(cid, []);
        ofertasPorCatalogoId.get(cid).push({
            ...o,
            id: Number(o.id),
            nodo_id: Number(o.nodo_id),
            articulo_catalogo_id: cid,
            precio_base_nodo_snapshot: Number(o.precio_base_nodo_snapshot || 0),
            margen_gestor_pct: Number(o.margen_gestor_pct || 0),
            precio_venta_vecino: Number(o.precio_venta_vecino || 0),
            precio_venta_vecino_anterior: o.precio_venta_vecino_anterior !== null && o.precio_venta_vecino_anterior !== undefined
                ? Number(o.precio_venta_vecino_anterior)
                : null,
            ganancia_unitaria_gestor: Number(o.ganancia_unitaria_gestor || 0),
            alicuota_iva_margen_pct: Number(o.alicuota_iva_margen_pct ?? 21),
            alicuota_iibb_margen_pct: Number(o.alicuota_iibb_margen_pct ?? 4),
            lista_precio_bunker_id: o.lista_precio_bunker_id ? Number(o.lista_precio_bunker_id) : null
        });
    }

    const comboCompsPorSku = new Map();
    for (const cc of combRes.rows) {
        const ck = normSku(cc.combo_articulo_id);
        if (!comboCompsPorSku.has(ck)) comboCompsPorSku.set(ck, []);
        comboCompsPorSku.get(ck).push({
            componente_key: normSku(cc.componente_articulo_id),
            componente_articulo_id: cc.componente_articulo_id,
            cantidad: Number(cc.cantidad || 1)
        });
    }

    // Mapeo Mixes FORMULA_INTERNA -> Artículo/Ingrediente Puente Elaborado (cuando no es UP pre-mezcla)
    const mixToPuente = new Map();
    for (const rec of recetaBySku.values()) {
        const artRec = artBySku.get(normSku(rec.articulo_numero));
        if (!artRec || upByPreSku.has(normSku(rec.articulo_numero))) continue;
        const mixItem = rec.items.find(it => mixesById.has(it.ingrediente_id));
        if (!mixItem) continue;
        for (const ing of ingById.values()) {
            if (
                ing.rol_ingrediente === 'PUENTE_ELABORADO' &&
                ing.articulo_vinculado_numero &&
                normSku(ing.articulo_vinculado_numero) === normSku(rec.articulo_numero)
            ) {
                mixToPuente.set(mixItem.ingrediente_id, {
                    ap_key: normSku(rec.articulo_numero),
                    ap_sku: rec.articulo_numero,
                    puente_ingrediente_id: ing.id,
                    mix_cantidad: mixItem.cantidad
                });
            }
        }
    }

    return {
        ingById,
        bultoToMps,
        mpToBultos,
        mixesById,
        mixToPuente,
        upList,
        upByApSku,
        upByPreSku,
        upByEspejoId,
        artBySku,
        tarifaHoraById,
        recetaBySku,
        recetasHuerfanas,
        listaById,
        listaArticulosBySku,
        listaArticulosById,
        insumosPorListaArtId,
        catalogoBySku,
        catalogoById,
        ofertasPorCatalogoId,
        comboCompsPorSku
    };
}

function resolverMoKiloArticulo(snapshot, artSkuKey) {
    const listaRows = snapshot.listaArticulosBySku.get(artSkuKey) || [];
    const art = snapshot.artBySku.get(artSkuKey);
    const kilos = Math.max(0.001, Number(art?.kilos_unidad || 1));
    const patronRow = listaRows.find(r => r.es_patron)
        || listaRows.find(r => r.lista_id === 1)
        || listaRows[0];
    if (patronRow) {
        const mo = patronRow.mano_obra_activa === false ? 0 : Number(patronRow.costo_tiempo || 0);
        return round2(mo / kilos);
    }
    if (art && art.minutos_mano_obra && Number(art.minutos_mano_obra) > 0) {
        const vh = snapshot.tarifaHoraById.get(art.tarifa_colaborador_id) || 7000;
        return round2(((Number(art.minutos_mano_obra) * vh) / 60) / kilos);
    }
    return 0;
}

function resolverMoBultoHijoL1(snapshot, hijoKey) {
    const listaRows = snapshot.listaArticulosBySku.get(hijoKey) || [];
    const l1 = listaRows.find(r => r.lista_id === 1)
        || listaRows.find(r => r.es_patron)
        || listaRows[0];
    if (l1) {
        return l1.mano_obra_activa === false ? 0 : Number(l1.costo_tiempo || 0);
    }
    const art = snapshot.artBySku.get(hijoKey);
    if (art && art.minutos_mano_obra && Number(art.minutos_mano_obra) > 0) {
        const vh = snapshot.tarifaHoraById.get(art.tarifa_colaborador_id) || 7000;
        return round2((Number(art.minutos_mano_obra) * vh) / 60);
    }
    return 0;
}

function resolverInsumosLista(snapshot, listaArtRow, artCostosBase) {
    const insRows = snapshot.insumosPorListaArtId.get(listaArtRow.id) || [];
    let total = 0;
    for (const ins of insRows) {
        if (!ins.incluido) continue;
        const keyStr = String(ins.insumo_articulo_numero || '').trim();
        const skuK = normSku(keyStr);
        let unitCost = ins.costo_unitario_capturado;
        if (/^\d+$/.test(keyStr) && snapshot.ingById.has(Number(keyStr))) {
            unitCost = snapshot.ingById.get(Number(keyStr)).costo_patron;
        } else if (artCostosBase.has(skuK)) {
            unitCost = artCostosBase.get(skuK);
        }
        total += Number(ins.cantidad || 0) * Number(unitCost || 0);
    }
    return round2(total);
}

/**
 * Dado un snapshot y un disparador, identifica qué nodos del grafo están aguas abajo
 * (o todo el grafo si `tipo === 'FULL_GRAPH'`).
 */
function resolverSubgrafoImpactado(snapshot, disparador = {}) {
    const tipo = String(disparador.tipo || 'FULL_GRAPH').trim().toUpperCase();
    if (tipo === 'FULL_GRAPH') {
        return {
            full: true,
            ingImpactados: new Set(snapshot.ingById.keys()),
            artImpactados: new Set(snapshot.artBySku.keys()),
            mixImpactados: new Set(snapshot.mixesById.keys()),
            upImpactadas: new Set(snapshot.upList.map(u => u.id)),
            calidades_candidatas: [],
            requiere_seleccion_calidad: false
        };
    }

    const ingImpactados = new Set();
    const artImpactados = new Set();
    const mixImpactados = new Set();
    const upImpactadas = new Set();

    if (tipo === 'INGREDIENTE') {
        const ingId = Number(disparador.ingrediente_id || 0);
        if (ingId > 0 && snapshot.ingById.has(ingId)) {
            ingImpactados.add(ingId);
        }
    } else if (tipo === 'ARTICULO_BUNKER') {
        const skuK = normSku(disparador.articulo_id);
        if (skuK && snapshot.artBySku.has(skuK)) {
            artImpactados.add(skuK);
            const candidatasMap = snapshot.bultoToMps.get(skuK);
            if (candidatasMap && candidatasMap.size > 0) {
                const candidatas = Array.from(candidatasMap.values());
                const calId = Number(disparador.ingrediente_calidad_id || 0);
                if (candidatas.length === 1) {
                    ingImpactados.add(candidatas[0].ingrediente_id);
                } else if (calId > 0) {
                    if (!candidatasMap.has(calId)) {
                        const err = new Error(`El ingrediente #${calId} no está vinculado como calidad de "${disparador.articulo_id}".`);
                        err.statusCode = 400;
                        throw err;
                    }
                    ingImpactados.add(calId);
                } else if (disparador.usar_vinculo_primario === true) {
                    const prims = candidatas.filter(c => c.es_vinculo_costo_primario);
                    if (prims.length === 1) {
                        ingImpactados.add(prims[0].ingrediente_id);
                    } else {
                        return {
                            full: false,
                            requiere_seleccion_calidad: true,
                            articulo_id: snapshot.artBySku.get(skuK).articulo_id,
                            calidades_candidatas: candidatas,
                            ingImpactados,
                            artImpactados,
                            mixImpactados,
                            upImpactadas
                        };
                    }
                } else {
                    return {
                        full: false,
                        requiere_seleccion_calidad: true,
                        articulo_id: snapshot.artBySku.get(skuK).articulo_id,
                        calidades_candidatas: candidatas,
                        ingImpactados,
                        artImpactados,
                        mixImpactados,
                        upImpactadas
                    };
                }
            }
        }
    } else if (tipo === 'PARAMETROS_UP') {
        const relId = Number(disparador.relacion_id || 0);
        const espejoId = Number(disparador.ingrediente_espejo_id || 0);
        const upRow = snapshot.upList.find(u => (relId > 0 && u.id === relId) || (espejoId > 0 && u.ingrediente_espejo_id === espejoId));
        if (upRow) upImpactadas.add(upRow.id);
    }

    // Clausura transitiva hacia abajo en el DAG
    let cambio = true;
    while (cambio) {
        cambio = false;

        // 1. Mixes & Pre-Mezclas que consumen un ingrediente impactado
        for (const [mixId, items] of snapshot.mixesById.entries()) {
            if (!mixImpactados.has(mixId) && items.some(it => ingImpactados.has(it.ingrediente_id))) {
                mixImpactados.add(mixId);
                if (!ingImpactados.has(mixId)) {
                    ingImpactados.add(mixId);
                    cambio = true;
                }
            }
        }

        // 2. Mixes puente no-UP -> su ingrediente espejo PUENTE_ELABORADO + articulo XK
        for (const [mixId, meta] of snapshot.mixToPuente.entries()) {
            if (mixImpactados.has(mixId)) {
                if (!artImpactados.has(meta.ap_key)) {
                    artImpactados.add(meta.ap_key);
                    cambio = true;
                }
                if (!ingImpactados.has(meta.puente_ingrediente_id)) {
                    ingImpactados.add(meta.puente_ingrediente_id);
                    cambio = true;
                }
            }
        }

        // 3. UPs impactadas por pre-mezcla, insumos fase externa o post-horno custom
        for (const u of snapshot.upList) {
            let hit = upImpactadas.has(u.id);
            if (!hit && u.pre_key) {
                const preRec = snapshot.recetaBySku.get(u.pre_key);
                if (preRec && preRec.items.some(it => ingImpactados.has(it.ingrediente_id))) {
                    hit = true;
                    artImpactados.add(u.pre_key);
                }
            }
            if (!hit && u.up_key) {
                const upRec = snapshot.recetaBySku.get(u.up_key);
                if (upRec && upRec.items.some(it => ingImpactados.has(it.ingrediente_id))) hit = true;
                if (upRec && upRec.articulo_sugerido_numero && artImpactados.has(normSku(upRec.articulo_sugerido_numero))) hit = true;
            }
            if (!hit && Array.isArray(u.insumos_fase_externa_json)) {
                if (u.insumos_fase_externa_json.some(it => ingImpactados.has(Number(it.ingrediente_id)))) hit = true;
            }
            if (!hit && Array.isArray(u.ingredientes_custom)) {
                if (u.ingredientes_custom.some(it => ingImpactados.has(Number(it.ingrediente_id)))) hit = true;
            }
            if (!hit && u.ap_key) {
                const apRec = snapshot.recetaBySku.get(u.ap_key);
                if (apRec && apRec.items.some(it => ingImpactados.has(it.ingrediente_id))) hit = true;
                const apArt = snapshot.artBySku.get(u.ap_key);
                const crudoLdn4 = apArt?.propiedades_dinamicas?.fuente_abastecimiento_ldn4?.crudo_sku;
                if (crudoLdn4 && artImpactados.has(normSku(crudoLdn4))) hit = true;
            }
            if (hit) {
                if (!upImpactadas.has(u.id)) {
                    upImpactadas.add(u.id);
                    cambio = true;
                }
                if (u.ap_key && !artImpactados.has(u.ap_key)) {
                    artImpactados.add(u.ap_key);
                    cambio = true;
                }
                if (u.ingrediente_espejo_id && !ingImpactados.has(u.ingrediente_espejo_id)) {
                    ingImpactados.add(u.ingrediente_espejo_id);
                    cambio = true;
                }
            }
        }

        // 4. Recetas LDN 2 (bunker_articulos con receta propia)
        for (const [skuKey, rec] of snapshot.recetaBySku.entries()) {
            if (!artImpactados.has(skuKey) && rec.items.some(it => ingImpactados.has(it.ingrediente_id))) {
                artImpactados.add(skuKey);
                cambio = true;
            }
        }

        // 5. Packs y Combos
        for (const [skuKey, art] of snapshot.artBySku.entries()) {
            if (!artImpactados.has(skuKey) && art.es_pack && art.pack_hijo_codigo) {
                if (artImpactados.has(normSku(art.pack_hijo_codigo))) {
                    artImpactados.add(skuKey);
                    cambio = true;
                }
            }
        }
        for (const [comboKey, comps] of snapshot.comboCompsPorSku.entries()) {
            if (!artImpactados.has(comboKey) && comps.some(c => artImpactados.has(c.componente_key))) {
                artImpactados.add(comboKey);
                cambio = true;
            }
        }
    }

    return {
        full: false,
        requiere_seleccion_calidad: false,
        calidades_candidatas: [],
        ingImpactados,
        artImpactados,
        mixImpactados,
        upImpactadas
    };
}

function clasificarLdnArticulo(snapshot, skuKey) {
    const k = normSku(skuKey);
    const art = snapshot.artBySku.get(k);
    if (!art) return 'LDN_1';
    if (art.es_combo || snapshot.comboCompsPorSku.has(k)) return 'LDN_8';
    const upAp = snapshot.upByApSku.get(k);
    const upPre = snapshot.upByPreSku.get(k);
    const upRef = upAp || upPre;
    if (upRef) {
        if (Number(upRef.linea_negocio) === 5) return 'LDN_5';
        if (Number(upRef.linea_negocio) === 6) return 'LDN_6';
        return 'LDN_4';
    }
    const rec = snapshot.recetaBySku.get(k);
    if (rec && Array.isArray(rec.items) && rec.items.length > 0) {
        const usaMix = rec.items.some(it => snapshot.mixesById.has(Number(it.ingrediente_id)));
        const ingPuente = rec.items.some(it => {
            const meta = snapshot.ingById.get(Number(it.ingrediente_id));
            return meta && meta.rol_ingrediente === 'PUENTE_ELABORADO';
        });
        if (usaMix && !ingPuente) return 'LDN_3';
        return 'LDN_2';
    }
    if (art.es_pack && art.pack_hijo_codigo) return 'LDN_2';
    return 'LDN_1';
}

function normalizarSetLdnsFilter(ldnsSeleccionadas) {
    if (!Array.isArray(ldnsSeleccionadas) || ldnsSeleccionadas.length === 0) return null;
    const set = new Set();
    for (const raw of ldnsSeleccionadas) {
        const s = String(raw || '').trim().toUpperCase();
        if (!s) continue;
        if (/^[1-8]$/.test(s)) {
            set.add(`LDN_${s}`);
        } else if (/^LDN_[1-8]$/.test(s)) {
            set.add(s);
        }
    }
    return set.size > 0 ? set : null;
}

function normalizarSetListasFilter(listasSeleccionadas) {
    if (!Array.isArray(listasSeleccionadas) || listasSeleccionadas.length === 0) return null;
    const set = new Set(listasSeleccionadas.map(Number).filter(n => Number.isFinite(n) && n > 0));
    return set.size > 0 ? set : null;
}

/**
 * Simula la cascada completa en modo sombra (100% solo lectura, 0 escrituras en DB).
 * Soporta filtros selectivos por LDN, Listas B2B, protección de filas MANUAL y opt-in explícito.
 */
async function simularCascada(runner = defaultPool, disparador = {}, opciones = {}) {
    const q = runner || defaultPool;
    const opts = (opciones && typeof opciones === 'object') ? opciones : {};
    const snapshot = await cargarSnapshotGrafo(q);
    const subgrafo = resolverSubgrafoImpactado(snapshot, disparador);

    if (subgrafo.requiere_seleccion_calidad) {
        const prim = subgrafo.calidades_candidatas.find(c => c.es_vinculo_costo_primario) || null;
        return {
            ok: false,
            requiere_seleccion_calidad: true,
            codigo: 'SELECCION_CALIDAD_REQUERIDA',
            articulo_id: subgrafo.articulo_id,
            vinculo_costo_primario_id: prim ? prim.ingrediente_id : null,
            calidades_candidatas: subgrafo.calidades_candidatas,
            mensaje: `El bulto "${subgrafo.articulo_id}" nutre múltiples ingredientes de distinta calidad. Seleccioná explícitamente qué ingrediente recibe la variación para no igualar calidades.`,
            alertas_costo_cero: [],
            cambios: {
                ingredientes: [],
                articulos: [],
                listas_b2b: [],
                listas_manuales_omitidas: [],
                catalogo_nodos: [],
                ofertas_nodos: []
            },
            resumen: { total_cambios: 0, listas_manuales_omitidas: 0 }
        };
    }

    const filtroLdns = normalizarSetLdnsFilter(opts.ldns_seleccionadas ?? disparador.ldns_seleccionadas);
    const filtroListas = normalizarSetListasFilter(opts.listas_seleccionadas ?? disparador.listas_seleccionadas);
    const incluirCanalNodos = opts.incluir_canal_nodos !== undefined
        ? Boolean(opts.incluir_canal_nodos)
        : (disparador.incluir_canal_nodos !== undefined ? Boolean(disparador.incluir_canal_nodos) : true);
    const sobrescribirManuales = Boolean(opts.sobrescribir_manuales || disparador.sobrescribir_manuales);
    const incluirManualesSet = new Set(
        (Array.isArray(opts.incluir_manuales_ids) ? opts.incluir_manuales_ids : (Array.isArray(disparador.incluir_manuales_ids) ? disparador.incluir_manuales_ids : []))
            .map(Number)
            .filter(n => n > 0)
    );

    const skuPasaFiltroLdn = (skuK) => {
        if (!filtroLdns) return true;
        return filtroLdns.has(clasificarLdnArticulo(snapshot, skuK));
    };

    const ingCost = new Map();
    for (const [id, ing] of snapshot.ingById.entries()) {
        ingCost.set(id, ing.costo_patron);
    }
    const ingUnrounded = new Map(ingCost);

    const artCost = new Map();
    const artUnrounded = new Map();
    for (const [skuK, art] of snapshot.artBySku.entries()) {
        artCost.set(skuK, art.costo_base);
        artUnrounded.set(skuK, art.costo_base);
    }

    const bloqueadosCostoCero = new Set();
    const alertasCostoCero = [];
    const alertasMapSeen = new Set();
    const registrarCostoCero = (sku, ingId, nombre, contexto) => {
        const k = `${normSku(sku)}#${ingId}`;
        bloqueadosCostoCero.add(normSku(sku));
        if (!alertasMapSeen.has(k)) {
            alertasMapSeen.add(k);
            alertasCostoCero.push({
                sku: String(sku),
                ingrediente_id: Number(ingId),
                nombre: String(nombre || `#${ingId}`),
                contexto,
                alerta_costo_cero: true
            });
        }
    };

    // Aplicar disparador inicial
    const tipoDisp = String(disparador.tipo || 'FULL_GRAPH').trim().toUpperCase();
    const upOverrides = new Map();
    if (tipoDisp === 'INGREDIENTE') {
        const id = Number(disparador.ingrediente_id || 0);
        const val = round2(disparador.nuevo_costo_patron);
        if (snapshot.ingById.has(id) && val >= 0) {
            ingCost.set(id, val);
            ingUnrounded.set(id, Number(disparador.nuevo_costo_patron));
        }
    } else if (tipoDisp === 'ARTICULO_BUNKER') {
        const skuK = normSku(disparador.articulo_id);
        const art = snapshot.artBySku.get(skuK);
        if (art) {
            const nuevoBase = round2(disparador.nuevo_costo_base);
            artCost.set(skuK, nuevoBase);
            const kg = Math.max(0.001, art.kilos_unidad || 1);
            const costoKgNuevo = round2(nuevoBase / kg);
            for (const ingId of subgrafo.ingImpactados) {
                const ing = snapshot.ingById.get(ingId);
                if (ing && ing.rol_ingrediente === 'MATERIA_PRIMA' && snapshot.mpToBultos.get(ingId)?.has(skuK)) {
                    ingCost.set(ingId, costoKgNuevo);
                    ingUnrounded.set(ingId, nuevoBase / kg);
                }
            }
        }
    } else if (tipoDisp === 'PARAMETROS_UP') {
        const relId = Number(disparador.relacion_id || 0);
        const espId = Number(disparador.ingrediente_espejo_id || 0);
        const u = snapshot.upList.find(x => (relId > 0 && x.id === relId) || (espId > 0 && x.ingrediente_espejo_id === espId));
        if (u) upOverrides.set(u.id, disparador);
    }

    // 1. LDN 4 (Tostaderos / UP Simple)
    for (const u of snapshot.upList) {
        if (u.linea_negocio !== 4 || !subgrafo.upImpactadas.has(u.id)) continue;
        const apArt = snapshot.artBySku.get(u.ap_key);
        const ov = upOverrides.get(u.id) || {};
        const merma = ov.merma_default_pct !== undefined ? Number(ov.merma_default_pct) : u.merma_default_pct;
        const tarifa = ov.tarifa_maquila_default !== undefined ? Number(ov.tarifa_maquila_default) : u.tarifa_maquila_default;
        const crudoSku = apArt?.propiedades_dinamicas?.fuente_abastecimiento_ldn4?.crudo_sku
            || snapshot.recetaBySku.get(u.up_key)?.articulo_sugerido_numero
            || null;
        const modoRector = String(apArt?.propiedades_dinamicas?.fuente_abastecimiento_ldn4?.modo_rector || 'PRODUCCION_UP').toUpperCase();
        if (crudoSku && modoRector !== 'COMPRA_TERMINADO') {
            const crudoArt = snapshot.artBySku.get(normSku(crudoSku));
            const crudoBase = artCost.get(normSku(crudoSku));
            if (crudoArt && crudoBase !== undefined) {
                if (crudoBase <= 0) {
                    registrarCostoCero(u.articulo_kilo_codigo, 0, crudoSku, 'LDN_4_CRUDO');
                    continue;
                }
                const costoCrudoKg = crudoBase / Math.max(0.001, crudoArt.kilos_unidad);
                const nuevoBaseAp = round2((costoCrudoKg / Math.max(0.05, 1 - (merma / 100))) + tarifa);
                artCost.set(u.ap_key, nuevoBaseAp);
                if (u.ingrediente_espejo_id) {
                    const moApKilo = resolverMoKiloArticulo(snapshot, u.ap_key);
                    const valEsp = round2(nuevoBaseAp + moApKilo);
                    ingCost.set(u.ingrediente_espejo_id, valEsp);
                    ingUnrounded.set(u.ingrediente_espejo_id, valEsp);
                }
            }
        }
    }

    // 2. LDN 3 (Mixes y Pre-Mezclas en ingrediente_composicion)
    for (const [mixId, items] of snapshot.mixesById.entries()) {
        if (!subgrafo.mixImpactados.has(mixId) && !subgrafo.full) continue;
        let sumTotal = 0;
        let sumCant = 0;
        let zeroErr = false;
        for (const it of items) {
            if (it.cantidad <= 0) continue;
            const c = ingCost.get(it.ingrediente_id) ?? 0;
            if (c <= 0) {
                const ingMeta = snapshot.ingById.get(it.ingrediente_id);
                registrarCostoCero(`MIX-${mixId}`, it.ingrediente_id, ingMeta?.nombre, 'LDN_3_MIX');
                zeroErr = true;
                break;
            }
            sumTotal += it.cantidad * c;
            sumCant += it.cantidad;
        }
        if (zeroErr || sumCant <= 0) continue;
        const mixRaw = sumTotal / sumCant;
        const mixRounded = round2(mixRaw);
        ingUnrounded.set(mixId, mixRaw);
        ingCost.set(mixId, mixRounded);

        // Si el Mix tiene Puente Comercial no-UP (p.ej. #30 -> MFSXK -> #149)
        const puenteMeta = snapshot.mixToPuente.get(mixId);
        if (puenteMeta) {
            const recPuente = snapshot.recetaBySku.get(puenteMeta.ap_key);
            const artPuente = snapshot.artBySku.get(puenteMeta.ap_key);
            if (recPuente && artPuente) {
                let costoBultoPuente = 0;
                let blocked = false;
                for (const ri of recPuente.items) {
                    if (ri.cantidad <= 0) continue;
                    const ci = ri.ingrediente_id === mixId ? mixRounded : (ingCost.get(ri.ingrediente_id) ?? 0);
                    if (ci <= 0) {
                        const im = snapshot.ingById.get(ri.ingrediente_id);
                        registrarCostoCero(puenteMeta.ap_sku, ri.ingrediente_id, im?.nombre, 'LDN_3_PUENTE');
                        blocked = true;
                        break;
                    }
                    costoBultoPuente += ri.cantidad * ci;
                }
                if (!blocked) {
                    const nuevoBaseAp = round2(costoBultoPuente);
                    artCost.set(puenteMeta.ap_key, nuevoBaseAp);
                    const moApKilo = resolverMoKiloArticulo(snapshot, puenteMeta.ap_key);
                    const nuevoEsp = round2((nuevoBaseAp / Math.max(0.001, artPuente.kilos_unidad)) + moApKilo);
                    ingCost.set(puenteMeta.puente_ingrediente_id, nuevoEsp);
                    ingUnrounded.set(puenteMeta.puente_ingrediente_id, nuevoEsp);
                }
            }
        }
    }

    // 3. LDN 5 & LDN 6 (Pre-Mezclas + UP Externa)
    for (const u of snapshot.upList) {
        if ((u.linea_negocio !== 5 && u.linea_negocio !== 6) || !subgrafo.upImpactadas.has(u.id)) continue;
        if (!u.pre_key || !u.ap_key) continue;
        const preArt = snapshot.artBySku.get(u.pre_key);
        const preRec = snapshot.recetaBySku.get(u.pre_key);
        if (!preArt || !preRec) continue;

        let blockedPre = false;
        let mixCostRaw = 0;
        let envasePre = 0;
        for (const it of preRec.items) {
            if (it.cantidad <= 0) continue;
            const ingMeta = snapshot.ingById.get(it.ingrediente_id);
            if (ingMeta?.es_insumo) {
                const cIns = ingCost.get(it.ingrediente_id) ?? 0;
                if (cIns <= 0) {
                    registrarCostoCero(u.articulo_premezcla_codigo, it.ingrediente_id, ingMeta.nombre, 'PREMEZCLA_INSUMO');
                    blockedPre = true;
                    break;
                }
                envasePre += it.cantidad * cIns;
            } else {
                const cMix = ingUnrounded.get(it.ingrediente_id) ?? ingCost.get(it.ingrediente_id) ?? 0;
                if (cMix <= 0) {
                    registrarCostoCero(u.articulo_premezcla_codigo, it.ingrediente_id, ingMeta?.nombre, 'PREMEZCLA_MIX');
                    blockedPre = true;
                    break;
                }
                mixCostRaw = cMix;
            }
        }
        if (blockedPre) continue;

        const kilosPre = Math.max(0.001, preArt.kilos_unidad);
        const bultoPreSinMo = (mixCostRaw * kilosPre) + envasePre;
        const bultoPreBase = round2(bultoPreSinMo);
        artCost.set(u.pre_key, bultoPreBase);

        const moPre = resolverMoBultoHijoL1(snapshot, u.pre_key);
        const kiloPreEntrada = round2((bultoPreSinMo + moPre) / kilosPre);
        const bultoPreEntrada = kiloPreEntrada * kilosPre;

        const ov = upOverrides.get(u.id) || {};
        const tarifa = ov.tarifa_maquila_default !== undefined ? Number(ov.tarifa_maquila_default) : u.tarifa_maquila_default;
        const merma = ov.merma_default_pct !== undefined ? Number(ov.merma_default_pct) : u.merma_default_pct;
        const unidadesTanda = ov.unidades_por_tanda_default !== undefined
            ? Number(ov.unidades_por_tanda_default)
            : Number(u.unidades_por_tanda_default || 96);

        const extItems = (Array.isArray(u.insumos_fase_externa_json) && u.insumos_fase_externa_json.length > 0)
            ? u.insumos_fase_externa_json
            : (snapshot.recetaBySku.get(u.up_key)?.items || []);

        let cantExt = 0;
        let costoExt = 0;
        let blockedUp = false;
        for (const it of extItems) {
            const cant = Number(it.cantidad || 0);
            if (cant <= 0) continue;
            const c = ingCost.get(Number(it.ingrediente_id)) ?? 0;
            if (c <= 0) {
                const im = snapshot.ingById.get(Number(it.ingrediente_id));
                registrarCostoCero(u.articulo_kilo_codigo, Number(it.ingrediente_id), im?.nombre, 'UP_FASE_EXTERNA');
                blockedUp = true;
                break;
            }
            cantExt += cant;
            costoExt += cant * c;
        }
        if (blockedUp) continue;

        let nuevoBaseAp = null;
        if (u.modo_rendimiento === 'UNIDADES_POR_TANDA' || u.linea_negocio === 5) {
            const pesoSalida = Number(u.peso_unitario_salida_kg || 0.05);
            const costoMasaEntrada = bultoPreEntrada + costoExt;
            const costoSalidaUn = (costoMasaEntrada + (unidadesTanda * tarifa)) / Math.max(1, unidadesTanda);
            nuevoBaseAp = round2(costoSalidaUn / Math.max(0.001, pesoSalida));
        } else if (u.linea_negocio === 6) {
            const masaEntrada = kilosPre + cantExt;
            const costoPreHorno = bultoPreEntrada + costoExt;
            const masaSalidaHorno = round2(masaEntrada * (1 - (merma / 100)));
            const secosConf = (Array.isArray(u.ingredientes_custom) && u.ingredientes_custom.length > 0)
                ? u.ingredientes_custom
                : (snapshot.recetaBySku.get(u.ap_key)?.items || []);
            let qtySecosTotal = 0;
            let costoSecosTotal = 0;
            for (const s of secosConf) {
                const ratio = Number(s.cantidad || 0);
                if (ratio <= 0) continue;
                const sIngId = Number(s.ingrediente_id);
                const cs = ingCost.get(sIngId) ?? 0;
                if (cs <= 0) {
                    const im = snapshot.ingById.get(sIngId);
                    registrarCostoCero(u.articulo_kilo_codigo, sIngId, im?.nombre, 'LDN_6_POST_HORNO');
                    blockedUp = true;
                    break;
                }
                const qtyS = round3(ratio * masaSalidaHorno);
                qtySecosTotal += qtyS;
                costoSecosTotal += qtyS * cs;
            }
            if (blockedUp) continue;
            const masaFinal = round3(masaSalidaHorno + qtySecosTotal);
            nuevoBaseAp = round2((costoPreHorno + costoSecosTotal + (tarifa * masaFinal)) / Math.max(0.001, masaFinal));
        }

        if (nuevoBaseAp !== null && u.ap_key) {
            artCost.set(u.ap_key, nuevoBaseAp);
            if (u.ingrediente_espejo_id) {
                const moApKilo = resolverMoKiloArticulo(snapshot, u.ap_key);
                const nuevoEsp = round2(nuevoBaseAp + moApKilo);
                ingCost.set(u.ingrediente_espejo_id, nuevoEsp);
                ingUnrounded.set(u.ingrediente_espejo_id, nuevoEsp);
            }
        }
    }

    // 4. LDN 2 (Fracciones con receta) & Packs
    const puentesOUpKeys = new Set([
        ...snapshot.upByApSku.keys(),
        ...snapshot.upByPreSku.keys(),
        ...snapshot.upList.map(u => u.up_key).filter(Boolean),
        ...Array.from(snapshot.mixToPuente.values()).map(m => m.ap_key)
    ]);

    for (const [skuKey, rec] of snapshot.recetaBySku.entries()) {
        if (puentesOUpKeys.has(skuKey)) continue;
        if (!subgrafo.artImpactados.has(skuKey) && !subgrafo.full) continue;
        if (rec.items.length === 0) continue;
        const art = snapshot.artBySku.get(skuKey);
        if (!art || (art.es_pack && art.pack_hijo_codigo)) continue;

        let totalRec = 0;
        let blocked = false;
        for (const it of rec.items) {
            if (it.cantidad <= 0) continue;
            const ci = ingCost.get(it.ingrediente_id) ?? 0;
            if (ci <= 0) {
                const im = snapshot.ingById.get(it.ingrediente_id);
                registrarCostoCero(art.articulo_id, it.ingrediente_id, im?.nombre, 'LDN_2_RECETA');
                blocked = true;
                break;
            }
            totalRec += it.cantidad * ci;
        }
        if (!blocked) {
            artUnrounded.set(skuKey, totalRec);
            artCost.set(skuKey, round2(totalRec));
        }
    }

    // Packs que dependen de pack_hijo_codigo
    for (const [skuKey, art] of snapshot.artBySku.entries()) {
        if (!art.es_pack || !art.pack_hijo_codigo) continue;
        if (!subgrafo.artImpactados.has(skuKey) && !subgrafo.full) continue;
        const hijoKey = normSku(art.pack_hijo_codigo);
        if (bloqueadosCostoCero.has(hijoKey)) {
            registrarCostoCero(art.articulo_id, 0, art.pack_hijo_codigo, 'PACK_HIJO_BLOQUEADO');
            continue;
        }
        const hijoBase = artUnrounded.get(hijoKey) ?? artCost.get(hijoKey);
        if (hijoBase !== undefined) {
            const moHijoL1 = resolverMoBultoHijoL1(snapshot, hijoKey);
            const l1HijoRow = (snapshot.listaArticulosBySku.get(hijoKey) || []).find(r => r.lista_id === 1);
            const insHijo = l1HijoRow ? resolverInsumosLista(snapshot, l1HijoRow, artCost) : 0;
            const packUnrounded = (hijoBase + moHijoL1 + insHijo) * Math.max(1, art.pack_unidades);
            artUnrounded.set(skuKey, packUnrounded);
            artCost.set(skuKey, round2(packUnrounded));
        }
    }

    // 5. LDN 8 Combos
    for (const [comboKey, comps] of snapshot.comboCompsPorSku.entries()) {
        if (!subgrafo.artImpactados.has(comboKey) && !subgrafo.full) continue;
        let suma = 0;
        let blocked = false;
        for (const comp of comps) {
            if (bloqueadosCostoCero.has(comp.componente_key)) {
                registrarCostoCero(comboKey, 0, comp.componente_articulo_id, 'COMBO_HIJO_BLOQUEADO');
                blocked = true;
                break;
            }
            const c = artCost.get(comp.componente_key);
            if (c === undefined) { blocked = true; break; }
            suma += c * comp.cantidad;
        }
        if (!blocked) {
            artUnrounded.set(comboKey, suma);
            artCost.set(comboKey, round2(suma));
        }
    }

    // 6. Listas B2B (public.bunker_lista_articulos) — protección explícita de filas MANUAL
    const cambiosListas = [];
    const listasManualesOmitidas = [];
    const precioNuevoPorListaYSku = new Map();

    for (const skuKey of subgrafo.artImpactados) {
        const art = snapshot.artBySku.get(skuKey);
        if (!art) continue;
        const ldnSku = clasificarLdnArticulo(snapshot, skuKey);
        const ldnPermitida = !filtroLdns || filtroLdns.has(ldnSku);
        const nuevoCostoBulto = artCost.get(skuKey) ?? art.costo_base;
        const nuevoCostoUnrounded = artUnrounded.get(skuKey) ?? nuevoCostoBulto;
        const viejoCostoBulto = art.costo_base;
        const cambioBaseArt = Math.abs(nuevoCostoBulto - viejoCostoBulto) > 0.009;
        const kilos = Math.max(0.001, art.kilos_unidad || 1);
        const baseKiloCalc = nuevoCostoUnrounded / kilos;
        const baseKiloSobNew = round2(nuevoCostoBulto / kilos);

        const laRows = snapshot.listaArticulosBySku.get(skuKey) || [];
        for (const la of laRows) {
            if (bloqueadosCostoCero.has(skuKey)) continue;
            const insTotal = resolverInsumosLista(snapshot, la, artCost);

            // Si cambió el costo del artículo padre y tenía sobrescrito previo, actualizamos costo_base_sobrescrito
            let overrideBaseKg = null;
            if (!subgrafo.full && cambioBaseArt && la.costo_base_sobrescrito !== null) {
                overrideBaseKg = baseKiloSobNew;
            }
            const listaMeta = snapshot.listaById.get(la.lista_id);
            const canalLista = listaMeta?.canal_comercial || 'MAYORISTA';
            const esManual = String(la.modo_calculo || 'AUTOMATIC').toUpperCase() === 'MANUAL';

            // Calcular fórmula informativa incluso en filas MANUAL (para advertencia explícita)
            const laForCalc = esManual ? { ...la, modo_calculo: 'AUTOMATIC' } : la;
            const resFormula = calcularPrecioB2BLista(laForCalc, kilos, baseKiloCalc, insTotal, overrideBaseKg, {
                porcentajeIvaArticulo: art.porcentaje_iva,
                canalComercial: canalLista
            });
            const nuevoSob = overrideBaseKg !== null ? baseKiloSobNew : la.costo_base_sobrescrito;
            const precioBdCmp = String(canalLista).toUpperCase() === 'NODOS' ? Math.round(la.precio_final) : round2(la.precio_final);
            const diffPrecio = Math.abs(resFormula.precio_final - precioBdCmp);

            precioNuevoPorListaYSku.set(
                `${la.lista_id}::${skuKey}`,
                esManual && !(sobrescribirManuales || incluirManualesSet.has(la.id))
                    ? precioBdCmp
                    : resFormula.precio_final
            );

            if (!ldnPermitida) continue;
            if (filtroListas && !filtroListas.has(la.lista_id)) continue;

            if (esManual && !(sobrescribirManuales || incluirManualesSet.has(la.id))) {
                if (diffPrecio > 0.009 || !subgrafo.full) {
                    listasManualesOmitidas.push({
                        lista_articulo_id: la.id,
                        lista_id: la.lista_id,
                        lista_nombre: listaMeta?.nombre || `Lista ${la.lista_id}`,
                        canal_comercial: canalLista,
                        ldn: ldnSku,
                        articulo_numero: la.articulo_numero,
                        modo_calculo: 'MANUAL',
                        disponible: Boolean(la.disponible),
                        precio_actual: precioBdCmp,
                        precio_sugerido_formula: resFormula.precio_final,
                        diff_teorica: round2(resFormula.precio_final - precioBdCmp)
                    });
                }
                continue;
            }

            if (subgrafo.full || diffPrecio > 0.009 || (nuevoSob !== la.costo_base_sobrescrito)) {
                cambiosListas.push({
                    lista_articulo_id: la.id,
                    lista_id: la.lista_id,
                    lista_nombre: listaMeta?.nombre || `Lista ${la.lista_id}`,
                    canal_comercial: canalLista,
                    ldn: ldnSku,
                    articulo_numero: la.articulo_numero,
                    kilos_unidad: art.kilos_unidad,
                    costo_anterior: viejoCostoBulto,
                    costo_nuevo: nuevoCostoBulto,
                    costo_base_sobrescrito_actual: la.costo_base_sobrescrito,
                    costo_base_sobrescrito_nuevo: nuevoSob,
                    precio_actual: precioBdCmp,
                    precio_nuevo: resFormula.precio_final,
                    diff_precio: round2(resFormula.precio_final - precioBdCmp),
                    insumos_total: insTotal,
                    era_manual_sobrescrito: esManual
                });
            }
        }
    }

    const listasNodosIds = Array.from(snapshot.listaById.values())
        .filter(l => String(l.canal_comercial || '').toUpperCase() === 'NODOS')
        .map(l => Number(l.id))
        .sort((a, b) => a - b);
    const defaultNodosListId = listasNodosIds[0] || 8;

    // 7. Canal Nodos Escalón 1 (nodos_articulos_catalogo) y Escalón 2 (nodos_ofertas_gestor — multi-lista NODOS)
    const cambiosCatalogoNodos = [];
    const cambiosOfertasNodos = [];
    if (incluirCanalNodos) {
        for (const cat of snapshot.catalogoBySku.values()) {
            const skuKey = cat.sku_key;
            if (!subgrafo.full && !subgrafo.artImpactados.has(skuKey) && !(cat.ingrediente_origen_id && subgrafo.ingImpactados.has(Number(cat.ingrediente_origen_id)))) {
                continue;
            }
            if (!skuPasaFiltroLdn(skuKey)) continue;
            if (bloqueadosCostoCero.has(skuKey)) continue;

            const ldnCat = clasificarLdnArticulo(snapshot, skuKey);
            let nuevoCostoKg = cat.costo_insumo_kg;
            if (cat.ingrediente_origen_id && ingCost.has(Number(cat.ingrediente_origen_id))) {
                const ck = ingCost.get(Number(cat.ingrediente_origen_id));
                if (ck > 0) nuevoCostoKg = round2(ck);
            } else if (artCost.has(skuKey)) {
                nuevoCostoKg = round2((artCost.get(skuKey) - cat.costo_envase_aplicado) / Math.max(0.001, cat.kilos_unidad));
            }
            let nuevoCostoEnvase = cat.costo_envase_aplicado;
            if (cat.insumo_envase_id && ingCost.has(Number(cat.insumo_envase_id))) {
                const envId = Number(cat.insumo_envase_id);
                const cEnv = ingCost.get(envId);
                const origEnvCost = snapshot.ingById.get(envId)?.costo_patron ?? 0;
                const cantEnv = Math.max(0, Number(cat.cantidad_envases_unidad || 1));
                const envaseExtraPrevio = Math.max(0, round2(cat.costo_envase_aplicado - (origEnvCost * cantEnv)));
                if (cEnv > 0) {
                    nuevoCostoEnvase = round2((cEnv * cantEnv) + envaseExtraPrevio);
                }
            }
            const nuevoCostoFracc = round2(nuevoCostoKg * cat.kilos_unidad);
            const materiaYEnvase = round2(nuevoCostoFracc + nuevoCostoEnvase);
            const nuevoCostoPuro = round2(materiaYEnvase + cat.costo_mano_obra_aplicado);
            const gananciaLamda = round2(materiaYEnvase * (cat.margen_lamda_pct / 100));
            const nuevoBaseNeto = round2(materiaYEnvase + gananciaLamda + cat.costo_mano_obra_aplicado);
            const nuevoBaseFinal = Math.round(nuevoBaseNeto * (1 + (cat.iva_pct / 100)));

            const cambioCat = Math.abs(nuevoBaseFinal - cat.precio_base_nodo_final) > 0.009
                || Math.abs(nuevoCostoPuro - cat.costo_puro_total) > 0.009;

            if (subgrafo.full || cambioCat) {
                cambiosCatalogoNodos.push({
                    catalogo_id: cat.id,
                    sku_nodo: cat.sku_nodo,
                    ldn: ldnCat,
                    costo_insumo_kg_actual: cat.costo_insumo_kg,
                    costo_insumo_kg_nuevo: nuevoCostoKg,
                    costo_insumo_fraccion_nuevo: nuevoCostoFracc,
                    costo_envase_aplicado_nuevo: nuevoCostoEnvase,
                    costo_puro_total_actual: cat.costo_puro_total,
                    costo_puro_total_nuevo: nuevoCostoPuro,
                    precio_base_nodo_neto_actual: cat.costo_base_nodo_neto,
                    precio_base_nodo_neto_nuevo: nuevoBaseNeto,
                    precio_base_nodo_final_actual: cat.precio_base_nodo_final,
                    precio_base_nodo_final_nuevo: nuevoBaseFinal
                });
            }

            const ofertas = snapshot.ofertasPorCatalogoId.get(cat.id) || [];
            for (const ofe of ofertas) {
                if (filtroListas && ofe.lista_precio_bunker_id && !filtroListas.has(ofe.lista_precio_bunker_id) && !filtroListas.has(defaultNodosListId)) {
                    continue;
                }
                const usaListaDiferenciadaNodo = Boolean(
                    ofe.lista_precio_bunker_id && Number(ofe.lista_precio_bunker_id) !== Number(defaultNodosListId)
                );
                const precioListaNodoEspecifica = usaListaDiferenciadaNodo
                    ? precioNuevoPorListaYSku.get(`${ofe.lista_precio_bunker_id}::${skuKey}`)
                    : undefined;
                const baseEscalon1Nodo = (precioListaNodoEspecifica !== undefined && precioListaNodoEspecifica > 0)
                    ? Math.round(precioListaNodoEspecifica)
                    : nuevoBaseFinal;

                const esc2 = calcularEscalon2OfertaGestor(
                    baseEscalon1Nodo,
                    ofe.margen_gestor_pct,
                    ofe.alicuota_iva_margen_pct,
                    ofe.alicuota_iibb_margen_pct
                );
                const cambioBaseOferta = Math.abs(baseEscalon1Nodo - ofe.precio_base_nodo_snapshot) > 0.009 || cambioCat;
                const diffOferta = Math.abs(esc2.precio_venta_vecino - ofe.precio_venta_vecino) > 0.009
                    || Math.abs(esc2.ganancia_unitaria_gestor - ofe.ganancia_unitaria_gestor) > 0.009
                    || cambioBaseOferta;
                if (subgrafo.full || cambioBaseOferta || diffOferta) {
                    cambiosOfertasNodos.push({
                        oferta_id: ofe.id,
                        nodo_id: ofe.nodo_id,
                        nodo_nombre: ofe.nombre_marca,
                        lista_precio_bunker_id: ofe.lista_precio_bunker_id,
                        catalogo_id: cat.id,
                        sku_nodo: cat.sku_nodo,
                        ldn: ldnCat,
                        precio_base_nodo_snapshot_actual: ofe.precio_base_nodo_snapshot,
                        precio_base_nodo_snapshot_nuevo: baseEscalon1Nodo,
                        margen_gestor_pct_preservado: esc2.margen_gestor_pct,
                        precio_venta_vecino_actual: ofe.precio_venta_vecino,
                        precio_venta_vecino_nuevo: esc2.precio_venta_vecino,
                        ganancia_unitaria_gestor_actual: ofe.ganancia_unitaria_gestor,
                        ganancia_unitaria_gestor_nuevo: esc2.ganancia_unitaria_gestor,
                        retencion_fiscal_unitaria_nueva: esc2.retencion_fiscal_unitaria,
                        alerta_cambio_costo: cambioBaseOferta
                    });
                }
            }
        }
    }

    const cambiosIngredientes = [];
    for (const [id, nuevoVal] of ingCost.entries()) {
        const orig = snapshot.ingById.get(id)?.costo_patron ?? 0;
        if (Math.abs(nuevoVal - orig) > 0.009) {
            cambiosIngredientes.push({
                ingrediente_id: id,
                codigo: snapshot.ingById.get(id)?.codigo || null,
                nombre: snapshot.ingById.get(id)?.nombre || `#${id}`,
                rol_ingrediente: snapshot.ingById.get(id)?.rol_ingrediente,
                costo_actual: orig,
                costo_nuevo: round2(nuevoVal),
                diff: round2(nuevoVal - orig)
            });
        }
    }

    const cambiosArticulos = [];
    for (const [skuK, nuevoBase] of artCost.entries()) {
        const origArt = snapshot.artBySku.get(skuK);
        if (!origArt) continue;
        const ldnArt = clasificarLdnArticulo(snapshot, skuK);
        if (filtroLdns && !filtroLdns.has(ldnArt)) continue;
        if (Math.abs(nuevoBase - origArt.costo_base) > 0.009) {
            cambiosArticulos.push({
                articulo_id: origArt.articulo_id,
                ldn: ldnArt,
                kilos_unidad: origArt.kilos_unidad,
                costo_base_actual: origArt.costo_base,
                costo_base_nuevo: round2(nuevoBase),
                diff: round2(nuevoBase - origArt.costo_base)
            });
        }
    }

    const listasB2BFinal = subgrafo.full
        ? cambiosListas.filter(l => Math.abs(l.diff_precio) > 0.009)
        : cambiosListas;
    const catNodosFinal = subgrafo.full
        ? cambiosCatalogoNodos.filter(c => Math.abs(c.precio_base_nodo_final_nuevo - c.precio_base_nodo_final_actual) > 0.009)
        : cambiosCatalogoNodos;
    const ofeNodosFinal = subgrafo.full
        ? cambiosOfertasNodos.filter(o => Math.abs(o.precio_venta_vecino_nuevo - o.precio_venta_vecino_actual) > 0.009)
        : cambiosOfertasNodos;

    return {
        ok: true,
        requiere_seleccion_calidad: false,
        calidades_candidatas: [],
        disparador,
        filtros_aplicados: {
            ldns_seleccionadas: filtroLdns ? Array.from(filtroLdns) : null,
            listas_seleccionadas: filtroListas ? Array.from(filtroListas) : null,
            incluir_canal_nodos: incluirCanalNodos,
            sobrescribir_manuales: sobrescribirManuales
        },
        solo_lectura: true,
        recetas_huerfanas_omitidas: snapshot.recetasHuerfanas.length,
        alertas_costo_cero: alertasCostoCero,
        cambios: {
            ingredientes: cambiosIngredientes,
            articulos: cambiosArticulos,
            listas_b2b: listasB2BFinal,
            listas_manuales_omitidas: listasManualesOmitidas,
            catalogo_nodos: catNodosFinal,
            ofertas_nodos: ofeNodosFinal
        },
        resumen: {
            ingredientes_modificados: cambiosIngredientes.length,
            articulos_modificados: cambiosArticulos.length,
            listas_modificadas: listasB2BFinal.length,
            listas_manuales_omitidas: listasManualesOmitidas.length,
            catalogo_nodos_modificados: catNodosFinal.length,
            ofertas_nodos_modificadas: ofeNodosFinal.length,
            alertas_costo_cero: alertasCostoCero.length
        }
    };
}

/**
 * Aplica en una transacción atómica una simulación previamente calculada (o la calcula y aplica).
 * - Respeta margen_gestor_pct y recalcula precio_venta_vecino / ganancia_unitaria_gestor con alerta_cambio_costo = true
 *   y precio_venta_vecino_anterior preservado.
 * - Protege filas MANUAL salvo opt-in explícito.
 * - Registra trazabilidad Mayorista B2B en bunker_historial_cambios_precios y bunker_notificaciones_cambios_clientes.
 * - Dispara triggerB2BSync('precios') post-commit en producción real (protegido en laboratorio).
 */
async function aplicarCascada(runner, disparadorOSimulacion = {}, opciones = {}) {
    const isClient = runner && typeof runner.release === 'function';
    const pool = runner || defaultPool;
    const ownClient = !isClient;
    const client = ownClient ? await pool.connect() : runner;
    const opts = (opciones && typeof opciones === 'object') ? opciones : {};

    let cambiosMayoristasRegistrados = 0;
    let notificacionesClientesCreadas = 0;
    let sim;

    try {
        if (ownClient) await client.query('BEGIN');

        sim = disparadorOSimulacion && disparadorOSimulacion.cambios
            ? disparadorOSimulacion
            : await simularCascada(client, disparadorOSimulacion, opts);

        if (sim.requiere_seleccion_calidad) {
            const err = new Error(sim.mensaje || 'Selección explícita de calidad requerida antes de aplicar cascada.');
            err.statusCode = 400;
            err.detalle = sim;
            throw err;
        }

        const ingCambios = sim.cambios.ingredientes || [];
        if (ingCambios.length > 0) {
            await client.query(
                `UPDATE public.ingredientes AS i
                 SET costo_patron = u.costo_nuevo
                 FROM unnest($1::int[], $2::numeric[]) AS u(id, costo_nuevo)
                 WHERE i.id = u.id`,
                [
                    ingCambios.map(x => Number(x.ingrediente_id)),
                    ingCambios.map(x => Number(x.costo_nuevo))
                ]
            );
        }

        const artCambios = sim.cambios.articulos || [];
        if (artCambios.length > 0) {
            await client.query(
                `UPDATE public.bunker_articulos AS ba
                 SET costo_base = u.costo_base_nuevo,
                     updated_at = NOW()
                 FROM unnest($1::text[], $2::numeric[]) AS u(art_id, costo_base_nuevo)
                 WHERE UPPER(BTRIM(ba.articulo_id)) = UPPER(BTRIM(u.art_id))`,
                [
                    artCambios.map(x => String(x.articulo_id)),
                    artCambios.map(x => Number(x.costo_base_nuevo))
                ]
            );
        }

        const incluirManualesOptIn = new Set(
            (Array.isArray(opts.incluir_manuales_ids) ? opts.incluir_manuales_ids : []).map(Number).filter(n => n > 0)
        );
        const permitirManualesTx = Boolean(opts.sobrescribir_manuales);

        const listasMayoristasParaHistorial = [];
        const laCambios = sim.cambios.listas_b2b || [];
        if (laCambios.length > 0) {
            const updLaRes = await client.query(
                `UPDATE public.bunker_lista_articulos AS bla
                 SET costo_base_sobrescrito = u.costo_sob,
                     precio_final = u.precio_nuevo,
                     updated_at = NOW()
                 FROM unnest($1::int[], $2::numeric[], $3::numeric[], $4::boolean[]) AS u(id, costo_sob, precio_nuevo, puede_manual)
                 WHERE bla.id = u.id
                   AND (u.puede_manual = true OR UPPER(COALESCE(bla.modo_calculo, 'AUTOMATIC')) <> 'MANUAL')
                 RETURNING bla.id`,
                [
                    laCambios.map(x => Number(x.lista_articulo_id)),
                    laCambios.map(x => x.costo_base_sobrescrito_nuevo !== null && x.costo_base_sobrescrito_nuevo !== undefined ? Number(x.costo_base_sobrescrito_nuevo) : null),
                    laCambios.map(x => Number(x.precio_nuevo)),
                    laCambios.map(x => Boolean(permitirManualesTx || incluirManualesOptIn.has(Number(x.lista_articulo_id))))
                ]
            );
            const updatedLaIds = new Set(updLaRes.rows.map(r => Number(r.id)));
            for (const laC of laCambios) {
                if (updatedLaIds.has(Number(laC.lista_articulo_id)) && String(laC.canal_comercial || 'MAYORISTA').toUpperCase() !== 'NODOS') {
                    const pAnt = Number(laC.precio_actual || 0);
                    const pNue = Number(laC.precio_nuevo || 0);
                    const cAnt = Number(laC.costo_anterior || 0);
                    const cNue = Number(laC.costo_nuevo || 0);
                    if (Math.abs(pNue - pAnt) >= 0.01 || Math.abs(cNue - cAnt) >= 0.01) {
                        listasMayoristasParaHistorial.push({
                            articulo_numero: laC.articulo_numero,
                            lista_id: laC.lista_id,
                            precio_anterior: pAnt,
                            precio_nuevo: pNue,
                            costo_anterior: cAnt,
                            costo_nuevo: cNue,
                            kilos_unidad: laC.kilos_unidad
                        });
                    }
                }
            }
        }

        if (listasMayoristasParaHistorial.length > 0) {
            const resHist = await historialPreciosService.registrarCambiosLote({
                client,
                cambios: listasMayoristasParaHistorial,
                origen_cambio: opts.origen_cambio || 'CASCADA_COSTOS',
                usuario: opts.usuario || 'OPERADOR'
            });
            cambiosMayoristasRegistrados = Number(resHist?.insertados || 0);

            const regsHist = Array.isArray(resHist?.registros_insertados) ? resHist.registros_insertados : [];
            if (regsHist.length > 0) {
                const listaIdsAfectados = Array.from(new Set(regsHist.map(r => Number(r.lista_id)).filter(n => n > 0)));
                const cliRes = await client.query(
                    `SELECT DISTINCT
                            bcl.bunker_lista_precio_id AS lista_id,
                            COALESCE(NULLIF(regexp_replace(COALESCE(bc.lomas_soft_id, ''), '\\D', '', 'g'), '')::int, bc.id) AS cliente_id,
                            bc.codigo_bunker_cliente,
                            COALESCE(NULLIF(BTRIM(bc.razon_social), ''), NULLIF(BTRIM(bc.cliente_nombre), ''), bc.codigo_bunker_cliente) AS cliente_nombre
                     FROM public.bunker_cliente_listas_precios bcl
                     JOIN public.bunker_clientes bc ON bc.id = bcl.bunker_cliente_id
                     WHERE bcl.bunker_lista_precio_id = ANY($1::int[])
                       AND COALESCE(bc.codigo_bunker_cliente, '') NOT LIKE 'CB-NODO-%'`,
                    [listaIdsAfectados]
                );

                const clisPorLista = new Map();
                for (const c of cliRes.rows) {
                    const lid = Number(c.lista_id);
                    if (!clisPorLista.has(lid)) clisPorLista.set(lid, []);
                    clisPorLista.get(lid).push(c);
                }

                const nHistIds = [];
                const nArtNums = [];
                const nCliIds = [];
                const nCodBunks = [];
                const nCliNombres = [];
                const nNotas = [];
                const seenNotifPairs = new Set();

                for (const reg of regsHist) {
                    const clientesLista = clisPorLista.get(Number(reg.lista_id)) || [];
                    const notaTxt = `Pendiente de aviso automático por cascada de costos ($${Number(reg.precio_anterior).toFixed(2)} → $${Number(reg.precio_nuevo).toFixed(2)})`;
                    for (const cli of clientesLista) {
                        const cid = Number(cli.cliente_id);
                        const pairKey = `${reg.id}:${cid}`;
                        if (seenNotifPairs.has(pairKey)) continue;
                        seenNotifPairs.add(pairKey);
                        nHistIds.push(reg.id);
                        nArtNums.push(reg.articulo_numero);
                        nCliIds.push(cid);
                        nCodBunks.push(cli.codigo_bunker_cliente || null);
                        nCliNombres.push(cli.cliente_nombre || null);
                        nNotas.push(notaTxt);
                    }
                }

                if (nHistIds.length > 0) {
                    const insNotifRes = await client.query(
                        `INSERT INTO public.bunker_notificaciones_cambios_clientes (
                            historial_cambio_id, articulo_numero, cliente_id, codigo_bunker_cliente,
                            cliente_nombre, estado, canal, notificado_at, notas
                         )
                         SELECT u.hist_id, u.art_num, u.cli_id, u.cod_bunker, u.cli_nombre, 'PENDIENTE', NULL, NULL, u.notas
                         FROM unnest($1::int[], $2::text[], $3::int[], $4::text[], $5::text[], $6::text[])
                              AS u(hist_id, art_num, cli_id, cod_bunker, cli_nombre, notas)
                         ON CONFLICT (historial_cambio_id, cliente_id) DO NOTHING
                         RETURNING id`,
                        [nHistIds, nArtNums, nCliIds, nCodBunks, nCliNombres, nNotas]
                    );
                    notificacionesClientesCreadas = insNotifRes.rowCount || 0;
                }
            }
        }

        const catCambios = sim.cambios.catalogo_nodos || [];
        if (catCambios.length > 0) {
            await client.query(
                `UPDATE public.nodos_articulos_catalogo AS nac
                 SET costo_insumo_kg = u.c_kg,
                     costo_insumo_fraccion = u.c_fracc,
                     costo_envase_aplicado = u.c_env,
                     costo_puro_total = u.c_puro,
                     precio_base_nodo_neto = u.p_neto,
                     precio_base_nodo_final = u.p_final,
                     updated_at = NOW()
                 FROM unnest($1::int[], $2::numeric[], $3::numeric[], $4::numeric[], $5::numeric[], $6::numeric[], $7::numeric[])
                      AS u(id, c_kg, c_fracc, c_env, c_puro, p_neto, p_final)
                 WHERE nac.id = u.id`,
                [
                    catCambios.map(x => Number(x.catalogo_id)),
                    catCambios.map(x => Number(x.costo_insumo_kg_nuevo)),
                    catCambios.map(x => Number(x.costo_insumo_fraccion_nuevo)),
                    catCambios.map(x => Number(x.costo_envase_aplicado_nuevo)),
                    catCambios.map(x => Number(x.costo_puro_total_nuevo)),
                    catCambios.map(x => Number(x.precio_base_nodo_neto_nuevo)),
                    catCambios.map(x => Number(x.precio_base_nodo_final_nuevo))
                ]
            );
        }

        const ofeCambios = sim.cambios.ofertas_nodos || [];
        if (ofeCambios.length > 0) {
            await client.query(
                `UPDATE public.nodos_ofertas_gestor AS og
                 SET precio_venta_vecino_anterior = CASE
                         WHEN ABS(COALESCE(og.precio_venta_vecino, 0) - u.p_vecino) > 0.009 THEN og.precio_venta_vecino
                         ELSE og.precio_venta_vecino_anterior
                     END,
                     precio_base_nodo_snapshot = u.p_base_snap,
                     precio_venta_vecino = u.p_vecino,
                     ganancia_unitaria_gestor = u.gan_unit,
                     alerta_cambio_costo = CASE WHEN u.alerta THEN true ELSE og.alerta_cambio_costo END,
                     updated_at = NOW()
                 FROM unnest($1::int[], $2::numeric[], $3::numeric[], $4::numeric[], $5::boolean[])
                      AS u(id, p_base_snap, p_vecino, gan_unit, alerta)
                 WHERE og.id = u.id`,
                [
                    ofeCambios.map(x => Number(x.oferta_id)),
                    ofeCambios.map(x => Number(x.precio_base_nodo_snapshot_nuevo)),
                    ofeCambios.map(x => Number(x.precio_venta_vecino_nuevo)),
                    ofeCambios.map(x => Number(x.ganancia_unitaria_gestor_nuevo)),
                    ofeCambios.map(x => Boolean(x.alerta_cambio_costo))
                ]
            );
        }

        if (ownClient) await client.query('COMMIT');
    } catch (err) {
        if (ownClient) await client.query('ROLLBACK').catch(() => {});
        throw err;
    } finally {
        if (ownClient) client.release();
    }

    let b2bSyncDisparado = false;
    if (ownClient && opts.omitir_b2b_sync !== true && (cambiosMayoristasRegistrados > 0 || (sim.cambios?.articulos?.length || 0) > 0)) {
        try {
            triggerB2BSync('precios', `Cascada de Costos (${opts.origen_cambio || 'CASCADA_COSTOS'}: ${cambiosMayoristasRegistrados} filas B2B)`);
            b2bSyncDisparado = true;
        } catch (_) {}
    }

    return {
        ok: true,
        aplicado: true,
        resumen: {
            ...sim.resumen,
            cambios_mayoristas_historial: cambiosMayoristasRegistrados,
            notificaciones_clientes_pendientes: notificacionesClientesCreadas,
            b2b_sync_disparado: b2bSyncDisparado
        },
        alertas_costo_cero: sim.alertas_costo_cero,
        cambios: sim.cambios
    };
}

/**
 * Audita en modo sombra la paridad exacta entre el Grafo unificado y los valores almacenados
 * actualmente en ingredientes, bunker_articulos, bunker_lista_articulos y canal Nodos.
 */
async function auditarParidadPadron(runner = defaultPool) {
    const q = runner || defaultPool;
    const sim = await simularCascada(q, { tipo: 'FULL_GRAPH' });
    return {
        ok: true,
        solo_lectura: true,
        recetas_huerfanas_omitidas: sim.recetas_huerfanas_omitidas,
        alertas_costo_cero: sim.alertas_costo_cero,
        divergencias: sim.cambios,
        resumen: sim.resumen
    };
}

/**
 * Radar Ejecutivo de Impacto de Costos para Consola Única en Pizarra.
 * 100% solo lectura: resume desfases vigentes agrupados por LDN y lista selectores de disparadores.
 */
async function obtenerRadarCostos(runner = defaultPool, opciones = {}) {
    const q = runner || defaultPool;
    const auditoria = await auditarParidadPadron(q);
    const div = auditoria.divergencias || {};

    const conteoPorLdn = {
        LDN_1: 0, LDN_2: 0, LDN_3: 0, LDN_4: 0, LDN_5: 0, LDN_6: 0, LDN_8: 0
    };
    for (const a of div.articulos || []) {
        if (a.ldn && conteoPorLdn[a.ldn] !== undefined) conteoPorLdn[a.ldn] += 1;
    }

    const totalDesfases =
        Number(auditoria.resumen?.ingredientes_modificados || 0)
        + Number(auditoria.resumen?.articulos_modificados || 0)
        + Number(auditoria.resumen?.listas_modificadas || 0)
        + Number(auditoria.resumen?.catalogo_nodos_modificados || 0)
        + Number(auditoria.resumen?.ofertas_nodos_modificadas || 0);

    let selectores = null;
    if (opciones && opciones.incluirCatalogoSelectores) {
        const [ingRes, bultosRes, listasRes] = await Promise.all([
            q.query(`
                SELECT id, codigo, nombre, COALESCE(costo_patron, 0)::numeric(14,2) AS costo_patron,
                       COALESCE(rol_ingrediente, 'MATERIA_PRIMA') AS rol_ingrediente,
                       COALESCE(es_insumo, false) AS es_insumo
                FROM public.ingredientes
                ORDER BY nombre ASC
            `),
            q.query(`
                SELECT articulo_id,
                       COALESCE(NULLIF(BTRIM(descripcion_generada), ''), NULLIF(BTRIM(descripcion), ''), articulo_id) AS nombre,
                       COALESCE(costo_base, 0)::numeric(14,2) AS costo_base,
                       COALESCE(kilos_unidad, 1)::numeric(12,4) AS kilos_unidad
                FROM public.bunker_articulos
                ORDER BY articulo_id ASC
            `),
            q.query(`
                SELECT id, nombre, COALESCE(canal_comercial, 'MAYORISTA') AS canal_comercial
                FROM public.bunker_listas_precios
                WHERE COALESCE(activa, true) = true
                ORDER BY id ASC
            `)
        ]);
        selectores = {
            ingredientes: ingRes.rows,
            articulos_bunker: bultosRes.rows,
            listas: listasRes.rows
        };
    }

    return {
        ok: true,
        solo_lectura: true,
        total_desfases: totalDesfases,
        resumen: auditoria.resumen,
        resumen_por_ldn: conteoPorLdn,
        alertas_costo_cero: auditoria.alertas_costo_cero,
        recetas_huerfanas_omitidas: auditoria.recetas_huerfanas_omitidas,
        divergencias: div,
        selectores
    };
}

module.exports = {
    cargarSnapshotGrafo,
    clasificarLdnArticulo,
    resolverSubgrafoImpactado,
    simularCascada,
    aplicarCascada,
    auditarParidadPadron,
    obtenerRadarCostos,
    calcularPrecioB2BLista,
    calcularEscalon2OfertaGestor
};
