const defaultPool = require('../config/database');

/**
 * Servicio Determinista Único de Costos de Producción Propia LAMDA (Capa 5 — Mesa Integrada).
 *
 * Regla Rectora de Determinismo:
 *  - CERO inferencias por nombre libre o expresiones regulares para descubrir vínculos.
 *  - Toda resolución se apoya estrictamente en claves primarias y tablas relacionales oficiales:
 *      1. public.articulos_produccion_externa_relacion (LDN 4 Tostaderos, LDN 5 Barritas, LDN 6 Granolas)
 *      2. public.ingrediente_bunker_articulos + public.ingredientes.articulo_vinculado_numero (vínculo N:M explícito)
 *      3. public.recetas + public.receta_ingredientes + public.bunker_lista_articulos (LDN 2 Fraccionado Interno)
 *      4. public.ingrediente_composicion (LDN 3 Mixes Internos)
 *  - En materias primas primarias puras sin elaboración propia (ej. SZAX25, CRx25B, EMB-MN4UM1, ING-16),
 *    retorna { habilitada: false } para mantener oculta la Solapa 5 sin ruido visual.
 */

function clasificarLineaExterna(upSku, apSku, upDesc) {
    const skuRef = `${upSku || ''} ${apSku || ''}`.toUpperCase();
    const descRef = String(upDesc || '').toUpperCase();
    if (skuRef.includes('BFXP') || skuRef.includes('BFX50G') || descRef.includes('BARRITA') || descRef.includes('BARRA ')) {
        return 5;
    }
    if (skuRef.includes('GSGN') || skuRef.includes('GFGN') || descRef.includes('GRANA')) {
        return 6;
    }
    return 4;
}

async function obtenerDetalleInsumoCrudo({ sku, db = defaultPool }) {
    const cleanSku = String(sku || '').trim();
    if (!cleanSku) return null;

    const artRes = await db.query(
        `SELECT ba.articulo_id AS sku,
                COALESCE(ba.descripcion_generada, ba.descripcion, ba.articulo_id) AS descripcion,
                COALESCE(NULLIF(ba.kilos_unidad, 0), NULLIF(src.kilos_unidad, 0), 1.00) AS kilos_unidad,
                COALESCE(ba.costo_base, 0) AS costo_base_bulto,
                ba.updated_at AS costo_updated_at,
                COALESCE(src.stock_consolidado, 0) AS stock_bultos,
                ba.propiedades_dinamicas->>'articulo_principal' AS articulo_principal
         FROM public.bunker_articulos ba
         LEFT JOIN public.stock_real_consolidado src ON src.articulo_numero = ba.articulo_id
         WHERE UPPER(BTRIM(ba.articulo_id)) = UPPER(BTRIM($1))
         LIMIT 1`,
        [cleanSku]
    );

    if (artRes.rows.length === 0) return null;
    const row = artRes.rows[0];
    const kilosUnidad = parseFloat(row.kilos_unidad) > 0 ? parseFloat(row.kilos_unidad) : 1;
    const costoBaseBulto = parseFloat(row.costo_base_bulto) || 0;
    const costoRepoKilo = Number((costoBaseBulto / kilosUnidad).toFixed(2));
    const stockBultos = parseFloat(row.stock_bultos) || 0;

    const loteRes = await db.query(
        `SELECT d.costo_kilo_al_momento,
                v.lote_id_supabase,
                v.lote_codigo_corto,
                v.proveedor_nombre,
                v.articulo_descripcion,
                v.numero_remito,
                v.fecha_vinculacion
         FROM public.bunker_lotes_destinos d
         JOIN public.bunker_lotes_vinculos v ON v.id = d.vinculo_id
         WHERE UPPER(BTRIM(d.destino_id)) = UPPER(BTRIM($1))
           AND COALESCE(d.costo_kilo_al_momento, 0) > 0
         ORDER BY v.fecha_vinculacion DESC
         LIMIT 1`,
        [row.sku]
    );
    const loteRow = loteRes.rows[0] || null;

    return {
        sku: row.sku,
        descripcion: row.descripcion,
        kilos_unidad: kilosUnidad,
        costo_base_bulto: Number(costoBaseBulto.toFixed(2)),
        costo_repo_kilo: costoRepoKilo,
        costo_updated_at: row.costo_updated_at || null,
        stock_bultos: Number(stockBultos.toFixed(2)),
        stock_kilos: Number((stockBultos * kilosUnidad).toFixed(2)),
        articulo_principal: row.articulo_principal || null,
        lote_reciente: loteRow ? {
            costo_kilo: Number(parseFloat(loteRow.costo_kilo_al_momento).toFixed(2)),
            codigo: loteRow.lote_codigo_corto || loteRow.lote_id_supabase || 'Lote',
            proveedor_nombre: loteRow.proveedor_nombre || 'Depósito',
            descripcion: loteRow.articulo_descripcion || row.descripcion,
            numero_remito: loteRow.numero_remito || null,
            fecha: loteRow.fecha_vinculacion || null
        } : null
    };
}

