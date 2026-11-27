'use strict';

/**
 * ============================================================================
 * SERVICIO MODULAR ESCALABLE — ETAPA 4 (GOBERNANZA 3 NIVELES SIN BLOBS)
 * ============================================================================
 * - Separa las consultas de administración de Pizarra y Centro de Nodos en
 *   endpoints modulares paginados con 0 bytes de base64/ZPL en listados.
 * - Implementa operaciones atómicas por celda y masivas sobre N nodos para los
 *   3 niveles de disponibilidad:
 *     1) Global LAMDA: `nodos_articulos_catalogo.activo`
 *     2) LAMDA por Nodo: `nodos_ofertas_gestor.habilitado_lamda`
 *     3) Tienda Vecinal: `nodos_ofertas_gestor.publicado_tienda`
 */

const db = require('../config/database');
const combosCompuestosService = require('./combosCompuestosService');
const jerarquiaBunkerHelper = require('../../shared/jerarquiaBunkerHelper');
const lamdaImagenesBaseService = require('./lamdaImagenesBaseService');

function obtenerHelpersFiscalesNodos() {
    const {
        calcularPrecioYGananciaNetaOfertaNodo,
        normalizarAlicuotaFiscalNodo
    } = require('./nodosBarrialesService');
    return { calcularPrecioYGananciaNetaOfertaNodo, normalizarAlicuotaFiscalNodo };
}

function normalizarPerfilCanonico(raw) {
    const val = String(raw || '').trim().toLowerCase();
    if (val === 'redes' || val === 'ecommerce_fulfillment' || val === 'creador_online' || val === 'fulfillment_lamda') {
        return 'REDES';
    }
    if (val === 'locales' || val === 'local' || val === 'comercio_pickup' || val === 'pickup_point' || val === 'local_fisico') {
        return 'LOCALES';
    }
    if (val === 'vecinos' || val === 'barrial' || val === 'gestor') {
        return 'VECINOS';
    }
    return '';
}

function esModoLab() {
    return String(process.env.LAMDA_MODO_LABORATORIO || '').trim().toLowerCase() === 'true'
        && String(process.env.DB_NAME || '').trim() === 'etiquetas_pruebas';
}

function sanitizarTemaVisualSinBase64(temaRaw) {
    if (!temaRaw || typeof temaRaw !== 'object') return {};
    const copia = { ...temaRaw };
    if (copia.logos && typeof copia.logos === 'object') {
        const limpios = {};
        for (const [k, v] of Object.entries(copia.logos)) {
            if (typeof v === 'string' && v.trim().startsWith('data:')) continue;
            limpios[k] = v;
        }
        copia.logos = limpios;
    }
    return copia;
}

/**
 * Resumen modular ligero de Nodos, listas canal NODOS, contadores y configuración canal.
 * Garantiza 0 bytes de logo_original_base64, logo_mono_preview_base64 y logo_zpl_gfa.
 */
async function obtenerResumenNodosEscalable(runner = null) {
    const q = runner || db;

    const [nodosRes, contRes, listasRes, polRes, cfgCanalRes] = await Promise.all([
        q.query(`
            SELECT
                nm.id,
                nm.codigo_nodo,
                nm.slug,
                nm.slug_historico,
                nm.nombre_marca,
                nm.bajada_marca,
                nm.subtitulo_marca,
                nm.gestor_nombre,
                nm.gestor_telefono,
                nm.gestor_email,
                nm.barrio_zona,
                nm.direccion_retiro,
                nm.latitud,
                nm.longitud,
                nm.perfil_operativo,
                COALESCE(nm.activo, true) AS activo,
                nm.color_primario,
                COALESCE(nm.margen_gestor_default_pct, 28.00)::numeric(6,2) AS margen_gestor_default_pct,
                COALESCE(nm.alicuota_iva_margen_pct, 21.00)::numeric(5,2) AS alicuota_iva_margen_pct,
                COALESCE(nm.alicuota_iibb_margen_pct, 4.00)::numeric(5,2) AS alicuota_iibb_margen_pct,
                nm.lista_precio_bunker_id,
                lp.nombre AS lista_precio_bunker_nombre,
                nm.cliente_madre_bunker_id,
                nm.codigo_bunker_cliente_madre,
                nm.bunker_cliente_id,
                nm.codigo_bunker_cliente,
                nm.cliente_operativo_id,
                COALESCE(nm.usar_cuenta_madre_unificada, false) AS usar_cuenta_madre_unificada,
                COALESCE(nm.usa_cuenta_compartida, true) AS usa_cuenta_compartida,
                nm.alias_bancario_display,
                COALESCE(nm.permitir_retiro_nodo, true) AS permitir_retiro_nodo,
                COALESCE(nm.permitir_reparto_propio, nm.permitir_envio_barrial, false) AS permitir_reparto_propio,
                COALESCE(nm.permitir_encomienda, false) AS permitir_encomienda,
                COALESCE(nm.cargo_envio_barrial, 0)::numeric(12,2) AS cargo_envio_barrial,
                COALESCE(nm.mostrar_ingredientes_tienda, true) AS mostrar_ingredientes_tienda,
                (nm.logo_original_base64 IS NOT NULL AND LENGTH(nm.logo_original_base64) > 0) AS tiene_logo_imagen,
                (nm.logo_zpl_gfa IS NOT NULL AND LENGTH(nm.logo_zpl_gfa) > 0) AS tiene_logo_zpl,
                bc_madre.cliente_nombre AS cliente_madre_nombre,
                bc_madre.razon_social AS cliente_madre_razon_social,
                bc_madre.lomas_soft_id AS cliente_madre_lomas_id,
                COALESCE(cc.saldo, 0)::numeric(14,2) AS saldo_cuenta_corriente,
                COALESCE(cc_madre.saldo, 0)::numeric(14,2) AS saldo_cuenta_corriente_madre,
                COALESCE(of_agg.total_habilitadas, 0)::int AS total_ofertas_habilitadas,
                COALESCE(of_agg.total_publicadas, 0)::int AS total_ofertas_publicadas
            FROM public.nodos_maestro nm
            LEFT JOIN public.bunker_listas_precios lp ON lp.id = nm.lista_precio_bunker_id
            LEFT JOIN public.bunker_clientes bc_madre ON bc_madre.id = nm.cliente_madre_bunker_id
            LEFT JOIN public.factura_cuentas_corrientes cc ON cc.codigo_bunker_cliente = nm.codigo_bunker_cliente
            LEFT JOIN public.factura_cuentas_corrientes cc_madre
              ON cc_madre.codigo_bunker_cliente = nm.codigo_bunker_cliente_madre
             AND cc_madre.nombre_cuenta = 'Cuenta Principal'
            LEFT JOIN LATERAL (
                SELECT
                    COUNT(*) FILTER (WHERE COALESCE(nog.habilitado_lamda, true) = true AND nac.activo = true) AS total_habilitadas,
                    COUNT(*) FILTER (WHERE nog.publicado_tienda = true AND COALESCE(nog.habilitado_lamda, true) = true AND nac.activo = true) AS total_publicadas
                FROM public.nodos_ofertas_gestor nog
                JOIN public.nodos_articulos_catalogo nac ON nac.id = nog.articulo_catalogo_id
                WHERE nog.nodo_id = nm.id
            ) of_agg ON true
            ORDER BY nm.activo DESC, nm.id ASC
        `),
        q.query(`
            SELECT
                (SELECT COUNT(*) FILTER (WHERE COALESCE(activo, true) = true)::int FROM public.nodos_maestro) AS nodos_activos,
                (SELECT COUNT(*) FILTER (WHERE activo = false)::int FROM public.nodos_maestro) AS nodos_archivados,
                (SELECT COUNT(*)::int FROM public.nodos_articulos_catalogo) AS catalogo_total,
                (SELECT COUNT(*) FILTER (WHERE activo = true)::int FROM public.nodos_articulos_catalogo) AS catalogo_activos,
                (SELECT COUNT(*) FILTER (WHERE activo = false)::int FROM public.nodos_articulos_catalogo) AS catalogo_inactivos,
                (SELECT COUNT(*)::int FROM public.nodos_propuestas_fracciones WHERE estado = 'PENDIENTE_COTIZACION') AS pendientes_fracciones,
                (SELECT COUNT(*)::int FROM public.nodos_propuestas_combos WHERE estado = 'PENDIENTE_COTIZACION') AS pendientes_combos
        `),
        q.query(`
            SELECT id, nombre, descripcion, activa, COALESCE(canal_comercial, 'MAYORISTA') AS canal_comercial,
                   salvavidas_habilitado, salvavidas_tasa_tem, salvavidas_dias_gracia,
                   salvavidas_dias_estandar, salvavidas_dias_cortesia
            FROM public.bunker_listas_precios
            WHERE UPPER(COALESCE(canal_comercial, '')) = 'NODOS'
            ORDER BY id ASC
        `),
        q.query(`
            SELECT pd.id, pd.nombre, pd.descripcion, pl.bunker_lista_precio_id, pd.activo,
                   pd.tipo_calculo, pd.aplica_sobre, pd.exige_saldo_cero, pd.tolerancia_saldo
            FROM public.bunker_politicas_descuento pd
            JOIN public.bunker_politica_listas pl ON pl.politica_id = pd.id
            JOIN public.bunker_listas_precios lp ON lp.id = pl.bunker_lista_precio_id
            WHERE UPPER(COALESCE(lp.canal_comercial, '')) = 'NODOS' AND pd.activo = true
            ORDER BY pd.id ASC
        `),
        q.query(`
            SELECT id, cuenta_bancaria_id, banco_recaudador, alias_recaudador, cbu_recaudador, titular_recaudador, updated_at
            FROM public.nodos_configuracion_canal
            WHERE id = 1
            LIMIT 1
        `)
    ]);

    const c = contRes.rows[0] || {};
    const pendFracc = Number(c.pendientes_fracciones || 0);
    const pendCombos = Number(c.pendientes_combos || 0);

    return {
        ok: true,
        modo_laboratorio: esModoLab(),
        nodos: nodosRes.rows.map(r => ({
            ...r,
            id: Number(r.id),
            perfil_operativo: normalizarPerfilCanonico(r.perfil_operativo) || 'VECINOS',
            latitud: r.latitud != null ? Number(r.latitud) : null,
            longitud: r.longitud != null ? Number(r.longitud) : null,
            margen_gestor_default_pct: Number(r.margen_gestor_default_pct ?? 28),
            alicuota_iva_margen_pct: Number(r.alicuota_iva_margen_pct ?? 21),
            alicuota_iibb_margen_pct: Number(r.alicuota_iibb_margen_pct ?? 4),
            cargo_envio_barrial: Number(r.cargo_envio_barrial || 0),
            saldo_cuenta_corriente: Number(r.saldo_cuenta_corriente || 0),
            saldo_cuenta_corriente_madre: Number(r.saldo_cuenta_corriente_madre || 0)
        })),
        listas_precios_nodos: listasRes.rows,
        politicas_descuento_bunker: polRes.rows,
        config_cuenta_canal: cfgCanalRes.rows[0] || null,
        contadores: {
            nodos_activos: Number(c.nodos_activos || 0),
            nodos_archivados: Number(c.nodos_archivados || 0),
            catalogo_total: Number(c.catalogo_total || 0),
            catalogo_activos: Number(c.catalogo_activos || 0),
            catalogo_inactivos: Number(c.catalogo_inactivos || 0),
            pendientes_fracciones: pendFracc,
            pendientes_combos: pendCombos,
            pendientes_total: pendFracc + pendCombos
        },
        constantes: {
            alicuota_iva_default: 21,
            alicuota_iibb_default: 4,
            margen_lamda_default: 25,
            margen_gestor_default: 28
        }
    };
}

