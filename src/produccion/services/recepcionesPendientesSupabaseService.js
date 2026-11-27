const { supabaseFetch } = require('../utils/supabaseHelper');

const SUPABASE_BASE_URL = 'https://wofttcnpipozwupmpuul.supabase.co/rest/v1';
const CACHE_TTL_MS = 60 * 1000;

let cachePendientes = null;
let cacheTimestamp = 0;
let inFlightPromise = null;

const STOPWORDS = new Set([
    'de', 'del', 'la', 'las', 'los', 'el', 'en', 'por', 'con', 'sin',
    'kg', 'gr', 'grs', 'kilo', 'kilos', 'caja', 'bolsa', 'bulto',
    'x', 'u', 'un', 'unidad', 'unidades', 'precio', 'cosecha',
    'superior', 'argentina', 'nacional', 'chile', 'extra', 'importada', 'importado'
]);

const GRUPOS_DISCRIMINANTES = [
    ['rubia', 'flame', 'sultanina', 'jumbo', 'morocha', 'negra', 'moscatel'],
    ['mariposa', 'cuarto', 'mitad', 'mitades', 'cascara', 'entera', 'entero', 'partido', 'partida', 'fileteada', 'laminada', 'harina', 'polvo'],
    ['extralight', 'light', 'ambar', 'dorada'],
    ['tostada', 'tostado', 'salada', 'salado', 'cruda', 'crudo', 'confitada', 'banada'],
    ['almendra', 'nuez', 'pasa', 'ciruela', 'higo', 'datil', 'arandano', 'castana', 'pistacho', 'mani', 'avellana', 'pecan', 'semilla', 'coco']
];

const SINGULAR_MAP = {
    pasas: 'pasa',
    almendras: 'almendra',
    nueces: 'nuez',
    ciruelas: 'ciruela',
    higos: 'higo',
    datiles: 'datil',
    castanas: 'castana',
    arandanos: 'arandano',
    semillas: 'semilla',
    cuartos: 'cuarto',
    mariposas: 'mariposa',
    rubias: 'rubia',
    negras: 'negra',
    morochas: 'morocha',
    chicas: 'chica',
    medianas: 'mediana',
    grandes: 'grande',
    peladas: 'pelada',
    tostadas: 'tostada',
    saladas: 'salada',
    partidas: 'partida',
    partidos: 'partido',
    enteras: 'entera',
    enteros: 'entero',
    extraligth: 'extralight',
    ligth: 'light',
    nompareil: 'nonpareil'
};

/**
 * Normaliza un texto para comparación determinista (sin diacríticos ni mayúsculas).
 * @param {string} str
 * @returns {string}
 */
function normalizarTextoToken(str) {
    if (!str) return '';
    return String(str)
        .toLowerCase()
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/\bextra\s+lig(?:ht|th)\b/g, 'extralight')
        .replace(/\bextraligth\b/g, 'extralight')
        .replace(/\bligth\b/g, 'light')
        .replace(/\bnompareil\b/g, 'nonpareil')
        .replace(/[^a-z0-9/+]+/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
}

/**
 * Extrae tokens significativos manteniendo calibres/variedades y removiendo stopwords genéricas.
 * @param {string} str
 * @returns {string[]}
 */
function extraerTokensSignificativos(str) {
    const norm = normalizarTextoToken(str);
    if (!norm) return [];
    const tokens = [];
    for (const raw of norm.split(' ')) {
        let tok = raw.replace(/^[./-]+|[./-]+$/g, '');
        if (!tok) continue;
        tok = SINGULAR_MAP[tok] || tok;
        if (STOPWORDS.has(tok)) continue;
        if (/^\d+$/.test(tok) && tok.length <= 2) {
            // Conservar números de calibre/año relevantes solo si no son pesos genéricos sueltos
            continue;
        }
        if (tok.length >= 2 || tok === 'a') {
            if (!tokens.includes(tok)) tokens.push(tok);
        }
    }
    return tokens;
}

/**
 * Invalida la caché en RAM de recepciones pendientes.
 */
function invalidarCachePendientes() {
    cachePendientes = null;
    cacheTimestamp = 0;
    inFlightPromise = null;
}

/**
 * Consulta en Supabase Proveedores las recepciones físicas aún no vinculadas en `bunker_lotes_vinculos`.
 * 100% solo lectura hacia Supabase. No enmascara HTTP 401/403 con fallbacks locales.
 */