async function construirFichaCircuitoExterno({ relRow, contextoOrigen, db }) {
    const upCodigo = relRow.up_sku;
    const apCodigo = relRow.ap_sku;
    const ldn = clasificarLineaExterna(upCodigo, apCodigo, relRow.up_desc);

    const kilosAp = parseFloat(relRow.ap_kilos) > 0 ? parseFloat(relRow.ap_kilos) : 1;
    const costoBaseApBd = Number(((parseFloat(relRow.ap_costo_base) || 0) / kilosAp).toFixed(2));
    const costoIngBd = Number((parseFloat(relRow.ing_costo_patron) || 0).toFixed(2));

    // Mano de obra interna activa de recepción/pesaje sobre el AP (Lista Patrón / Lista 1)
    const moApRes = await db.query(
        `SELECT costo_tiempo, COALESCE(mano_obra_activa, true) AS mano_obra_activa
         FROM public.bunker_lista_articulos
         WHERE UPPER(BTRIM(articulo_numero)) = UPPER(BTRIM($1))
         ORDER BY COALESCE(es_patron, false) DESC, CASE WHEN lista_id = 1 THEN 0 ELSE 1 END, lista_id ASC
         LIMIT 1`,
        [apCodigo]
    );
    const moRow = moApRes.rows[0];
    const moApKilo = (moRow && moRow.mano_obra_activa !== false)
        ? Number(((parseFloat(moRow.costo_tiempo) || 0) / kilosAp).toFixed(2))
        : 0;

    // Historial físico de cocciones reconstruido desde produccion_externa_historial + stock_ventas_movimientos
    const histRes = await db.query(
        `SELECT peh.id,
                peh.carro_id,
                peh.fecha_registro,
                peh.articulo_padre_id,
                peh.articulo_fraccionado_id,
                NULLIF(peh.kilos_entrada, 0) AS kilos_entrada_original,
                svm_rec.kilos_egresados_reales,
                svm_rec.sku_egresado_real,
                COALESCE(NULLIF(peh.kilos_salida, 0), peh.kilos_producidos) AS kilos_salida,
                peh.kilos_producidos
         FROM public.produccion_externa_historial peh
         LEFT JOIN LATERAL (
             SELECT SUM(
                 CASE
                     WHEN ABS(COALESCE(svm.kilos, 0)) > 0 THEN ABS(svm.kilos)
                     ELSE ABS(COALESCE(svm.cantidad, 0)) * COALESCE(NULLIF(ba_s.kilos_unidad, 0), NULLIF(src_s.kilos_unidad, 0), 1.00)
                 END
             ) AS kilos_egresados_reales,
             MAX(svm.articulo_numero) AS sku_egresado_real
             FROM public.stock_ventas_movimientos svm
             LEFT JOIN public.bunker_articulos ba_s ON ba_s.articulo_id = svm.articulo_numero
             LEFT JOIN public.stock_real_consolidado src_s ON src_s.articulo_numero = svm.articulo_numero
             WHERE svm.carro_id = peh.carro_id
               AND LOWER(COALESCE(svm.tipo, '')) LIKE '%egreso por receta externa%'
         ) svm_rec ON true
         WHERE (UPPER(BTRIM(peh.articulo_padre_id)) = UPPER(BTRIM($1))
            OR UPPER(BTRIM(peh.articulo_fraccionado_id)) = UPPER(BTRIM($2)))
           AND UPPER(BTRIM(COALESCE(peh.articulo_padre_id, ''))) <> UPPER(BTRIM(COALESCE(peh.articulo_fraccionado_id, '')))
         ORDER BY peh.fecha_registro DESC
         LIMIT 40`,
        [upCodigo, apCodigo]
    );

    let sumMermas = 0;
    let countValidas = 0;
    let ultimaMermaValida = null;
    const historialCocciones = [];

    histRes.rows.forEach((h, idx) => {
        const entRaw = ldn === 4
            ? (parseFloat(h.kilos_egresados_reales) || parseFloat(h.kilos_entrada_original) || 0)
            : (parseFloat(h.kilos_entrada_original) || parseFloat(h.kilos_egresados_reales) || 0);
        const salRaw = parseFloat(h.kilos_salida) || parseFloat(h.kilos_producidos) || 0;
        const faltaEntrada = !(entRaw > 0);
        const salidaExcede = entRaw > 0 && salRaw > entRaw + 0.0001;
        const mermaCalc = (entRaw > 0 && salRaw > 0) ? Number((((entRaw - salRaw) / entRaw) * 100).toFixed(2)) : null;
        const maxMerma = ldn === 6 ? 30 : 25;
        const fueraRango = (ldn === 4 || ldn === 6) && mermaCalc !== null && (mermaCalc < 0 || mermaCalc > maxMerma);
        const esInvalida = faltaEntrada || salidaExcede || !(salRaw > 0) || fueraRango;

        if (!esInvalida && mermaCalc !== null) {
            sumMermas += mermaCalc;
            countValidas++;
            if (ultimaMermaValida === null) ultimaMermaValida = mermaCalc;
        }

        if (idx < 10) {
            historialCocciones.push({
                id: h.id,
                carro_id: h.carro_id,
                fecha_registro: h.fecha_registro,
                kilos_entrada: entRaw > 0 ? Number(entRaw.toFixed(2)) : null,
                kilos_salida: salRaw > 0 ? Number(salRaw.toFixed(2)) : 0,
                porcentaje_merma: !esInvalida ? mermaCalc : null,
                es_invalida: esInvalida,
                sku_egresado_real: h.sku_egresado_real || null,
                motivo_invalida: esInvalida
                    ? (faltaEntrada ? 'Sin entrada física registrada' : (salidaExcede ? 'Salida mayor a entrada' : `Fuera de rango (0%-${maxMerma}%)`))
                    : null
            });
        }
    });

    const mermaPromedio = countValidas > 0 ? Number((sumMermas / countValidas).toFixed(2)) : 2.12;
    const ultimaMerma = ultimaMermaValida !== null ? ultimaMermaValida : mermaPromedio;

    // Si es LDN 5 (Barritas) o LDN 6 (Granolas), devolvemos ficha determinista informativa + acceso directo
    if (ldn === 5 || ldn === 6) {
        return {
            habilitada: true,
            tipo_ficha: 'COMPLEJA_RESUMEN',
            linea_negocio: ldn,
            etiqueta_pestana: `🏭 5. Prod. Propia (LDN ${ldn})`,
            contexto_origen: contextoOrigen,
            up_codigo: upCodigo,
            up_descripcion: relRow.up_desc,
            ap_codigo: apCodigo,
            ap_descripcion: relRow.ap_desc,
            ingrediente_id: relRow.ing_id || null,
            ingrediente_nombre: relRow.ing_nombre || relRow.ap_desc,
            costo_base_ap_bd: costoBaseApBd,
            mo_ap_kilo: moApKilo,
            costo_kilo_elaborado: costoIngBd > 0 ? costoIngBd : Number((costoBaseApBd + moApKilo).toFixed(2)),
            merma_promedio: mermaPromedio,
            total_cocciones_validas: countValidas,
            destino_panel_ldn: ldn
        };
    }

    // LDN 4: Simulador Interactivo Completo de Tostadero
    const crudoOficialSku = relRow.crudo_sku_receta || null;
    const crudoOficial = crudoOficialSku ? await obtenerDetalleInsumoCrudo({ sku: crudoOficialSku, db }) : null;

    // Bultos crudos alternativos deterministas (misma materia_prima_principal, Natural, >= 5kg, sin receta propia)
    const artPrincipal = crudoOficial?.articulo_principal || relRow.materia_prima_principal || null;
    let crudosAlternativos = [];
    if (artPrincipal) {
        const altRes = await db.query(
            `SELECT ba.articulo_id AS sku,
                    COALESCE(ba.descripcion_generada, ba.descripcion, ba.articulo_id) AS descripcion,
                    COALESCE(NULLIF(ba.kilos_unidad, 0), NULLIF(src.kilos_unidad, 0), 1.00) AS kilos_unidad,
                    COALESCE(ba.costo_base, 0) AS costo_base_bulto,
                    COALESCE(src.stock_consolidado, 0) AS stock_bultos,
                    COALESCE(
                        ba.propiedades_dinamicas->'posiciones'->'pos_5'->>'valor',
                        ba.propiedades_dinamicas->'posiciones'->'pos_4'->>'valor',
                        'Natural'
                    ) AS tratamiento
             FROM public.bunker_articulos ba
             LEFT JOIN public.stock_real_consolidado src ON src.articulo_numero = ba.articulo_id
             WHERE (
                 UPPER(BTRIM(ba.articulo_id)) = UPPER(BTRIM($1))
                 OR (
                     UPPER(BTRIM(COALESCE(ba.propiedades_dinamicas->>'articulo_principal', ''))) = UPPER(BTRIM($2))
                     AND COALESCE(ba.familia_id, 0) <> 42
                     AND COALESCE(ba.es_pack, false) = false
                     AND NULLIF(BTRIM(COALESCE(ba.pack_hijo_codigo, '')), '') IS NULL
                     AND COALESCE(NULLIF(ba.kilos_unidad, 0), NULLIF(src.kilos_unidad, 0), 0) >= 5
                     AND COALESCE((ba.propiedades_dinamicas->>'obsoleto')::boolean, false) = false
                     AND NOT EXISTS (SELECT 1 FROM public.recetas r_c WHERE r_c.articulo_numero = ba.articulo_id)
                 )
             )
             ORDER BY CASE WHEN UPPER(BTRIM(ba.articulo_id)) = UPPER(BTRIM($1)) THEN 0 ELSE 1 END,
                      COALESCE(src.stock_consolidado, 0) DESC,
                      ba.articulo_id ASC`,
            [crudoOficialSku || '', artPrincipal]
        );

        crudosAlternativos = altRes.rows
            .filter(r => {
                if (String(r.sku).toUpperCase() === String(crudoOficialSku || '').toUpperCase()) return true;
                const tratU = `${r.tratamiento || ''} ${r.descripcion || ''}`.toUpperCase();
                return !tratU.includes('TOST') && !tratU.includes('SALAD') && !tratU.includes('FRIT');
            })
            .map(r => {
                const ku = parseFloat(r.kilos_unidad) > 0 ? parseFloat(r.kilos_unidad) : 1;
                const sb = parseFloat(r.stock_bultos) || 0;
                return {
                    sku: r.sku,
                    descripcion: r.descripcion,
                    kilos_unidad: ku,
                    costo_repo_kilo: Number(((parseFloat(r.costo_base_bulto) || 0) / ku).toFixed(2)),
                    stock_bultos: Number(sb.toFixed(2)),
                    stock_kilos: Number((sb * ku).toFixed(2)),
                    es_oficial_up: String(r.sku).toUpperCase() === String(crudoOficialSku || '').toUpperCase()
                };
            });
    }

    // Colaboradores activos y sus tarifas parametrizadas (LATERAL evita duplicar filas por historial de valor_hora)
    const [colabsRes, serviciosRes] = await Promise.all([
        db.query(
            `SELECT u.id AS usuario_id,
                    COALESCE(NULLIF(BTRIM(u.nombre_completo), ''), u.usuario) AS nombre,
                    u.usuario,
                    COALESCE(ct_act.valor_hora, 0) AS valor_hora
             FROM public.usuarios u
             LEFT JOIN LATERAL (
                 SELECT ct.valor_hora
                 FROM public.colaboradores_tarifas ct
                 WHERE ct.usuario_id = u.id AND COALESCE(ct.activo, true) = true
                 ORDER BY ct.fecha_desde DESC NULLS LAST, ct.id DESC
                 LIMIT 1
             ) ct_act ON true
             WHERE COALESCE(u.activo, true) = true
             ORDER BY COALESCE(NULLIF(BTRIM(u.nombre_completo), ''), u.usuario) ASC`
        ),
        db.query(
            `SELECT ctr.id,
                    ctr.usuario_id,
                    ctr.articulo_numero,
                    COALESCE(ba.descripcion_generada, ba.descripcion, ctr.articulo_numero) AS descripcion,
                    ctr.valor_por_unidad,
                    COALESCE(ctr.unidad_medida, 'kg') AS unidad_medida
             FROM public.colaboradores_tarifas_rendimiento ctr
             LEFT JOIN public.bunker_articulos ba ON UPPER(BTRIM(ba.articulo_id)) = UPPER(BTRIM(ctr.articulo_numero))
             WHERE COALESCE(ctr.activo, true) = true
             ORDER BY ctr.id ASC`
        )
    ]);

    const serviciosPorUsuario = new Map();
    serviciosRes.rows.forEach(s => {
        const uid = Number(s.usuario_id);
        if (!serviciosPorUsuario.has(uid)) serviciosPorUsuario.set(uid, []);
        serviciosPorUsuario.get(uid).push({
            id: s.id,
            articulo_numero: s.articulo_numero,
            descripcion: s.descripcion,
            valor_por_unidad: Number(parseFloat(s.valor_por_unidad || 0).toFixed(2)),
            unidad_medida: s.unidad_medida
        });
    });

    const colaboradores = colabsRes.rows
        .map(c => ({
            usuario_id: Number(c.usuario_id),
            nombre: c.nombre,
            valor_hora: Number(parseFloat(c.valor_hora || 0).toFixed(2)),
            servicios: serviciosPorUsuario.get(Number(c.usuario_id)) || []
        }))
        .filter(c => c.servicios.length > 0 || c.valor_hora > 0);

    // Resolver parámetros iniciales deterministas respetando tostadero_simulacion (misma regla que Pizarra LDN 4)
    const simSaved = relRow.tostadero_simulacion && !relRow.tostadero_simulacion.es_comparacion_bulto_comprado
        ? relRow.tostadero_simulacion
        : null;
    const fuenteLdn4 = relRow.fuente_abastecimiento_ldn4 || null;

    let servicioMatch = null;
    let colabInicialId = simSaved?.colaborador_id ? Number(simSaved.colaborador_id) : null;
    for (const c of colaboradores) {
        const found = c.servicios.find(s =>
            (simSaved?.servicio_id && String(s.id) === String(simSaved.servicio_id)) ||
            String(s.articulo_numero || '').toUpperCase() === String(apCodigo).toUpperCase() ||
            String(s.articulo_numero || '').toUpperCase() === String(upCodigo).toUpperCase()
        );
        if (found) {
            servicioMatch = found;
            if (!colabInicialId) colabInicialId = c.usuario_id;
            break;
        }
    }
    if (!colabInicialId && colaboradores[0]) {
        colabInicialId = colaboradores[0].usuario_id;
    }

    const tarifaInicial = (simSaved && simSaved.tarifa !== undefined && simSaved.tarifa !== null && !isNaN(parseFloat(simSaved.tarifa)))
        ? Number(parseFloat(simSaved.tarifa).toFixed(2))
        : (servicioMatch ? servicioMatch.valor_por_unidad : 1050.00);
    const mermaInicial = (simSaved && simSaved.merma !== undefined && simSaved.merma !== null && !isNaN(parseFloat(simSaved.merma)))
        ? Number(parseFloat(simSaved.merma).toFixed(2))
        : mermaPromedio;

    const repoCrudoKg = crudoOficial?.costo_repo_kilo || 0;
    const loteCrudoKg = crudoOficial?.lote_reciente?.costo_kilo || null;
    let fuenteCrudoInicial = 'REPO';
    let costoCrudoInicial = repoCrudoKg > 0 ? repoCrudoKg : (loteCrudoKg || 0);

    if (
        simSaved &&
        (!simSaved.insumo_evaluado_sku || String(simSaved.insumo_evaluado_sku).trim().toUpperCase() === String(crudoOficialSku || '').trim().toUpperCase())
    ) {
        const simCostKg = parseFloat(simSaved.costo_crudo_kg);
        const simTs = simSaved.updated_at ? Date.parse(simSaved.updated_at) : 0;
        const crudoTs = crudoOficial?.costo_updated_at ? Date.parse(crudoOficial.costo_updated_at) : 0;
        const repoCambioPostSim = Boolean(
            repoCrudoKg > 0 &&
            (
                (simTs > 0 && crudoTs > simTs && Math.abs(repoCrudoKg - simCostKg) > 0.02) ||
                (simSaved.costo_repo_referencia_kg !== undefined && simSaved.costo_repo_referencia_kg !== null && Math.abs((parseFloat(simSaved.costo_repo_referencia_kg) || 0) - repoCrudoKg) > 0.02)
            )
        );
        if (simSaved.fuente_costo === 'LOTE' && loteCrudoKg > 0) {
            fuenteCrudoInicial = 'LOTE';
            costoCrudoInicial = loteCrudoKg;
        } else if (simCostKg > 0 && (simSaved.fuente_costo === 'MANUAL' || simSaved.fuente_costo === 'OFERTA' || (!simSaved.fuente_costo && (simTs >= crudoTs || !(repoCrudoKg > 0)))) && !repoCambioPostSim) {
            fuenteCrudoInicial = simSaved.fuente_costo || 'MANUAL';
            costoCrudoInicial = Number(simCostKg.toFixed(2));
        }
    }

    const factorRend = 1 - (mermaInicial / 100);
    const costoBaseApCalc = factorRend > 0 ? Number(((costoCrudoInicial / factorRend) + tarifaInicial).toFixed(2)) : 0;
    const costoIngCalc = Number((costoBaseApCalc + moApKilo).toFixed(2));

    // Fracciones directas + packs y Mixes LDN 3 que consumen este ingrediente
    let fraccionesAfectadas = [];
    let mixesAfectados = [];
    if (relRow.ing_id) {
        const [fracRes, mixRes] = await Promise.all([
            db.query(
                `WITH directas AS (
                     SELECT DISTINCT r.articulo_numero
                     FROM public.recetas r
                     JOIN public.receta_ingredientes ri ON ri.receta_id = r.id
                     WHERE ri.ingrediente_id = $1
                 )
                 SELECT ba.articulo_id AS sku,
                        COALESCE(ba.descripcion_generada, ba.descripcion, ba.articulo_id) AS descripcion,
                        COALESCE(NULLIF(ba.kilos_unidad, 0), 1) AS kilos_unidad,
                        (ba.pack_hijo_codigo IS NOT NULL) AS es_pack
                 FROM public.bunker_articulos ba
                 WHERE UPPER(BTRIM(ba.articulo_id)) NOT IN (UPPER(BTRIM($2)), UPPER(BTRIM($3)))
                   AND COALESCE(ba.familia_id, 0) <> 42
                   AND COALESCE(ba.no_producido_por_lambda, false) = false
                   AND COALESCE((ba.propiedades_dinamicas->>'obsoleto')::boolean, false) = false
                   AND (
                       ba.articulo_id IN (SELECT articulo_numero FROM directas)
                       OR ba.pack_hijo_codigo IN (SELECT articulo_numero FROM directas)
                   )
                 ORDER BY COALESCE(ba.kilos_unidad, 1) ASC, ba.articulo_id ASC`,
                [relRow.ing_id, apCodigo, upCodigo]
            ),
            db.query(
                `SELECT DISTINCT m.id, m.nombre
                 FROM public.ingrediente_composicion ic
                 JOIN public.ingredientes m ON m.id = ic.mix_id
                 WHERE ic.ingrediente_id = $1
                 ORDER BY m.id ASC`,
                [relRow.ing_id]
            )
        ]);
        fraccionesAfectadas = fracRes.rows.map(f => ({
            sku: f.sku,
            descripcion: f.descripcion,
            kilos_unidad: parseFloat(f.kilos_unidad) || 1,
            es_pack: Boolean(f.es_pack)
        }));
        mixesAfectados = mixRes.rows;
    }

    return {
        habilitada: true,
        tipo_ficha: 'LDN4_TOSTADERO',
        linea_negocio: 4,
        etiqueta_pestana: '🏭 5. Producción Propia (Tostadero)',
        contexto_origen: contextoOrigen,
        up_codigo: upCodigo,
        up_descripcion: relRow.up_desc,
        ap_codigo: apCodigo,
        ap_descripcion: relRow.ap_desc,
        ap_kilos_unidad: kilosAp,
        mo_ap_kilo: moApKilo,
        ingrediente_id: relRow.ing_id || null,
        ingrediente_nombre: relRow.ing_nombre || relRow.ap_desc,
        costo_base_ap_bd: costoBaseApBd,
        costo_ingrediente_bd: costoIngBd,
        modo_rector_actual: fuenteLdn4?.modo_rector || 'PRODUCCION_UP',
        fuente_abastecimiento_ldn4: fuenteLdn4,
        crudo_actual: crudoOficial,
        crudos_alternativos: crudosAlternativos,
        colaboradores: colaboradores,
        historial_cocciones: historialCocciones,
        merma_promedio: mermaPromedio,
        ultima_merma: ultimaMerma,
        total_cocciones_validas: countValidas,
        parametros_iniciales: {
            crudo_sku: crudoOficial?.sku || crudoOficialSku,
            fuente_costo_crudo: fuenteCrudoInicial,
            costo_crudo_kg: costoCrudoInicial,
            colaborador_id: colabInicialId,
            servicio_id: servicioMatch ? servicioMatch.id : (simSaved?.servicio_id || null),
            tarifa_kg: tarifaInicial,
            merma_pct: mermaInicial,
            costo_base_ap_calculado: costoBaseApCalc,
            costo_ingrediente_calculado: costoIngCalc
        },
        costo_kilo_elaborado: costoIngCalc,
        fracciones_afectadas: fraccionesAfectadas,
        mixes_afectados: mixesAfectados
    };
}