/**
 * Catálogo + Matriz de Gobernanza paginada y filtrada server-side.
 * Política Universal de Búsqueda LAMDA (AND sobre tokens separados por espacio).
 * Garantiza 0 bytes base64/ZPL y tamaño mínimo por página.
 */
async function obtenerCatalogoNodosEscalable(filtros = {}, runner = null) {
    const q = runner || db;

    const page = Math.max(1, Number(filtros.page || 1) || 1);
    const limit = Math.min(250, Math.max(1, Number(filtros.limit || 50) || 50));
    const offset = (page - 1) * limit;

    const estadoRaw = String(
        filtros.estado !== undefined
            ? filtros.estado
            : (Number(filtros.articulo_catalogo_id || 0) > 0 ? 'todos' : 'activos')
    ).trim().toLowerCase();
    const flujoNum = Number(filtros.flujo || 0) || 0;
    const catIdFiltro = Number(filtros.articulo_catalogo_id || 0) || 0;
    const nodoFiltroId = Number(filtros.nodo_id || 0) || 0;
    const incluirOfertas = String(filtros.incluir_ofertas || '').toLowerCase() === 'true';
    const debeTraerOfertasDetalle = nodoFiltroId > 0 || catIdFiltro > 0 || incluirOfertas;
    const perfilFiltro = normalizarPerfilCanonico(filtros.perfil || '');
    const soloHabilitadosFiltro = String(filtros.solo_habilitados || '').toLowerCase() === 'true';
    const incluirNodosArchivados = String(filtros.incluir_archivados || '').toLowerCase() === 'true';
    const tokensBusqueda = String(filtros.q || '')
        .trim()
        .toLowerCase()
        .split(/\s+/)
        .filter(Boolean)
        .slice(0, 8);

    const whereClauses = [];
    const params = [];

    if (catIdFiltro > 0) {
        params.push(catIdFiltro);
        whereClauses.push(`nac.id = $${params.length}`);
    }

    if (estadoRaw === 'activos' || estadoRaw === 'true' || estadoRaw === '1') {
        whereClauses.push('nac.activo = true');
    } else if (estadoRaw === 'inactivos' || estadoRaw === 'false' || estadoRaw === '0') {
        whereClauses.push('nac.activo = false');
    }

    if (flujoNum > 0) {
        params.push(flujoNum);
        whereClauses.push(`nac.flujo_lamda = $${params.length}`);
    }

    if (soloHabilitadosFiltro && nodoFiltroId > 0) {
        params.push(nodoFiltroId);
        whereClauses.push(`EXISTS (
            SELECT 1 FROM public.nodos_ofertas_gestor nog_f
            WHERE nog_f.articulo_catalogo_id = nac.id
              AND nog_f.nodo_id = $${params.length}
              AND COALESCE(nog_f.habilitado_lamda, true) = true
        )`);
    }

    for (const tok of tokensBusqueda) {
        params.push(`%${tok}%`);
        const pIdx = `$${params.length}`;
        whereClauses.push(`(
            COALESCE(nac.sku_nodo, '') || ' ' ||
            COALESCE(ba.descripcion_generada, '') || ' ' ||
            COALESCE(nac.nomenclatura_bunker, '') || ' ' ||
            COALESCE(nac.nombre_publico, '') || ' ' ||
            COALESCE(bf.nombre, '') || ' ' ||
            COALESCE(ba.rubro, '') || ' ' ||
            COALESCE(ba.sub_rubro, '') || ' ' ||
            COALESCE(ba.propiedades_dinamicas::text, '') || ' ' ||
            COALESCE(ing.codigo::text, '') || ' ' ||
            COALESCE(ing.nombre, '')
        ) ILIKE ${pIdx}`);
    }

    const whereSql = whereClauses.length > 0 ? `WHERE ${whereClauses.join(' AND ')}` : '';
    params.push(limit, offset);
    const limitIdx = `$${params.length - 1}`;
    const offsetIdx = `$${params.length}`;

    const catSql = `
        SELECT
            COUNT(*) OVER()::int AS total_registros,
            nac.id,
            nac.sku_nodo,
            nac.nombre_publico,
            nac.nomenclatura_bunker,
            nac.familia_bunker_id,
            nac.familia_bunker_nombre,
            nac.articulo_principal_bunker,
            nac.presentacion_etiqueta,
            nac.categoria_familiar,
            nac.flujo_lamda,
            nac.ingrediente_origen_id,
            nac.insumo_envase_id,
            nac.tarifa_colaborador_id,
            nac.kilos_unidad,
            nac.segundos_fraccionamiento,
            nac.valor_hora_aplicado,
            nac.costo_insumo_kg,
            nac.costo_insumo_fraccion,
            nac.costo_insumo_fraccion AS costo_materia_prima_unidad,
            nac.iva_pct,
            nac.costo_envase_aplicado,
            nac.costo_mano_obra_aplicado,
            nac.costo_puro_total,
            nac.margen_lamda_pct,
            nac.precio_base_nodo_neto,
            nac.precio_base_nodo_final,
            nac.margen_sugerido_gestor_pct,
            nac.precio_sugerido_vecino,
            nac.compartido_mayorista,
            nac.activo,
            nac.es_combo,
            nac.firma_combo,
            nac.modo_precio_combo,
            nac.ajuste_comercial_combo_pct,
            nac.cargo_pack_combo,
            nac.precio_manual_override,
            nac.articulo_bunker_origen_codigo,
            COALESCE(ba.descripcion_generada, nac.nomenclatura_bunker, nac.nombre_publico) AS nombre_oficial_lamda,
            COALESCE(ba.descripcion_generada, nac.nomenclatura_bunker, nac.nombre_publico) AS bunker_descripcion_generada,
            COALESCE(bf.nombre, nac.familia_bunker_nombre, 'Frutos Secos') AS bunker_familia_nombre,
            ba.familia_id AS bunker_familia_id,
            ba.propiedades_dinamicas AS bunker_propiedades_dinamicas,
            ba.descripcion AS bunker_descripcion,
            ba.es_pack AS bunker_es_pack,
            ba.pack_unidades AS bunker_pack_unidades,
            ba.rubro AS bunker_rubro,
            ba.sub_rubro AS bunker_sub_rubro,
            ing.codigo AS ingrediente_origen_codigo,
            ing.nombre AS ingrediente_origen_nombre,
            ing.articulo_vinculado_numero AS ingrediente_origen_puente,
            COALESCE(ing.costo_patron, nac.costo_insumo_kg)::numeric(14,2) AS costo_insumo_kg_vivo,
            env.codigo AS envase_codigo,
            env.nombre AS envase_nombre,
            COALESCE(env.costo_patron, nac.costo_envase_aplicado)::numeric(14,2) AS costo_envase_vivo,
            COALESCE(src.stock_consolidado, 0)::numeric(12,2) AS stock_fisico_bunker
        FROM public.nodos_articulos_catalogo nac
        LEFT JOIN public.bunker_articulos ba ON UPPER(ba.articulo_id) = UPPER(nac.sku_nodo)
        LEFT JOIN public.bunker_familias bf ON bf.id = COALESCE(ba.familia_id, nac.familia_bunker_id)
        LEFT JOIN public.ingredientes ing ON ing.id = nac.ingrediente_origen_id
        LEFT JOIN public.ingredientes env ON env.id = nac.insumo_envase_id
        LEFT JOIN public.stock_real_consolidado src ON src.articulo_numero = nac.sku_nodo
        ${whereSql}
        ORDER BY nac.activo DESC, nac.flujo_lamda ASC, COALESCE(ba.descripcion_generada, nac.nomenclatura_bunker, nac.nombre_publico) ASC, nac.id ASC
        LIMIT ${limitIdx} OFFSET ${offsetIdx}
    `;

    const catRes = await q.query(catSql, params);
    const totalRegistros = catRes.rows.length > 0 ? Number(catRes.rows[0].total_registros || 0) : 0;
    const catIds = catRes.rows.map(r => Number(r.id));

    if (catIds.length === 0) {
        return {
            ok: true,
            page,
            limit,
            total: totalRegistros,
            total_pages: Math.max(1, Math.ceil(totalRegistros / limit)),
            catalogo: [],
            ofertas_gestor: []
        };
    }

    const comboSkusPagina = catRes.rows
        .filter(r => Boolean(r.es_combo))
        .map(r => String(r.sku_nodo || '').trim().toUpperCase())
        .filter(Boolean);

    const ofWhere = ['nog.articulo_catalogo_id = ANY($1::int[])'];
    const ofParams = [catIds];
    if (!incluirNodosArchivados) {
        ofWhere.push('COALESCE(nm.activo, true) = true');
    }
    if (nodoFiltroId > 0) {
        ofParams.push(nodoFiltroId);
        ofWhere.push(`nog.nodo_id = $${ofParams.length}`);
    }
    if (perfilFiltro) {
        ofParams.push(perfilFiltro);
        ofWhere.push(`UPPER(COALESCE(nm.perfil_operativo, 'VECINOS')) = $${ofParams.length}`);
    }

    const [coberturaRes, ofertasRes, mapaCombos, mapaJerarquia, mapaImagenesBase] = await Promise.all([
        q.query(`
            SELECT
                nog.articulo_catalogo_id,
                COUNT(*)::int AS nodos_totales,
                COUNT(*) FILTER (WHERE COALESCE(nog.habilitado_lamda, true) = true)::int AS nodos_habilitados,
                COUNT(*) FILTER (WHERE COALESCE(nog.habilitado_lamda, true) = true AND COALESCE(nog.publicado_tienda, false) = true)::int AS nodos_publicados
            FROM public.nodos_ofertas_gestor nog
            JOIN public.nodos_maestro nm ON nm.id = nog.nodo_id
            WHERE ${ofWhere.join(' AND ')}
            GROUP BY nog.articulo_catalogo_id
        `, ofParams),
        debeTraerOfertasDetalle
            ? q.query(`
                SELECT
                    nog.id,
                    nog.nodo_id,
                    nog.articulo_catalogo_id,
                    COALESCE(nog.habilitado_lamda, true) AS habilitado_lamda,
                    COALESCE(nog.publicado_tienda, false) AS publicado_tienda,
                    COALESCE(nog.destacado_tienda, false) AS destacado_tienda,
                    nog.margen_gestor_pct,
                    nog.precio_venta_vecino,
                    nog.precio_venta_vecino_anterior,
                    nog.ganancia_unitaria_gestor,
                    nog.precio_base_nodo_snapshot,
                    COALESCE(nog.alerta_cambio_costo, false) AS alerta_cambio_costo,
                    nog.nombre_vidriera_personalizado,
                    nog.categoria_vidriera_personalizada,
                    nm.nombre_marca,
                    nm.codigo_nodo,
                    nm.slug AS nodo_slug,
                    nm.color_primario,
                    COALESCE(nm.perfil_operativo, 'VECINOS') AS perfil_operativo,
                    COALESCE(nm.alicuota_iva_margen_pct, 21.00)::numeric(5,2) AS alicuota_iva_margen_pct,
                    COALESCE(nm.alicuota_iibb_margen_pct, 4.00)::numeric(5,2) AS alicuota_iibb_margen_pct
                FROM public.nodos_ofertas_gestor nog
                JOIN public.nodos_maestro nm ON nm.id = nog.nodo_id
                WHERE ${ofWhere.join(' AND ')}
                ORDER BY nm.id ASC, nog.id ASC
            `, ofParams)
            : Promise.resolve({ rows: [] }),
        comboSkusPagina.length > 0
            ? combosCompuestosService.obtenerMapaCombosYStockArmable(q, comboSkusPagina).catch(() => new Map())
            : Promise.resolve(new Map()),
        jerarquiaBunkerHelper.cargarMapaJerarquiaB2B(q).catch(() => new Map()),
        lamdaImagenesBaseService.obtenerMapaImagenesBaseActivas(q).catch(() => new Map())
    ]);

    const coberturaPorCat = new Map();
    for (const cr of coberturaRes.rows) {
        coberturaPorCat.set(Number(cr.articulo_catalogo_id), {
            nodos_totales: Number(cr.nodos_totales || 0),
            nodos_habilitados: Number(cr.nodos_habilitados || 0),
            nodos_publicados: Number(cr.nodos_publicados || 0)
        });
    }

    const ofertasPorCat = new Map();
    for (const ofRow of ofertasRes.rows) {
        const cid = Number(ofRow.articulo_catalogo_id);
        if (!ofertasPorCat.has(cid)) ofertasPorCat.set(cid, []);
        ofertasPorCat.get(cid).push({
            ...ofRow,
            id: Number(ofRow.id),
            nodo_id: Number(ofRow.nodo_id),
            articulo_catalogo_id: cid,
            margen_gestor_pct: Number(ofRow.margen_gestor_pct || 0),
            precio_venta_vecino: Number(ofRow.precio_venta_vecino || 0),
            ganancia_unitaria_gestor: Number(ofRow.ganancia_unitaria_gestor || 0),
            precio_base_nodo_snapshot: Number(ofRow.precio_base_nodo_snapshot || 0),
            alicuota_iva_margen_pct: Number(ofRow.alicuota_iva_margen_pct ?? 21),
            alicuota_iibb_margen_pct: Number(ofRow.alicuota_iibb_margen_pct ?? 4),
            perfil_operativo: normalizarPerfilCanonico(ofRow.perfil_operativo) || 'VECINOS'
        });
    }

    const catalogoEnriquecido = catRes.rows.map(c => {
        const { total_registros, ...rest } = c;
        const keyC = combosCompuestosService.normalizarSku(c.sku_nodo);
        const infoC = mapaCombos.get(keyC) || null;
        const esComboCat = Boolean(c.es_combo || infoC);
        const jer = jerarquiaBunkerHelper.resolverJerarquiaArticuloBunker(c, mapaJerarquia);
        const { nombre_base_oficial, presentacion_corta } = jerarquiaBunkerHelper.extraerNombreBaseYPresentacion(c);
        const claveProductoBase = jerarquiaBunkerHelper.construirClaveProductoBase(
            { ...c, articulo_catalogo_id: c.id, es_combo: esComboCat },
            jer
        );
        const imagenBaseLamda = lamdaImagenesBaseService.resolverImagenBaseLamdaParaArticulo(
            { ...c, jerarquia_b2b: jer, clave_producto_base: claveProductoBase },
            mapaImagenesBase
        );
        const cobCat = coberturaPorCat.get(Number(c.id)) || {
            nodos_totales: 0,
            nodos_habilitados: 0,
            nodos_publicados: 0
        };

        return {
            ...rest,
            id: Number(c.id),
            kilos_unidad: Number(c.kilos_unidad || 0),
            costo_puro_total: Number(c.costo_puro_total || 0),
            margen_lamda_pct: Number(c.margen_lamda_pct || 0),
            precio_base_nodo_neto: Number(c.precio_base_nodo_neto || 0),
            precio_base_nodo_final: Number(c.precio_base_nodo_final || 0),
            es_combo: esComboCat,
            stock_armable: esComboCat && infoC ? Number(infoC.stock_armable || 0) : null,
            componentes_combo: esComboCat && infoC ? infoC.componentes : [],
            jerarquia_b2b: jer,
            clave_producto_base: claveProductoBase,
            nombre_base_oficial,
            presentacion_corta,
            imagen_base_lamda: imagenBaseLamda,
            cobertura: cobCat
        };
    });

    const ofertasPlanas = [];
    for (const ofs of ofertasPorCat.values()) {
        for (const o of ofs) ofertasPlanas.push(o);
    }

    return {
        ok: true,
        page,
        limit,
        total: totalRegistros,
        total_pages: Math.max(1, Math.ceil(totalRegistros / limit)),
        catalogo: catalogoEnriquecido,
        ofertas_gestor: ofertasPlanas
    };
}