async function obtenerRecepcionesPendientesSupabase(pool, options = {}) {
    const forzarRefresco = Boolean(options.forzarRefresco);
    const diasVentana = Number(options.diasVentana) > 0 ? Number(options.diasVentana) : 90;
    const nowMs = Date.now();

    if (!forzarRefresco && cachePendientes && (nowMs - cacheTimestamp) < CACHE_TTL_MS) {
        return cachePendientes;
    }
    if (!forzarRefresco && inFlightPromise) {
        return inFlightPromise;
    }

    const run = async () => {
        const key = (process.env.SUPABASE_SERVICE_KEY || '').trim();
        if (!key) {
            return {
                ok: false,
                authError: true,
                statusCode: 500,
                errorCode: 'SUPABASE_KEY_MISSING',
                mensaje: 'Falta configurar SUPABASE_SERVICE_KEY en el .env raíz.',
                items: [],
                totalPendientes: 0,
                remitosPendientes: 0,
                resumenRemitos: []
            };
        }

        const headers = { apikey: key, Authorization: `Bearer ${key}` };
        let allItems = [];
        let offset = 0;
        const pageSize = 250;

        try {
            while (allItems.length < 500) {
                const url = `${SUPABASE_BASE_URL}/recepciones_fisicas_items?select=id,created_at,cantidad_recibida,cantidad_esperada,costo_unitario,recepciones_fisicas_cabecera(id,fecha_recepcion,numero_remito,pedido_id,estado,envio_tipo,costo_logistico_estado,pedidos_b2b_cabecera(id,proveedor_id,proveedores(id,nombre))),pedidos_b2b_items(id,producto_codigo,producto_descripcion,unidad_ref,valor_unitario_ref,cant_bult,cant_valor)&order=created_at.desc&limit=${pageSize}&offset=${offset}`;
                const resp = await supabaseFetch(url, { headers }, 1, 300, 6000);
                const rows = await resp.json();
                if (!Array.isArray(rows) || rows.length === 0) break;
                allItems = allItems.concat(rows);
                if (rows.length < pageSize) break;
                offset += pageSize;
            }
        } catch (err) {
            const isAuth = err.code === 'SUPABASE_AUTH_ERROR' || err.statusCode === 401 || err.statusCode === 403;
            if (isAuth) {
                invalidarCachePendientes();
                return {
                    ok: false,
                    authError: true,
                    statusCode: err.statusCode || 401,
                    errorCode: 'SUPABASE_AUTH_ERROR',
                    mensaje: `Supabase Proveedores rechazó SUPABASE_SERVICE_KEY (HTTP ${err.statusCode || 401}). Verificá el .env raíz.`,
                    items: [],
                    totalPendientes: 0,
                    remitosPendientes: 0,
                    resumenRemitos: []
                };
            }
            return {
                ok: false,
                authError: false,
                statusCode: err.statusCode || 503,
                errorCode: 'SUPABASE_NETWORK_ERROR',
                mensaje: err.message || 'No se pudo consultar recepciones en Supabase.',
                items: [],
                totalPendientes: 0,
                remitosPendientes: 0,
                resumenRemitos: []
            };
        }

        const fechaLimiteMs = Date.now() - (diasVentana * 24 * 60 * 60 * 1000);

        const vinculadosRes = await pool.query(
            `SELECT DISTINCT lote_id_supabase FROM public.bunker_lotes_vinculos WHERE lote_id_supabase IS NOT NULL`
        );
        const vinculadosSet = new Set(vinculadosRes.rows.map(r => String(r.lote_id_supabase).trim()));

        const candidatos = allItems.filter(it => {
            if (!it || !it.id) return false;
            if (vinculadosSet.has(String(it.id).trim())) return false;
            const cantRec = parseFloat(it.cantidad_recibida) || 0;
            if (cantRec <= 0) return false;
            const sku = String(it.pedidos_b2b_items?.producto_codigo || '').trim();
            if (sku === 'LMD-MAN-B0B5BF36-OLD') return false;
            const fechaRef = it.recepciones_fisicas_cabecera?.fecha_recepcion || it.created_at;
            if (fechaRef) {
                const ts = new Date(fechaRef).getTime();
                if (!isNaN(ts) && ts < fechaLimiteMs) return false;
            }
            return true;
        });

        // Enriquecer costos reales + IVA desde vw_inventario_consolidado y overrides locales
        const vwMap = new Map();
        const overridesMap = new Map();
        if (candidatos.length > 0) {
            const ids = candidatos.map(c => c.id);
            try {
                const vwUrl = `${SUPABASE_BASE_URL}/vw_inventario_consolidado?id=in.(${ids.join(',')})`;
                const vwResp = await supabaseFetch(vwUrl, { headers }, 1, 300, 6000);
                if (vwResp.ok) {
                    const vwRows = await vwResp.json();
                    if (Array.isArray(vwRows)) {
                        vwRows.forEach(r => vwMap.set(String(r.id), r));
                    }
                }
            } catch (vwErr) {
                console.warn('⚠️ [PENDIENTES-SUPA] No se pudo enriquecer vw_inventario_consolidado:', vwErr.message);
            }

            try {
                const ovRes = await pool.query(
                    `SELECT lote_id_supabase, cant_bult, cant_valor FROM public.lotes_presentacion_overrides WHERE lote_id_supabase = ANY($1::text[])`,
                    [ids.map(String)]
                );
                ovRes.rows.forEach(r => {
                    overridesMap.set(String(r.lote_id_supabase), {
                        cantBult: parseFloat(r.cant_bult),
                        cantValor: parseFloat(r.cant_valor)
                    });
                });
            } catch (ovErr) {
                console.warn('⚠️ [PENDIENTES-SUPA] Aviso leyendo overrides locales:', ovErr.message);
            }
        }

        const items = candidatos.map(it => {
            const cab = it.recepciones_fisicas_cabecera || {};
            const pedItem = it.pedidos_b2b_items || {};
            const vw = vwMap.get(String(it.id)) || null;
            const ov = overridesMap.get(String(it.id)) || null;

            const cantBult = ov?.cantBult || parseFloat(pedItem.cant_bult) || 1;
            const cantValor = ov?.cantValor || parseFloat(pedItem.cant_valor) || 1;
            const kilosPorBulto = cantBult * cantValor;
            const cantidadRecibida = parseFloat(it.cantidad_recibida) || 0;
            const cantidadTotalLote = cantidadRecibida * kilosPorBulto;

            const costoKilo = parseFloat(
                vw?.costo_total_unitario ??
                vw?.costo_compra_unitario ??
                it.costo_unitario ??
                pedItem.valor_unitario_ref ??
                0
            ) || 0;
            const iva = parseFloat(vw?.iva_aplicado ?? 21) || 21;
            const fechaRecepcion = cab.fecha_recepcion || it.created_at || null;
            const proveedorNombre = cab.pedidos_b2b_cabecera?.proveedores?.nombre || 'Proveedor Depósito';
            const numeroRemito = cab.numero_remito || 'S/R';

            return {
                lote_id_supabase: String(it.id),
                lote_codigo_corto: String(it.id).substring(0, 8).toUpperCase(),
                fecha_recepcion: fechaRecepcion,
                fecha_vinculacion: fechaRecepcion,
                proveedor_nombre: proveedorNombre,
                proveedor_id: cab.pedidos_b2b_cabecera?.proveedor_id || null,
                articulo_descripcion: pedItem.producto_descripcion || vw?.descripcion || 'Recepción física en depósito',
                producto_codigo: pedItem.producto_codigo || vw?.sku || '',
                numero_remito: numeroRemito,
                estado_recepcion: cab.estado || 'Recepción Completa',
                unidad_ref: pedItem.unidad_ref || 'Kilogramo',
                cant_bult: cantBult,
                cant_valor: cantValor,
                kilos_por_bulto: kilosPorBulto,
                cantidad_recibida: cantidadRecibida,
                cantidad_total_lote: cantidadTotalLote,
                cantidad_asignada: cantidadRecibida,
                kilos_asignados: cantidadTotalLote,
                costo_kilo_al_momento: costoKilo,
                costo_kilo_calculado: costoKilo,
                costo_bruto_ingresado: Number((costoKilo * cantidadTotalLote).toFixed(2)),
                impuesto_iva: iva,
                pendiente_vincular: true,
                estado_vinculacion: 'PENDIENTE_VINCULAR',
                origen_lote: 'SUPABASE_PENDIENTE'
            };
        }).sort((a, b) => new Date(b.fecha_recepcion || 0) - new Date(a.fecha_recepcion || 0));

        const remitosMap = new Map();
        for (const it of items) {
            const k = `${it.numero_remito}__${it.proveedor_nombre}`;
            if (!remitosMap.has(k)) {
                remitosMap.set(k, {
                    numero_remito: it.numero_remito,
                    proveedor_nombre: it.proveedor_nombre,
                    fecha_recepcion: it.fecha_recepcion,
                    items_count: 0
                });
            }
            remitosMap.get(k).items_count += 1;
        }

        const result = {
            ok: true,
            authError: false,
            statusCode: 200,
            errorCode: null,
            mensaje: null,
            items,
            totalPendientes: items.length,
            remitosPendientes: remitosMap.size,
            resumenRemitos: Array.from(remitosMap.values())
        };

        cachePendientes = result;
        cacheTimestamp = Date.now();
        return result;
    };

    inFlightPromise = run().finally(() => {
        inFlightPromise = null;
    });
    return inFlightPromise;
}