async function construirFichaFraccionadoReceta({ artRow, recetaRow, db }) {
    const sku = artRow.articulo_id;
    const kilosUnidad = parseFloat(artRow.kilos_unidad) > 0 ? parseFloat(artRow.kilos_unidad) : 1;
    const costoActualBdBulto = Number((parseFloat(artRow.costo_base) || 0).toFixed(2));
    const costoActualBdKilo = Number((costoActualBdBulto / kilosUnidad).toFixed(2));

    const [itemsRes, listaPatronRes] = await Promise.all([
        db.query(
            `SELECT ri.ingrediente_id,
                    ri.cantidad,
                    i.nombre,
                    COALESCE(i.unidad_medida, 'Kilo') AS unidad_medida,
                    COALESCE(i.es_insumo, false) AS es_insumo,
                    COALESCE(i.costo_patron, 0) AS costo_patron,
                    i.articulo_vinculado_numero,
                    ba_m.descripcion_generada AS madre_desc,
                    COALESCE(NULLIF(ba_m.kilos_unidad, 0), 1) AS madre_kilos,
                    COALESCE(src_m.stock_consolidado, 0) AS madre_stock_bultos,
                    r_ext.articulo_produccion_codigo AS origen_up_sku
             FROM public.receta_ingredientes ri
             JOIN public.ingredientes i ON i.id = ri.ingrediente_id
             LEFT JOIN public.bunker_articulos ba_m ON UPPER(BTRIM(ba_m.articulo_id)) = UPPER(BTRIM(i.articulo_vinculado_numero))
             LEFT JOIN public.stock_real_consolidado src_m ON UPPER(BTRIM(src_m.articulo_numero)) = UPPER(BTRIM(i.articulo_vinculado_numero))
             LEFT JOIN public.articulos_produccion_externa_relacion r_ext
               ON UPPER(BTRIM(r_ext.articulo_kilo_codigo)) = UPPER(BTRIM(i.articulo_vinculado_numero))
              AND UPPER(BTRIM(r_ext.articulo_produccion_codigo)) <> UPPER(BTRIM(r_ext.articulo_kilo_codigo))
             WHERE ri.receta_id = $1
             ORDER BY COALESCE(i.es_insumo, false) ASC, ri.ingrediente_id ASC`,
            [recetaRow.id]
        ),
        db.query(
            `SELECT bla.id,
                    bla.lista_id,
                    COALESCE(bla.costo_tiempo, 0) AS costo_tiempo,
                    COALESCE(bla.mano_obra_activa, true) AS mano_obra_activa,
                    COALESCE((
                        SELECT SUM(bli.cantidad * COALESCE(ing_l.costo_patron, ba_l.costo_base, bli.costo_unitario_capturado, 0))
                        FROM public.bunker_lista_insumos bli
                        LEFT JOIN public.ingredientes ing_l ON ing_l.id::text = bli.insumo_articulo_numero
                        LEFT JOIN public.bunker_articulos ba_l ON ba_l.articulo_id = bli.insumo_articulo_numero
                        WHERE bli.lista_articulo_id = bla.id AND COALESCE(bli.incluido, true) = true
                    ), 0) AS costo_insumos_lista
             FROM public.bunker_lista_articulos bla
             WHERE UPPER(BTRIM(bla.articulo_numero)) = UPPER(BTRIM($1))
             ORDER BY COALESCE(bla.es_patron, false) DESC, CASE WHEN bla.lista_id = 1 THEN 0 ELSE 1 END, bla.lista_id ASC
             LIMIT 1`,
            [sku]
        )
    ]);

    let subtotalMateriaPrima = 0;
    let subtotalEnvasesReceta = 0;

    const componentes = itemsRes.rows.map(it => {
        const cant = parseFloat(it.cantidad) || 0;
        const unit = parseFloat(it.costo_patron) || 0;
        const sub = Number((cant * unit).toFixed(2));
        if (it.es_insumo) subtotalEnvasesReceta += sub;
        else subtotalMateriaPrima += sub;
        return {
            ingrediente_id: it.ingrediente_id,
            nombre: it.nombre,
            es_insumo: Boolean(it.es_insumo),
            cantidad: cant,
            unidad_medida: it.unidad_medida,
            costo_unitario: Number(unit.toFixed(2)),
            subtotal: sub,
            bulto_madre_sku: it.articulo_vinculado_numero || null,
            bulto_madre_descripcion: it.madre_desc || null,
            bulto_madre_kilos: parseFloat(it.madre_kilos) || 1,
            bulto_madre_stock_bultos: Number((parseFloat(it.madre_stock_bultos) || 0).toFixed(2)),
            origen_up_sku: it.origen_up_sku || null
        };
    });

    const lp = listaPatronRes.rows[0] || null;
    const moBulto = (lp && lp.mano_obra_activa !== false) ? Number((parseFloat(lp.costo_tiempo) || 0).toFixed(2)) : 0;
    const insumosListaBulto = lp ? Number((parseFloat(lp.costo_insumos_lista) || 0).toFixed(2)) : 0;

    const costoSinMoBulto = Number((subtotalMateriaPrima + subtotalEnvasesReceta + insumosListaBulto).toFixed(2));
    const costoSinMoKilo = Number((costoSinMoBulto / kilosUnidad).toFixed(2));
    const costoTotalElaboradoBulto = Number((costoSinMoBulto + moBulto).toFixed(2));
    const costoTotalElaboradoKilo = Number((costoTotalElaboradoBulto / kilosUnidad).toFixed(2));

    return {
        habilitada: true,
        tipo_ficha: 'LDN2_FRACCIONADO',
        linea_negocio: 2,
        etiqueta_pestana: '🏭 5. Producción Propia (Fraccionado)',
        articulo_id: sku,
        descripcion: artRow.descripcion_generada || artRow.descripcion || sku,
        kilos_unidad: kilosUnidad,
        receta_id: recetaRow.id,
        componentes_receta: componentes,
        subtotal_materia_prima_bulto: Number(subtotalMateriaPrima.toFixed(2)),
        subtotal_envases_bulto: Number((subtotalEnvasesReceta + insumosListaBulto).toFixed(2)),
        mo_fraccionado_bulto: moBulto,
        mo_fraccionado_kilo: Number((moBulto / kilosUnidad).toFixed(2)),
        costo_sin_mo_bulto: costoSinMoBulto,
        costo_sin_mo_kilo: costoSinMoKilo,
        costo_total_elaborado_bulto: costoTotalElaboradoBulto,
        costo_total_elaborado_kilo: costoTotalElaboradoKilo,
        costo_kilo_elaborado: costoTotalElaboradoKilo,
        costo_actual_bd_bulto: costoActualBdBulto,
        costo_actual_bd_kilo: costoActualBdKilo
    };
}