/**
 * Alterna Nivel 1 Global (`activo`) u opcionalmente margen LAMDA de un artículo del catálogo
 * sin borrar ni alterar las configuraciones guardadas por nodo en `nodos_ofertas_gestor`.
 */
async function cambiarEstadoActivoCatalogoNodo(catalogoId, payload = {}, runner = null) {
    const q = runner || db;
    const cid = Number(catalogoId || 0);
    if (!cid) {
        const err = new Error('Identificador de artículo de catálogo inválido.');
        err.statusCode = 400;
        throw err;
    }
    const curRes = await q.query('SELECT * FROM public.nodos_articulos_catalogo WHERE id = $1 LIMIT 1', [cid]);
    if (curRes.rowCount === 0) {
        const err = new Error('Artículo de catálogo no encontrado.');
        err.statusCode = 404;
        throw err;
    }
    const cur = curRes.rows[0];
    const nuevoActivo = payload.activo !== undefined ? Boolean(payload.activo) : !Boolean(cur.activo);

    let nuevoMargenLamda = Number(cur.margen_lamda_pct ?? 25);
    let nuevoPrecioFinal = Number(cur.precio_base_nodo_final || 0);
    let nuevoPrecioNeto = Number(cur.precio_base_nodo_neto || 0);

    if (payload.margen_lamda_pct !== undefined && payload.margen_lamda_pct !== null && payload.margen_lamda_pct !== '') {
        nuevoMargenLamda = Math.max(-50, Math.min(500, Number(payload.margen_lamda_pct)));
        const costoMatEnv = Number(cur.costo_insumo_fraccion ?? cur.costo_materia_prima_unidad ?? 0) + Number(cur.costo_envase_aplicado || 0);
        const costoMo = Number(cur.costo_mano_obra_aplicado || 0);
        const costoPuro = Number(cur.costo_puro_total || (costoMatEnv + costoMo));
        if (costoPuro > 0) {
            const ivaPctArt = Number(cur.iva_pct ?? 21);
            const neto = (costoMatEnv * (1 + nuevoMargenLamda / 100)) + costoMo;
            const precioFinalCalc = Math.round(neto * (1 + ivaPctArt / 100));
            nuevoPrecioNeto = Number(neto.toFixed(2));
            nuevoPrecioFinal = Math.max(Math.round(costoPuro), precioFinalCalc);
        }
    }

    const upd = await q.query(
        `UPDATE public.nodos_articulos_catalogo
         SET activo = $1,
             margen_lamda_pct = $2,
             precio_base_nodo_neto = $3,
             precio_base_nodo_final = $4,
             updated_at = NOW()
         WHERE id = $5
         RETURNING *`,
        [nuevoActivo, nuevoMargenLamda, nuevoPrecioNeto, nuevoPrecioFinal, cid]
    );

    if (Math.abs(nuevoPrecioFinal - Number(cur.precio_base_nodo_final || 0)) >= 1) {
        const { calcularPrecioYGananciaNetaOfertaNodo, normalizarAlicuotaFiscalNodo } = obtenerHelpersFiscalesNodos();
        const ofsRes = await q.query(
            `SELECT nog.id, nog.margen_gestor_pct,
                    COALESCE(nm.alicuota_iva_margen_pct, 21.00) AS iva_pct,
                    COALESCE(nm.alicuota_iibb_margen_pct, 4.00) AS iibb_pct
             FROM public.nodos_ofertas_gestor nog
             JOIN public.nodos_maestro nm ON nm.id = nog.nodo_id
             WHERE nog.articulo_catalogo_id = $1`,
            [cid]
        );
        for (const ofRow of ofsRes.rows) {
            const calc = calcularPrecioYGananciaNetaOfertaNodo({
                costoBaseLamda: nuevoPrecioFinal,
                margenPct: Number(ofRow.margen_gestor_pct ?? 28),
                ivaPct: normalizarAlicuotaFiscalNodo(ofRow.iva_pct, 21),
                iibbPct: normalizarAlicuotaFiscalNodo(ofRow.iibb_pct, 4),
                modo: 'margen'
            });
            await q.query(
                `UPDATE public.nodos_ofertas_gestor
                 SET precio_base_nodo_snapshot = $1,
                     precio_venta_vecino = $2,
                     ganancia_unitaria_gestor = $3,
                     alerta_cambio_costo = true,
                     updated_at = NOW()
                 WHERE id = $4`,
                [nuevoPrecioFinal, calc.precio_tienda, calc.ganancia_neta_nodo, ofRow.id]
            );
        }
    }

    return upd.rows[0];
}