/**
 * Carga el historial de vinculaciones previas desde `bunker_lotes_vinculos` + `bunker_lotes_destinos`
 * validando existencia vigente en `bunker_articulos` o `ingredientes`.
 */
async function cargarHistorialMapeosProveedores(pool) {
    const res = await pool.query(`
        SELECT
            BTRIM(v.proveedor_nombre) AS proveedor_nombre,
            BTRIM(COALESCE(v.producto_codigo, '')) AS producto_codigo,
            BTRIM(COALESCE(v.articulo_descripcion, '')) AS articulo_descripcion,
            d.tipo_destino,
            BTRIM(d.destino_id) AS destino_id,
            COALESCE(ba.kilos_unidad, 0) AS kilos_unidad,
            COALESCE(ba.descripcion_generada, ba.descripcion, i.nombre, d.destino_id) AS descripcion_destino,
            (ba.articulo_id IS NOT NULL OR i.id IS NOT NULL) AS existe_en_catalogo,
            COUNT(*)::int AS veces,
            MAX(v.fecha_vinculacion) AS ultima_fecha
        FROM public.bunker_lotes_vinculos v
        JOIN public.bunker_lotes_destinos d ON d.vinculo_id = v.id
        LEFT JOIN public.bunker_articulos ba
               ON d.tipo_destino = 'ARTICULO_BUNKER'
              AND UPPER(BTRIM(ba.articulo_id)) = UPPER(BTRIM(d.destino_id))
        LEFT JOIN public.ingredientes i
               ON d.tipo_destino = 'INGREDIENTE_PRODUCCION'
              AND BTRIM(d.destino_id) = i.id::text
        WHERE v.proveedor_nombre IS NOT NULL
          AND BTRIM(v.proveedor_nombre) <> ''
        GROUP BY 1, 2, 3, 4, 5, 6, 7, 8
        ORDER BY COUNT(*) DESC, MAX(v.fecha_vinculacion) DESC
    `);

    return res.rows.map(r => ({
        ...r,
        kilos_unidad: parseFloat(r.kilos_unidad) || 0,
        prov_norm: normalizarTextoToken(r.proveedor_nombre),
        cod_norm: String(r.producto_codigo || '').trim().toLowerCase(),
        tokens_hist: extraerTokensSignificativos(r.articulo_descripcion),
        tokens_dest: extraerTokensSignificativos(r.descripcion_destino)
    }));
}