async function resolverFichaProduccionPropia({ articuloId, ingredienteId = null, db = defaultPool }) {
    const rawArt = String(articuloId || '').trim();
    const esTokenIng = /^ING-?\d+$/i.test(rawArt);
    const parsedIngId = ingredienteId
        ? parseInt(ingredienteId, 10)
        : (esTokenIng ? parseInt(rawArt.replace(/^ING-?/i, ''), 10) : null);

    // 1. Si se abrió sobre un artículo concreto de Búnker (no ING-xxx), inspeccionar primero su identidad estructural
    let artRow = null;
    if (!esTokenIng && rawArt) {
        const artRes = await db.query(
            `SELECT articulo_id, descripcion, descripcion_generada, familia_id, kilos_unidad, costo_base, pack_hijo_codigo, propiedades_dinamicas
             FROM public.bunker_articulos
             WHERE UPPER(BTRIM(articulo_id)) = UPPER(BTRIM($1))
             LIMIT 1`,
            [rawArt]
        );
        artRow = artRes.rows[0] || null;
    }

    // 1.a ¿Es directamente un AP o UP de articulos_produccion_externa_relacion?
    const queryCircuitoExterno = `
        SELECT r.id AS rel_id,
               r.articulo_produccion_codigo AS up_sku,
               COALESCE(ba_up.descripcion_generada, ba_up.descripcion, r.articulo_produccion_codigo) AS up_desc,
               r.articulo_kilo_codigo AS ap_sku,
               COALESCE(ba_ap.descripcion_generada, ba_ap.descripcion, r.articulo_kilo_codigo) AS ap_desc,
               COALESCE(NULLIF(ba_ap.kilos_unidad, 0), 1.00) AS ap_kilos,
               COALESCE(ba_ap.costo_base, 0) AS ap_costo_base,
               ba_ap.propiedades_dinamicas->'tostadero_simulacion' AS tostadero_simulacion,
               ba_ap.propiedades_dinamicas->'fuente_abastecimiento_ldn4' AS fuente_abastecimiento_ldn4,
               COALESCE(
                   NULLIF(BTRIM(ba_crudo.propiedades_dinamicas->>'articulo_principal'), ''),
                   NULLIF(BTRIM(ba_ap.propiedades_dinamicas->'posiciones'->'pos_3'->>'valor'), '')
               ) AS materia_prima_principal,
               ra.articulo_numero AS crudo_sku_receta,
               ing_esp.id AS ing_id,
               ing_esp.nombre AS ing_nombre,
               COALESCE(ing_esp.costo_patron, 0) AS ing_costo_patron
        FROM public.articulos_produccion_externa_relacion r
        JOIN public.bunker_articulos ba_up ON UPPER(BTRIM(ba_up.articulo_id)) = UPPER(BTRIM(r.articulo_produccion_codigo))
        LEFT JOIN public.bunker_articulos ba_ap ON UPPER(BTRIM(ba_ap.articulo_id)) = UPPER(BTRIM(r.articulo_kilo_codigo))
        LEFT JOIN public.recetas rec_up ON UPPER(BTRIM(rec_up.articulo_numero)) = UPPER(BTRIM(r.articulo_produccion_codigo))
        LEFT JOIN LATERAL (
            SELECT ra_i.articulo_numero
            FROM public.receta_articulos ra_i
            WHERE ra_i.receta_id = rec_up.id
            ORDER BY ra_i.articulo_numero ASC
            LIMIT 1
        ) ra ON true
        LEFT JOIN public.bunker_articulos ba_crudo ON UPPER(BTRIM(ba_crudo.articulo_id)) = UPPER(BTRIM(ra.articulo_numero))
        LEFT JOIN public.ingredientes ing_esp ON UPPER(BTRIM(COALESCE(ing_esp.articulo_vinculado_numero, ''))) = UPPER(BTRIM(r.articulo_kilo_codigo))
        WHERE UPPER(BTRIM(r.articulo_produccion_codigo)) <> UPPER(BTRIM(r.articulo_kilo_codigo))
    `;

    if (artRow) {
        const directExt = await db.query(
            `${queryCircuitoExterno}
             AND (UPPER(BTRIM(r.articulo_kilo_codigo)) = UPPER(BTRIM($1)) OR UPPER(BTRIM(r.articulo_produccion_codigo)) = UPPER(BTRIM($1)))
             ORDER BY r.id ASC LIMIT 1`,
            [artRow.articulo_id]
        );
        if (directExt.rows.length > 0) {
            return construirFichaCircuitoExterno({
                relRow: directExt.rows[0],
                contextoOrigen: { tipo: 'ARTICULO_PUENTE', sku_abierto: artRow.articulo_id },
                db
            });
        }

        // 1.b ¿Es una fracción comercial con receta propia (LDN 2, ej. SZPX10 x 5kg, CRx5 x 5kg)?
        if (Number(artRow.familia_id || 0) !== 42) {
            const recRes = await db.query(
                `SELECT id, articulo_numero, descripcion FROM public.recetas WHERE UPPER(BTRIM(articulo_numero)) = UPPER(BTRIM($1)) LIMIT 1`,
                [artRow.articulo_id]
            );
            if (recRes.rows.length > 0) {
                return construirFichaFraccionadoReceta({ artRow, recetaRow: recRes.rows[0], db });
            }
        }

        // 1.c Es un bulto sin receta (LDN 1, ej. CCWTX22,68 o EMB-XBN4S5): verificar transitividad estricta por ingrediente_bunker_articulos
        const vincRes = await db.query(
            `SELECT DISTINCT i.id AS ing_id, i.nombre AS ing_nombre, i.articulo_vinculado_numero
             FROM public.ingredientes i
             LEFT JOIN public.ingrediente_bunker_articulos iba ON iba.ingrediente_id = i.id
             WHERE UPPER(BTRIM(COALESCE(iba.bunker_articulo_id, ''))) = UPPER(BTRIM($1))
                OR UPPER(BTRIM(COALESCE(i.articulo_vinculado_numero, ''))) = UPPER(BTRIM($1))
             ORDER BY i.id ASC`,
            [artRow.articulo_id]
        );

        for (const vRow of vincRes.rows) {
            // Buscar si ese ingrediente vinculado tiene un circuito de Producción Externa (distinto del bulto crudo de entrada!)
            const extTrans = await db.query(
                `${queryCircuitoExterno}
                 AND (
                     ing_esp.id = $1
                     OR UPPER(BTRIM(r.articulo_kilo_codigo)) IN (
                         SELECT UPPER(BTRIM(iba2.bunker_articulo_id)) FROM public.ingrediente_bunker_articulos iba2 WHERE iba2.ingrediente_id = $1
                         UNION
                         SELECT UPPER(BTRIM(COALESCE(i2.articulo_vinculado_numero, ''))) FROM public.ingredientes i2 WHERE i2.id = $1
                     )
                 )
                 AND UPPER(BTRIM(COALESCE(ra.articulo_numero, ''))) <> UPPER(BTRIM($2))
                 ORDER BY r.id ASC LIMIT 1`,
                [vRow.ing_id, artRow.articulo_id]
            );
            if (extTrans.rows.length > 0) {
                return construirFichaCircuitoExterno({
                    relRow: extTrans.rows[0],
                    contextoOrigen: {
                        tipo: 'BULTO_COMPRADO_VINCULADO',
                        sku_bulto_comprado: artRow.articulo_id,
                        descripcion_bulto_comprado: artRow.descripcion_generada || artRow.descripcion || artRow.articulo_id,
                        kilos_bulto_comprado: parseFloat(artRow.kilos_unidad) || 1,
                        ingrediente_puente_id: vRow.ing_id
                    },
                    db
                });
            }
        }

        return { habilitada: false };
    }

    // 2. Se abrió desde un Ingrediente de Fábrica (ING-xxx)
    if (parsedIngId && !isNaN(parsedIngId)) {
        const extIng = await db.query(
            `${queryCircuitoExterno}
             AND (
                 ing_esp.id = $1
                 OR UPPER(BTRIM(r.articulo_kilo_codigo)) IN (
                     SELECT UPPER(BTRIM(iba.bunker_articulo_id)) FROM public.ingrediente_bunker_articulos iba WHERE iba.ingrediente_id = $1
                     UNION
                     SELECT UPPER(BTRIM(COALESCE(i.articulo_vinculado_numero, ''))) FROM public.ingredientes i WHERE i.id = $1
                 )
             )
             ORDER BY r.id ASC LIMIT 1`,
            [parsedIngId]
        );
        if (extIng.rows.length > 0) {
            return construirFichaCircuitoExterno({
                relRow: extIng.rows[0],
                contextoOrigen: { tipo: 'INGREDIENTE_FABRICA', ingrediente_id: parsedIngId },
                db
            });
        }

        // 2.b ¿Es un Mix Interno de LDN 3 (o el Ingrediente Simple vinculado al AP de un Mix)?
        const mixRes = await db.query(
            `SELECT m.id AS mix_id, m.nombre AS mix_nombre, COALESCE(m.costo_patron, 0) AS mix_costo,
                    ba_ap.articulo_id AS ap_sku, ba_ap.descripcion_generada AS ap_desc
             FROM public.ingredientes m
             JOIN public.ingrediente_composicion ic ON ic.mix_id = m.id
             LEFT JOIN public.receta_ingredientes ri ON ri.ingrediente_id = m.id
             LEFT JOIN public.recetas r ON r.id = ri.receta_id
             LEFT JOIN public.bunker_articulos ba_ap ON ba_ap.articulo_id = r.articulo_numero AND COALESCE(ba_ap.familia_id, 0) = 42
             LEFT JOIN public.ingredientes i_s ON UPPER(BTRIM(COALESCE(i_s.articulo_vinculado_numero, ''))) = UPPER(BTRIM(ba_ap.articulo_id))
             WHERE m.id = $1 OR i_s.id = $1
             LIMIT 1`,
            [parsedIngId]
        );
        if (mixRes.rows.length > 0) {
            const mx = mixRes.rows[0];
            return {
                habilitada: true,
                tipo_ficha: 'COMPLEJA_RESUMEN',
                linea_negocio: 3,
                etiqueta_pestana: '🏭 5. Prod. Propia (Mix LDN 3)',
                contexto_origen: { tipo: 'INGREDIENTE_FABRICA', ingrediente_id: parsedIngId },
                mix_id: mx.mix_id,
                up_codigo: `MIX-${mx.mix_id}`,
                up_descripcion: mx.mix_nombre,
                ap_codigo: mx.ap_sku || null,
                ap_descripcion: mx.ap_desc || mx.mix_nombre,
                ingrediente_id: parsedIngId,
                ingrediente_nombre: mx.mix_nombre,
                costo_kilo_elaborado: Number(parseFloat(mx.mix_costo || 0).toFixed(2)),
                destino_panel_ldn: 3
            };
        }
    }

    return { habilitada: false };
}

module.exports = {
    resolverFichaProduccionPropia,
    obtenerDetalleInsumoCrudo
};