/**
 * Actualización transaccional masiva sobre N nodos para un artículo del catálogo.
 */
async function actualizarOfertasNodosMasivo(catalogoId, payload = {}, runner = null) {
    const cid = Number(catalogoId || 0);
    if (!cid) {
        const err = new Error('Identificador de artículo de catálogo inválido.');
        err.statusCode = 400;
        throw err;
    }

    const ownsClient = !runner;
    const client = runner || (await db.connect());
    try {
        if (ownsClient) await client.query('BEGIN');

        const catRes = await client.query(
            'SELECT * FROM public.nodos_articulos_catalogo WHERE id = $1 LIMIT 1 FOR UPDATE',
            [cid]
        );
        if (catRes.rowCount === 0) {
            const err = new Error('Artículo de catálogo no encontrado.');
            err.statusCode = 404;
            throw err;
        }
        const cat = catRes.rows[0];
        const baseLamda = Number(cat.precio_base_nodo_final || 0);

        const filtrosWhere = ['COALESCE(nm.activo, true) = true'];
        const filtrosParams = [];
        const nodosIds = Array.isArray(payload.nodos_ids)
            ? payload.nodos_ids.map(Number).filter(n => Number.isFinite(n) && n > 0)
            : [];
        if (nodosIds.length > 0) {
            filtrosParams.push(nodosIds);
            filtrosWhere.push(`nm.id = ANY($${filtrosParams.length}::int[])`);
        } else if (payload.perfil_operativo) {
            const pf = normalizarPerfilCanonico(payload.perfil_operativo);
            if (pf) {
                filtrosParams.push(pf);
                filtrosWhere.push(`UPPER(COALESCE(nm.perfil_operativo, 'VECINOS')) = $${filtrosParams.length}`);
            }
        }

        const nodosTargetRes = await client.query(
            `SELECT nm.id,
                    COALESCE(nm.margen_gestor_default_pct, 28.00) AS margen_def,
                    COALESCE(nm.alicuota_iva_margen_pct, 21.00) AS iva_pct,
                    COALESCE(nm.alicuota_iibb_margen_pct, 4.00) AS iibb_pct
             FROM public.nodos_maestro nm
             WHERE ${filtrosWhere.join(' AND ')}
             ORDER BY nm.id ASC`,
            filtrosParams
        );

        const { calcularPrecioYGananciaNetaOfertaNodo, normalizarAlicuotaFiscalNodo } = obtenerHelpersFiscalesNodos();
        const ofertasActualizadas = [];
        for (const nodo of nodosTargetRes.rows) {
            const nid = Number(nodo.id);
            const exRes = await client.query(
                `SELECT * FROM public.nodos_ofertas_gestor
                 WHERE nodo_id = $1 AND articulo_catalogo_id = $2
                 LIMIT 1 FOR UPDATE`,
                [nid, cid]
            );
            const ex = exRes.rows[0] || null;
            const ivaPct = normalizarAlicuotaFiscalNodo(nodo.iva_pct, 21);
            const iibbPct = normalizarAlicuotaFiscalNodo(nodo.iibb_pct, 4);
            const habFinal = payload.habilitado_lamda !== undefined
                ? Boolean(payload.habilitado_lamda)
                : (ex ? (ex.habilitado_lamda !== false) : true);
            let pubFinal = payload.publicado_tienda !== undefined
                ? Boolean(payload.publicado_tienda)
                : (ex ? Boolean(ex.publicado_tienda) : false);
            if (!habFinal && payload.publicado_tienda === true) {
                pubFinal = false;
            }

            let calc;
            if (payload.precio_venta_vecino !== undefined && payload.precio_venta_vecino !== null && payload.precio_venta_vecino !== '') {
                calc = calcularPrecioYGananciaNetaOfertaNodo({
                    costoBaseLamda: baseLamda,
                    precioTienda: payload.precio_venta_vecino,
                    ivaPct,
                    iibbPct,
                    modo: 'precio'
                });
            } else if (payload.margen_gestor_pct !== undefined && payload.margen_gestor_pct !== null && payload.margen_gestor_pct !== '') {
                calc = calcularPrecioYGananciaNetaOfertaNodo({
                    costoBaseLamda: baseLamda,
                    margenPct: payload.margen_gestor_pct,
                    ivaPct,
                    iibbPct,
                    modo: 'margen'
                });
            } else {
                const margenRef = Number(ex?.margen_gestor_pct ?? nodo.margen_def ?? 28);
                calc = calcularPrecioYGananciaNetaOfertaNodo({
                    costoBaseLamda: baseLamda,
                    margenPct: margenRef,
                    ivaPct,
                    iibbPct,
                    modo: 'margen'
                });
            }

            if (ex) {
                const upd = await client.query(
                    `UPDATE public.nodos_ofertas_gestor
                     SET precio_base_nodo_snapshot = $1,
                         margen_gestor_pct = $2,
                         precio_venta_vecino = $3,
                         ganancia_unitaria_gestor = $4,
                         habilitado_lamda = $5,
                         publicado_tienda = $6,
                         updated_at = NOW()
                     WHERE id = $7
                     RETURNING *`,
                    [baseLamda, calc.margen_pct, calc.precio_tienda, calc.ganancia_neta_nodo, habFinal, pubFinal, ex.id]
                );
                ofertasActualizadas.push(upd.rows[0]);
            } else {
                const ins = await client.query(
                    `INSERT INTO public.nodos_ofertas_gestor (
                        nodo_id, articulo_catalogo_id, precio_base_nodo_snapshot,
                        margen_gestor_pct, precio_venta_vecino, ganancia_unitaria_gestor,
                        habilitado_lamda, publicado_tienda
                     ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
                     RETURNING *`,
                    [nid, cid, baseLamda, calc.margen_pct, calc.precio_tienda, calc.ganancia_neta_nodo, habFinal, pubFinal]
                );
                ofertasActualizadas.push(ins.rows[0]);
            }
        }

        if (ownsClient) await client.query('COMMIT');
        return {
            ok: true,
            catalogo_id: cid,
            actualizadas: ofertasActualizadas.length,
            ofertas: ofertasActualizadas
        };
    } catch (err) {
        if (ownsClient) {
            try { await client.query('ROLLBACK'); } catch (_) {}
        }
        throw err;
    } finally {
        if (ownsClient) client.release();
    }
}