function hayContradiccionDiscriminante(tokensA, tokensB) {
    const setA = new Set(tokensA);
    const setB = new Set(tokensB);
    for (const grupo of GRUPOS_DISCRIMINANTES) {
        const enA = grupo.filter(t => setA.has(t));
        const enB = grupo.filter(t => setB.has(t));
        if (enA.length > 0 && enB.length > 0) {
            const comparten = enA.some(t => setB.has(t));
            if (!comparten) return true;
        }
    }
    return false;
}

/**
 * Sugiere deterministamente el destino Búnker/Ingrediente para una recepción física pendiente.
 * Nivel 1: (proveedor_nombre, producto_codigo) exacto.
 * Nivel 2: mismo proveedor + subconjunto completo de tokens históricos + guarda discriminante + peso compatible.
 */
function sugerirDestinoParaRecepcion(itemPendiente, historialMapeos = []) {
    if (!itemPendiente || !Array.isArray(historialMapeos) || historialMapeos.length === 0) {
        return null;
    }

    const provNorm = normalizarTextoToken(itemPendiente.proveedor_nombre);
    const codNorm = String(itemPendiente.producto_codigo || '').trim().toLowerCase();
    if (!provNorm) return null;

    // Nivel 1: Match exacto por proveedor + producto_codigo
    if (codNorm) {
        const exactos = historialMapeos
            .filter(h => h.existe_en_catalogo && h.prov_norm === provNorm && h.cod_norm === codNorm)
            .sort((a, b) => (b.veces - a.veces) || (new Date(b.ultima_fecha) - new Date(a.ultima_fecha)));

        if (exactos.length > 0) {
            const best = exactos[0];
            return {
                tipo_destino: best.tipo_destino,
                id: best.destino_id,
                descripcion: best.descripcion_destino,
                confianza: 'EXACTO_CODIGO',
                origen_texto: `Código histórico ${best.producto_codigo} (${best.proveedor_nombre})`
            };
        }
    }

    // Nivel 2: Mismo proveedor + coincidencia estricta de tokens descriptivos + peso compatible
    const itemTokens = extraerTokensSignificativos(itemPendiente.articulo_descripcion);
    if (itemTokens.length === 0) return null;
    const itemSet = new Set(itemTokens);
    const kilosBultoItem = parseFloat(itemPendiente.kilos_por_bulto) || 0;

    const candidatos = historialMapeos
        .filter(h => {
            if (!h.existe_en_catalogo || h.prov_norm !== provNorm) return false;
            if (!Array.isArray(h.tokens_hist) || h.tokens_hist.length === 0) return false;

            // Todos los tokens históricos significativos deben estar contenidos en la descripción entrante
            if (!h.tokens_hist.every(t => itemSet.has(t))) return false;

            // Exigir al menos 2 tokens coincidentes salvo que la descripción histórica sea de 1 solo token exacto
            if (h.tokens_hist.length < 2 && itemTokens.length > 2) return false;

            // Guarda anti-falsos positivos entre variedades/cortes/procesos/especies
            if (hayContradiccionDiscriminante(itemTokens, h.tokens_hist)) return false;
            if (h.tokens_dest.length > 0 && hayContradiccionDiscriminante(itemTokens, h.tokens_dest)) return false;

            // Compatibilidad de peso de bulto (evita cruzar bultos 10kg con 2kg/25kg)
            if (h.tipo_destino === 'ARTICULO_BUNKER' && h.kilos_unidad >= 5 && kilosBultoItem >= 5) {
                const maxW = Math.max(h.kilos_unidad, kilosBultoItem);
                if (Math.abs(h.kilos_unidad - kilosBultoItem) / maxW > 0.25) return false;
            }
            return true;
        })
        .sort((a, b) => {
            if (b.tokens_hist.length !== a.tokens_hist.length) {
                return b.tokens_hist.length - a.tokens_hist.length;
            }
            if (b.veces !== a.veces) return b.veces - a.veces;
            return new Date(b.ultima_fecha) - new Date(a.ultima_fecha);
        });

    if (candidatos.length > 0) {
        const best = candidatos[0];
        return {
            tipo_destino: best.tipo_destino,
            id: best.destino_id,
            descripcion: best.descripcion_destino,
            confianza: 'PROVEEDOR_DESCRIPCION',
            origen_texto: `Mismo proveedor (${best.proveedor_nombre}) + coincidencia [${best.tokens_hist.join(', ')}]`
        };
    }

    return null;
}