/**
 * Fuentes y presentaciones de Planta (SKU-First) + combos elegibles para Entrada A / Entrada B.
 * Sin clientes Búnker completos ni blobs base64/ZPL de Nodos.
 */
async function obtenerPresentacionesPlantaNodosEscalable(runner = null) {
    const q = runner || db;
    const nodosBarrialesService = require('./nodosBarrialesService');
    const [plantaInfo, ingRes, ctxClasif, mixPadresRes, artDirectosRes, envasesRes, tarifasRes, familiasRes, taxonomiaBunkerMap, catalogoSkusRes] = await Promise.all([
        nodosBarrialesService.obtenerPresentacionesPlantaLamda(q),
        q.query(`
            SELECT i.id, i.codigo, i.nombre, COALESCE(i.costo_patron, 0)::numeric(14,2) AS costo_patron,
                   i.articulo_vinculado_numero, COALESCE(i.es_insumo, false) AS es_insumo,
                   COALESCE(i.rol_ingrediente, 'MATERIA_PRIMA') AS rol_ingrediente,
                   COALESCE(i.habilitado_solicitud_nodos, true) AS habilitado_solicitud_nodos,
                   COALESCE(i.activo, true) AS activo
            FROM public.ingredientes i
            WHERE COALESCE(i.es_insumo, false) = false
              AND COALESCE(i.activo, true) = true
              AND COALESCE(i.rol_ingrediente, 'MATERIA_PRIMA') IN ('MATERIA_PRIMA', 'PUENTE_ELABORADO')
              AND COALESCE(i.habilitado_solicitud_nodos, true) = true
            ORDER BY i.nombre ASC
        `),
        nodosBarrialesService.cargarContextoClasificacionIngredientes(q),
        q.query(`
            SELECT DISTINCT ON (ing_s.id)
                   ing_s.id AS simple_id,
                   r.id AS receta_puente_id,
                   r.articulo_numero AS receta_puente_codigo,
                   ing_p.id AS padre_id,
                   ing_p.codigo AS padre_codigo,
                   ing_p.nombre AS padre_nombre,
                   COALESCE(ing_p.costo_patron, 0)::numeric(14,2) AS padre_costo_patron
            FROM public.ingredientes ing_s
            JOIN public.recetas r ON UPPER(r.articulo_numero) = UPPER(ing_s.articulo_vinculado_numero)
            JOIN public.receta_ingredientes ri ON ri.receta_id = r.id
            JOIN public.ingredientes ing_p ON ing_p.id = ri.ingrediente_id
            WHERE ing_s.articulo_vinculado_numero IS NOT NULL
              AND TRIM(ing_s.articulo_vinculado_numero) <> ''
              AND ing_p.id <> ing_s.id
              AND COALESCE(ing_p.es_insumo, false) = false
            ORDER BY ing_s.id, COALESCE(ri.cantidad, 0) DESC, ing_p.id ASC
        `),
        q.query(`
            SELECT articulo_id, descripcion_generada, descripcion, rubro, sub_rubro,
                   COALESCE(costo_base, 0)::numeric(14,2) AS costo_base,
                   COALESCE(kilos_unidad, 1)::numeric(10,4) AS kilos_unidad
            FROM public.bunker_articulos
            WHERE COALESCE(costo_base, 0) > 0
              AND COALESCE(es_pack, false) = false
            ORDER BY descripcion_generada ASC NULLS LAST
            LIMIT 150
        `),
        q.query(`
            SELECT id, codigo, nombre, COALESCE(costo_patron, 0)::numeric(14,2) AS costo_unitario
            FROM public.ingredientes
            WHERE COALESCE(es_insumo, false) = true
            ORDER BY costo_patron ASC, nombre ASC
        `),
        q.query(`
            SELECT ct.id, ct.usuario_id,
                   COALESCE(u.nombre_completo, u.usuario, 'Operador Taller') AS nombre_completo,
                   COALESCE(ct.valor_hora, 7000)::numeric(12,2) AS valor_hora, ct.activo
            FROM public.colaboradores_tarifas ct
            LEFT JOIN public.usuarios u ON u.id = ct.usuario_id
            WHERE COALESCE(ct.activo, true) = true
            ORDER BY ct.id ASC
        `),
        q.query('SELECT id, nombre, descripcion, abreviatura FROM public.bunker_familias WHERE activo = true ORDER BY id ASC'),
        nodosBarrialesService.resolverTaxonomiaOficialIngredienteBunker(q),
        q.query(`
            SELECT nac.id, nac.sku_nodo,
                   COALESCE(ba.descripcion_generada, nac.nomenclatura_bunker, nac.nombre_publico) AS nombre_oficial_lamda,
                   nac.kilos_unidad, nac.precio_base_nodo_final, nac.costo_puro_total,
                   COALESCE(nac.es_combo, ba.es_combo, false) AS es_combo
            FROM public.nodos_articulos_catalogo nac
            LEFT JOIN public.bunker_articulos ba ON UPPER(ba.articulo_id) = UPPER(nac.sku_nodo)
            WHERE nac.activo = true
              AND COALESCE(nac.es_combo, false) = false
              AND COALESCE(ba.es_combo, false) = false
            ORDER BY COALESCE(ba.descripcion_generada, nac.nomenclatura_bunker, nac.nombre_publico) ASC
        `)
    ]);

    const { idsCompuestosSet, ctxRelaciones } = ctxClasif;
    const mapaMixPadres = new Map(
        mixPadresRes.rows.map(r => {
            const codP = r.padre_codigo && String(r.padre_codigo).trim() !== '' ? String(r.padre_codigo).trim() : `#${r.padre_id}`;
            return [Number(r.simple_id), {
                id: Number(r.padre_id),
                codigo: r.padre_codigo,
                nombre: r.padre_nombre,
                costo_patron: Number(r.padre_costo_patron || 0),
                receta_puente_id: Number(r.receta_puente_id),
                receta_puente_codigo: r.receta_puente_codigo,
                label_oficial: `#${r.padre_id} [${codP}] ${r.padre_nombre}`
            }];
        })
    );

    const ingredientesPorFlujo = ingRes.rows
        .filter(ing => !idsCompuestosSet.has(Number(ing.id)))
        .map(ing => {
            const idNum = Number(ing.id);
            const tax = taxonomiaBunkerMap.get(idNum) || null;
            const ident = nodosBarrialesService.resolverIdentidadTecnicaIngrediente(
                ing,
                tax ? tax.familia_bunker_nombre : null,
                null,
                idsCompuestosSet,
                ctxRelaciones
            );
            return {
                id: idNum,
                codigo: ing.codigo,
                nombre: ing.nombre,
                label_oficial: ident.label_oficial,
                familia_bunker_id: tax ? tax.familia_bunker_id : null,
                familia_bunker_nombre: tax ? tax.familia_bunker_nombre : null,
                articulo_principal_bunker: tax ? tax.articulo_principal_bunker : null,
                bunker_rubro: tax ? tax.bunker_rubro : null,
                bunker_sub_rubro: tax ? tax.bunker_sub_rubro : null,
                categoria_lamda: ident.categoria_lamda,
                es_pack_barritas: ident.es_pack_barritas,
                costo_kg: Number(ing.costo_patron),
                articulo_vinculado_numero: ing.articulo_vinculado_numero || null,
                mix_padre: mapaMixPadres.get(idNum) || null,
                flujo: ident.flujo,
                flujo_nombre: ident.flujo_nombre,
                origen_tipo: ident.origen_tipo,
                hermano_sku_base: tax ? tax.bunker_sku_referencia : null,
                hermano_descripcion_generada: tax ? tax.bunker_descripcion_generada : null,
                hermano_familia_id: tax ? tax.familia_bunker_id : null
            };
        });

    const articulosFlujo1 = artDirectosRes.rows.map(art => {
        const kilos = Math.max(0.001, Number(art.kilos_unidad) || 1);
        const costoBase = Number(art.costo_base) || 0;
        const descOf = art.descripcion_generada || art.descripcion || art.articulo_id;
        return {
            articulo_id: art.articulo_id,
            nombre: descOf,
            label_oficial: `[${art.articulo_id}] ${descOf}`,
            rubro: art.rubro,
            kilos_bulto: kilos,
            costo_bulto: costoBase,
            costo_kg: Number((costoBase / kilos).toFixed(2)),
            flujo: 1,
            flujo_nombre: '[LDN 1] Directo (Sin Receta)',
            origen_tipo: 'ARTICULO_BUNKER'
        };
    });

    return {
        ok: true,
        presentaciones_planta_disponibles: plantaInfo ? plantaInfo.disponiblesParaAdmin : [],
        ingredientes_por_flujo: ingredientesPorFlujo,
        articulos_flujo_1: articulosFlujo1,
        envases: envasesRes.rows.map(e => {
            const codEnv = e.codigo && String(e.codigo).trim() !== '' ? String(e.codigo).trim() : `#${e.id}`;
            return {
                id: Number(e.id),
                codigo: e.codigo,
                nombre: e.nombre,
                label_oficial: `#${e.id} [${codEnv}] ${e.nombre}`,
                costo_unitario: Number(e.costo_unitario)
            };
        }),
        tarifas_mano_obra: tarifasRes.rows.map(t => ({
            id: Number(t.id),
            nombre_completo: t.nombre_completo,
            valor_hora: Number(t.valor_hora)
        })),
        familias_bunker: familiasRes.rows,
        componentes_combo_disponibles: catalogoSkusRes.rows.map(r => ({
            ...r,
            id: Number(r.id),
            kilos_unidad: Number(r.kilos_unidad || 0),
            costo_puro_total: Number(r.costo_puro_total || 0),
            precio_base_nodo_final: Number(r.precio_base_nodo_final || 0),
            label_oficial: `[${r.sku_nodo}] ${r.nombre_oficial_lamda}`
        })),
        constantes: {
            alicuota_iva_default: 21,
            alicuota_iibb_default: 4,
            margen_lamda_default: 25,
            margen_gestor_default: 28
        }
    };
}

/**
 * Bandeja unificada de Solicitudes (Fracciones + Combos) filtrable por nodo, estado o tipo.
 */
async function obtenerSolicitudesNodosEscalable(filtros = {}, runner = null) {
    const q = runner || db;
    let estadoFiltro = String(filtros.estado || 'TODAS').trim().toUpperCase();
    if (estadoFiltro === 'PENDIENTE') estadoFiltro = 'PENDIENTE_COTIZACION';
    const nodoIdFiltro = Number(filtros.nodo_id || 0) || 0;

    const whereFracc = [`COALESCE(npf.estado, '') <> 'ANULADA'`];
    const paramsFracc = [];
    if (estadoFiltro && estadoFiltro !== 'TODAS' && estadoFiltro !== 'TODOS') {
        paramsFracc.push(estadoFiltro);
        whereFracc.push(`UPPER(npf.estado) = $${paramsFracc.length}`);
    } else if (estadoFiltro === 'TODAS') {
        whereFracc.push(`COALESCE(npf.estado, '') <> 'DESCARTADA'`);
    }
    if (nodoIdFiltro > 0) {
        paramsFracc.push(nodoIdFiltro);
        whereFracc.push(`npf.nodo_solicitante_id = $${paramsFracc.length}`);
    }

    const whereCombo = [`COALESCE(npc.estado, '') <> 'ANULADA'`];
    const paramsCombo = [];
    if (estadoFiltro && estadoFiltro !== 'TODAS' && estadoFiltro !== 'TODOS') {
        paramsCombo.push(estadoFiltro);
        whereCombo.push(`UPPER(npc.estado) = $${paramsCombo.length}`);
    } else if (estadoFiltro === 'TODAS') {
        whereCombo.push(`COALESCE(npc.estado, '') <> 'DESCARTADA'`);
    }
    if (nodoIdFiltro > 0) {
        paramsCombo.push(nodoIdFiltro);
        whereCombo.push(`npc.nodo_solicitante_id = $${paramsCombo.length}`);
    }

    const [fraccRes, comboRes, comboItemsRes, cntRes] = await Promise.all([
        q.query(`
            SELECT npf.*,
                   bf.nombre AS familia_bunker_nombre,
                   nm.nombre_marca AS nodo_solicitante_nombre,
                   nm.gestor_nombre AS nodo_gestor_nombre,
                   nm.color_primario AS nodo_color,
                   ing.codigo AS ingrediente_sugerido_codigo,
                   ing.nombre AS ingrediente_sugerido_nombre,
                   ing.articulo_vinculado_numero AS ingrediente_sugerido_puente,
                   COALESCE(ing.costo_patron, 0)::numeric(14,2) AS ingrediente_sugerido_costo_kg,
                   env.codigo AS envase_sugerido_codigo,
                   env.nombre AS envase_sugerido_nombre,
                   COALESCE(env.costo_patron, 0)::numeric(14,2) AS envase_sugerido_costo
            FROM public.nodos_propuestas_fracciones npf
            LEFT JOIN public.bunker_familias bf ON bf.id = npf.familia_bunker_id
            LEFT JOIN public.nodos_maestro nm ON nm.id = npf.nodo_solicitante_id
            LEFT JOIN public.ingredientes ing ON ing.id = npf.ingrediente_sugerido_id
            LEFT JOIN public.ingredientes env ON env.id = npf.insumo_envase_sugerido_id
            WHERE ${whereFracc.join(' AND ')}
            ORDER BY CASE WHEN npf.estado = 'PENDIENTE_COTIZACION' THEN 0 ELSE 1 END, npf.id DESC
            LIMIT 250
        `, paramsFracc),
        q.query(`
            SELECT npc.*,
                   nm.nombre_marca AS nodo_solicitante_nombre,
                   nm.gestor_nombre AS nodo_gestor_nombre,
                   nm.color_primario AS nodo_color
            FROM public.nodos_propuestas_combos npc
            LEFT JOIN public.nodos_maestro nm ON nm.id = npc.nodo_solicitante_id
            WHERE ${whereCombo.join(' AND ')}
            ORDER BY CASE WHEN npc.estado = 'PENDIENTE_COTIZACION' THEN 0 ELSE 1 END, npc.id DESC
            LIMIT 250
        `, paramsCombo),
        q.query(`
            SELECT npci.*,
                   COALESCE(ba.descripcion_generada, ba.descripcion, npci.componente_articulo_id) AS nombre_oficial_lamda,
                   GREATEST(0.001, COALESCE(ba.kilos_unidad, 0.25))::numeric(12,4) AS kilos_unidad
            FROM public.nodos_propuestas_combos_items npci
            JOIN public.nodos_propuestas_combos npc ON npc.id = npci.propuesta_combo_id
            LEFT JOIN public.bunker_articulos ba ON UPPER(ba.articulo_id) = UPPER(npci.componente_articulo_id)
            WHERE COALESCE(npc.estado, '') NOT IN ('ANULADA', 'DESCARTADA')
            ORDER BY npci.propuesta_combo_id ASC, npci.orden ASC, npci.id ASC
        `),
        q.query(`
            SELECT
                (SELECT COUNT(*)::int FROM public.nodos_propuestas_fracciones WHERE estado = 'PENDIENTE_COTIZACION') AS pendientes_fracciones,
                (SELECT COUNT(*)::int FROM public.nodos_propuestas_combos WHERE estado = 'PENDIENTE_COTIZACION') AS pendientes_combos
        `)
    ]);

    const itemsPorCombo = new Map();
    for (const it of comboItemsRes.rows) {
        const pid = Number(it.propuesta_combo_id);
        if (!itemsPorCombo.has(pid)) itemsPorCombo.set(pid, []);
        itemsPorCombo.get(pid).push({
            ...it,
            etiqueta_oficial_lamda: `[${it.componente_articulo_id}] ${it.nombre_oficial_lamda}`
        });
    }

    const propuestasCombos = comboRes.rows.map(c => {
        const items = itemsPorCombo.get(Number(c.id)) || [];
        const kilosTot = Number(items.reduce((acc, x) => acc + Number(x.kilos_unidad || 0) * Number(x.cantidad || 1), 0).toFixed(3));
        return {
            ...c,
            kilos_totales: kilosTot,
            items
        };
    });

    const nodosBarrialesService = require('./nodosBarrialesService');
    const propuestasFracciones = fraccRes.rows.map(r => {
        const codIng = r.ingrediente_sugerido_codigo !== null && r.ingrediente_sugerido_codigo !== undefined && String(r.ingrediente_sugerido_codigo).trim() !== ''
            ? String(r.ingrediente_sugerido_codigo).trim()
            : (r.ingrediente_sugerido_id ? `#${r.ingrediente_sugerido_id}` : '');
        const nomIng = String(r.ingrediente_sugerido_nombre || '').trim();
        return {
            ...r,
            ingrediente_label_oficial: r.ingrediente_sugerido_id && nomIng
                ? `[${codIng}] ${nomIng}`
                : null,
            peso_sugerido_label: nodosBarrialesService.formatearPesoCortoLdn(r.kilos_sugeridos)
        };
    });

    const cntRow = cntRes.rows[0] || {};
    const pendF = Number(cntRow.pendientes_fracciones || 0);
    const pendC = Number(cntRow.pendientes_combos || 0);

    return {
        ok: true,
        propuestas: propuestasFracciones,
        propuestas_combos: propuestasCombos,
        contadores: {
            pendientes_fracciones: pendF,
            pendientes_combos: pendC,
            pendientes_total: pendF + pendC
        }
    };
}