/**
 * Filtra las recepciones pendientes de Supabase que corresponden a un artículo Búnker
 * o a alguno de sus ingredientes vinculados.
 */
function filtrarPendientesParaDestino(pendientes = [], historialMapeos = [], { articuloId, ingredientesIds = [] } = {}) {
    if (!Array.isArray(pendientes) || pendientes.length === 0) return [];
    const artNorm = String(articuloId || '').trim().toUpperCase();
    const ingSet = new Set((ingredientesIds || []).map(x => String(x).trim()));

    const matched = [];
    for (const item of pendientes) {
        const sug = sugerirDestinoParaRecepcion(item, historialMapeos);
        if (!sug) continue;
        const destIdStr = String(sug.id || '').trim();
        const coincideArt = sug.tipo_destino === 'ARTICULO_BUNKER' && destIdStr.toUpperCase() === artNorm;
        const coincideIng = sug.tipo_destino === 'INGREDIENTE_PRODUCCION' && ingSet.has(destIdStr);

        if (coincideArt || coincideIng) {
            matched.push({
                ...item,
                destino_id: destIdStr,
                tipo_destino: sug.tipo_destino,
                match_pendiente_tipo: sug.confianza,
                match_pendiente_origen: sug.origen_texto
            });
        }
    }
    return matched;
}

module.exports = {
    normalizarTextoToken,
    extraerTokensSignificativos,
    invalidarCachePendientes,
    obtenerRecepcionesPendientesSupabase,
    cargarHistorialMapeosProveedores,
    sugerirDestinoParaRecepcion,
    filtrarPendientesParaDestino
};