/**
 * Buscador server-side paginado/acotado sobre `bunker_clientes` para selector Cliente Madre (1:N).
 */
async function buscarClientesBunkerNodos(filtros = {}, runner = null) {
    const q = runner || db;
    const rawQuery = typeof filtros === 'string' ? filtros : (filtros.q || '');
    const idExacto = Number((typeof filtros === 'object' ? filtros.id : 0) || 0) || 0;
    const limit = Math.min(60, Math.max(5, Number((typeof filtros === 'object' ? filtros.limit : 30) || 30)));
    const tokens = String(rawQuery || '').trim().toLowerCase().split(/\s+/).filter(Boolean).slice(0, 6);

    const where = [`bc.codigo_bunker_cliente NOT LIKE 'CB-NODO-%'`];
    const params = [];

    if (idExacto > 0) {
        params.push(idExacto);
        where.push(`bc.id = $${params.length}`);
    } else {
        for (const tok of tokens) {
            params.push(`%${tok}%`);
            const pIdx = `$${params.length}`;
            where.push(`(
                COALESCE(bc.codigo_bunker_cliente, '') || ' ' ||
                COALESCE(bc.lomas_soft_id::text, '') || ' ' ||
                COALESCE(bc.cliente_nombre, '') || ' ' ||
                COALESCE(bc.razon_social, '') || ' ' ||
                COALESCE(bc.cuit_cuil, '') || ' ' ||
                COALESCE(bc.whatsapp_facturas, '') || ' ' ||
                COALESCE(bc.email_portal, '')
            ) ILIKE ${pIdx}`);
        }
    }

    params.push(limit);
    const limIdx = `$${params.length}`;

    const res = await q.query(`
        SELECT bc.id, bc.codigo_bunker_cliente, bc.cliente_nombre, bc.razon_social,
               bc.cuit_cuil, bc.domicilio_fiscal, bc.provincia, bc.whatsapp_facturas,
               bc.email_portal, bc.email_portal_nombre, bc.lomas_soft_id, bc.usuario_id,
               COALESCE(cc.saldo, 0)::numeric(14,2) AS saldo_cta_cte,
               cd.direccion AS domicilio_entrega_direccion,
               cd.localidad AS domicilio_entrega_localidad,
               cd.alias AS domicilio_entrega_alias,
               cd.telefono_contacto AS domicilio_entrega_telefono,
               cd.latitud AS domicilio_entrega_latitud,
               cd.longitud AS domicilio_entrega_longitud,
               COALESCE(doms.lista, '[]'::jsonb) AS domicilios_registrados
        FROM public.bunker_clientes bc
        LEFT JOIN public.factura_cuentas_corrientes cc
          ON cc.codigo_bunker_cliente = bc.codigo_bunker_cliente
         AND cc.nombre_cuenta = 'Cuenta Principal'
        LEFT JOIN LATERAL (
            SELECT direccion, localidad, alias, telefono_contacto, latitud, longitud
            FROM public.clientes_domicilios d
            WHERE d.id_cliente = bc.id
              AND COALESCE(d.activo, true) = true
            ORDER BY COALESCE(d.es_predeterminado, false) DESC, d.id ASC
            LIMIT 1
        ) cd ON true
        LEFT JOIN LATERAL (
            SELECT jsonb_agg(
                jsonb_build_object(
                    'id', d.id,
                    'alias', COALESCE(d.alias, 'Entrega'),
                    'direccion', d.direccion,
                    'localidad', d.localidad,
                    'provincia', d.provincia,
                    'latitud', d.latitud,
                    'longitud', d.longitud,
                    'es_predeterminado', COALESCE(d.es_predeterminado, false)
                ) ORDER BY COALESCE(d.es_predeterminado, false) DESC, d.id ASC
            ) AS lista
            FROM public.clientes_domicilios d
            WHERE d.id_cliente = bc.id
              AND COALESCE(d.activo, true) = true
        ) doms ON true
        WHERE ${where.join(' AND ')}
        ORDER BY bc.id ASC
        LIMIT ${limIdx}
    `, params);

    return {
        ok: true,
        clientes: res.rows.map(r => ({
            ...r,
            id: Number(r.id),
            saldo_cta_cte: Number(r.saldo_cta_cte || 0)
        }))
    };
}

/**
 * Carga bajo demanda los assets pesados (base64 + ZPL + tema_visual + ventanas + banco)
 * de un único Nodo para el editor ABM unificado de `/centro-nodos`.
 */
async function obtenerBrandingNodoPorId(nodoId, runner = null) {
    const q = runner || db;
    const nid = Number(nodoId || 0);
    if (!nid) {
        const err = new Error('Identificador de Nodo inválido.');
        err.statusCode = 400;
        throw err;
    }
    const res = await q.query(`
        SELECT id, codigo_nodo, slug, slug_historico, nombre_marca, bajada_marca, subtitulo_marca,
               color_primario, mostrar_ingredientes_tienda,
               latitud, longitud, barrio_zona, direccion_retiro,
               logo_original_base64, logo_mono_preview_base64, logo_zpl_gfa, logo_zpl_config,
               tema_visual, config_ventanas_corte,
               usa_cuenta_compartida, cuenta_bancaria_id,
               banco_display, alias_bancario_display, cbu_display, titular_display, cuil_display, numero_cuenta_display,
               lista_precio_bunker_id, cliente_madre_bunker_id, codigo_bunker_cliente_madre,
               bunker_cliente_id, codigo_bunker_cliente, cliente_operativo_id, usar_cuenta_madre_unificada
        FROM public.nodos_maestro
        WHERE id = $1
        LIMIT 1
    `, [nid]);

    if (res.rowCount === 0) {
        const err = new Error('Nodo no encontrado.');
        err.statusCode = 404;
        throw err;
    }
    const r = res.rows[0];
    return {
        ok: true,
        branding: {
            ...r,
            id: Number(r.id),
            latitud: r.latitud != null ? Number(r.latitud) : null,
            longitud: r.longitud != null ? Number(r.longitud) : null,
            mostrar_ingredientes_tienda: r.mostrar_ingredientes_tienda !== false,
            usa_cuenta_compartida: r.usa_cuenta_compartida !== false,
            tema_visual: r.tema_visual || {},
            logo_zpl_config: r.logo_zpl_config || {},
            config_ventanas_corte: Array.isArray(r.config_ventanas_corte) ? r.config_ventanas_corte : []
        }
    };
}

module.exports = {
    sanitizarTemaVisualSinBase64,
    obtenerResumenNodosEscalable,
    obtenerCatalogoNodosEscalable,
    cambiarEstadoActivoCatalogoNodo,
    actualizarOfertasNodosMasivo,
    obtenerPresentacionesPlantaNodosEscalable,
    obtenerSolicitudesNodosEscalable,
    buscarClientesBunkerNodos,
    obtenerBrandingNodoPorId
};
