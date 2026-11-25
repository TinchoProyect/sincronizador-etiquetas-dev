'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const axios = require('axios');
const sharp = require('sharp');
const { obtenerDirectorioMediaNodos } = require('./nodosFotosService');
const jh = require('../../shared/jerarquiaBunkerHelper');
const iaMonitor = require('../../services/iaCreditoMonitorService');

const MAX_BASE_DIM = 1080;
const PREVIEW_TTL_MS = 15 * 60 * 1000;
const MAX_PREVIEWS_CACHE = 25;

const FAMILIAS_INTERNAS_EXCLUIDAS_NORM = new Set([
    'produccion',
    'insumos',
    'para clasificar'
]);

const ESTILOS_IA_IMAGEN_BASE = {
    cuenco_neutro: {
        id: 'cuenco_neutro',
        label: 'Cuenco cerámico 45°',
        descripcion_prompt: 'Fotografía gastronómica profesional en plano a 45 grados del ingrediente real servido en un cuenco cerámico artesanal minimalista de tono claro, apoyado sobre una superficie neutra cálida mate con luz natural suave de estudio.'
    },
    granel_cenital: {
        id: 'granel_cenital',
        label: 'A granel cenital',
        descripcion_prompt: 'Fotografía gastronómica profesional en plano cenital (vista superior 90 grados) del ingrediente real a granel dispuesto de forma orgánica y prolija sobre piedra natural clara o madera clara suave, con iluminación natural difusa.'
    },
    fondo_blanco: {
        id: 'fondo_blanco',
        label: 'Fondo blanco limpio',
        descripcion_prompt: 'Fotografía profesional de catálogo e-commerce del ingrediente real agrupado en una pequeña pila limpia sobre fondo blanco puro minimalista, iluminación suave de estudio y sombra natural muy sutil.'
    }
};

const _previewsIaCache = new Map();

function limpiarPreviewsExpirados() {
    const ahora = Date.now();
    for (const [tok, item] of _previewsIaCache.entries()) {
        if (!item || (ahora - item.createdAt) > PREVIEW_TTL_MS) {
            _previewsIaCache.delete(tok);
        }
    }
    while (_previewsIaCache.size >= MAX_PREVIEWS_CACHE) {
        const firstKey = _previewsIaCache.keys().next().value;
        if (!firstKey) break;
        _previewsIaCache.delete(firstKey);
    }
}

function generarIdMediaBase(prefijo = 'ib') {
    const ts = Date.now().toString(36);
    const rnd = crypto.randomBytes(4).toString('hex');
    return `${prefijo}-${ts}${rnd}`.toLowerCase();
}

function normalizarTipoAncla(raw) {
    const t = String(raw || '').trim().toUpperCase();
    if (t === 'ANCLA_PRINCIPAL' || t === 'INGREDIENTE' || t === 'PRODUCTO_BASE' || t === 'ARTICULO_SKU') {
        return t;
    }
    const err = new Error('tipo_ancla inválido. Usá ANCLA_PRINCIPAL, INGREDIENTE, PRODUCTO_BASE o ARTICULO_SKU.');
    err.statusCode = 400;
    throw err;
}

function sanitizarSegmentoPath(val, fallback = 'item') {
    const clean = String(val || '')
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .toLowerCase()
        .replace(/[^a-z0-9_-]+/g, '_')
        .replace(/^_+|_+$/g, '');
    return clean || fallback;
}

function construirClaveAnclaPrincipal(familiaId, articuloPrincipal) {
    const fam = Number(familiaId || 0) || 0;
    const artNorm = jh.normalizarClaveTexto(articuloPrincipal);
    if (!fam || !artNorm) return '';
    return `${fam}::${artNorm}`;
}

function obtenerRutasArchivoBiblioteca(familiaNombreOrSlug, fotoId) {
    const famSlug = sanitizarSegmentoPath(familiaNombreOrSlug, 'general');
    const cleanFotoId = sanitizarSegmentoPath(fotoId, 'lib');
    const dir = path.join(obtenerDirectorioMediaNodos(), 'biblioteca-lamda', famSlug);
    return {
        dir,
        famSlug,
        pubPath: path.join(dir, `${cleanFotoId}.webp`),
        origPath: path.join(dir, `${cleanFotoId}_orig.webp`),
        publicUrl: `/media/nodos/biblioteca-lamda/${famSlug}/${cleanFotoId}.webp`,
        origUrl: `/media/nodos/biblioteca-lamda/${famSlug}/${cleanFotoId}_orig.webp`
    };
}

function borrarArchivoPorUrlPublicaSilencioso(urlPublica, { protegerBiblioteca = true } = {}) {
    try {
        const u = String(urlPublica || '').trim();
        if (!u.startsWith('/media/nodos/')) return;
        if (protegerBiblioteca && u.startsWith('/media/nodos/biblioteca-lamda/')) {
            return;
        }
        const rel = u.replace(/^\/media\/nodos\//, '').replace(/\.\./g, '');
        const abs = path.join(obtenerDirectorioMediaNodos(), rel);
        const absOrig = abs.replace(/\.webp$/i, '_orig.webp');
        if (fs.existsSync(abs)) fs.unlinkSync(abs);
        if (fs.existsSync(absOrig)) fs.unlinkSync(absOrig);
        const dir = path.dirname(abs);
        if (fs.existsSync(dir) && fs.readdirSync(dir).length === 0) {
            fs.rmdirSync(dir);
        }
    } catch (_) {}
}

async function procesarYGuardarWebp(buffer, pubPath, origPath) {
    if (!Buffer.isBuffer(buffer) || buffer.length === 0) {
        const err = new Error('Archivo de imagen vacío o inválido.');
        err.statusCode = 400;
        throw err;
    }
    fs.mkdirSync(path.dirname(pubPath), { recursive: true });

    const metaBase = sharp(buffer, { failOnError: true }).rotate();
    await metaBase
        .clone()
        .resize(1600, 1600, { fit: 'inside', withoutEnlargement: true })
        .webp({ quality: 88 })
        .toFile(origPath);

    const infoPub = await metaBase
        .clone()
        .resize(MAX_BASE_DIM, MAX_BASE_DIM, { fit: 'inside', withoutEnlargement: true })
        .webp({ quality: 84, effort: 4 })
        .toFile(pubPath);

    return {
        width: infoPub.width || null,
        height: infoPub.height || null,
        bytes: infoPub.size || null
    };
}

async function obtenerMapaImagenesBaseActivas(db) {
    const res = await db.query(`
        SELECT id, tipo_ancla, ingrediente_id, clave_producto_base, articulo_sku,
               familia_id, articulo_principal_norm, biblioteca_imagen_id,
               foto_id, url, width, height, bytes, origen_tipo, origen_foto_lote_id,
               titulo_referencia, created_at, updated_at
        FROM public.lamda_imagenes_base
        WHERE activo = true
        ORDER BY id DESC
    `);

    const porIngredienteId = new Map();
    const porClaveBase = new Map();
    const porSku = new Map();
    const porAnclaPrincipal = new Map();

    for (const row of res.rows) {
        const entry = {
            id: Number(row.id),
            tipo_ancla: row.tipo_ancla,
            ingrediente_id: row.ingrediente_id ? Number(row.ingrediente_id) : null,
            clave_producto_base: row.clave_producto_base || null,
            articulo_sku: row.articulo_sku || null,
            familia_id: row.familia_id ? Number(row.familia_id) : null,
            articulo_principal_norm: row.articulo_principal_norm || null,
            biblioteca_imagen_id: row.biblioteca_imagen_id ? Number(row.biblioteca_imagen_id) : null,
            foto_id: row.foto_id,
            url: row.url,
            width: row.width ? Number(row.width) : null,
            height: row.height ? Number(row.height) : null,
            bytes: row.bytes ? Number(row.bytes) : null,
            origen_tipo: row.origen_tipo,
            titulo_referencia: row.titulo_referencia || null,
            updated_at: row.updated_at || row.created_at
        };
        if (row.tipo_ancla === 'ARTICULO_SKU' && row.articulo_sku) {
            const skuKey = String(row.articulo_sku).trim().toUpperCase();
            if (!porSku.has(skuKey)) porSku.set(skuKey, entry);
        } else if (row.tipo_ancla === 'INGREDIENTE' && row.ingrediente_id) {
            const ingKey = Number(row.ingrediente_id);
            if (!porIngredienteId.has(ingKey)) porIngredienteId.set(ingKey, entry);
        } else if (row.tipo_ancla === 'PRODUCTO_BASE' && row.clave_producto_base) {
            const cbKey = String(row.clave_producto_base).trim();
            if (!porClaveBase.has(cbKey)) porClaveBase.set(cbKey, entry);
        } else if (row.tipo_ancla === 'ANCLA_PRINCIPAL' && row.familia_id && row.articulo_principal_norm) {
            const anclaKey = construirClaveAnclaPrincipal(row.familia_id, row.articulo_principal_norm);
            if (anclaKey && !porAnclaPrincipal.has(anclaKey)) porAnclaPrincipal.set(anclaKey, entry);
        }
    }

    return { porIngredienteId, porClaveBase, porSku, porAnclaPrincipal };
}

/**
 * Cascada determinista de 4 niveles:
 *   1. ARTICULO_SKU (excepción puntual de SKU/combo)
 *   2. INGREDIENTE (excepción visual de variedad/ingrediente)
 *   3. PRODUCTO_BASE (excepción visual taxonómica)
 *   4. ANCLA_PRINCIPAL (foto base del rubro: Familia + Sustantivo Ancla)
 */
function resolverImagenBaseLamdaParaArticulo(art = {}, mapaImagenes = null) {
    if (!mapaImagenes) return null;

    const skuKey = String(art.sku_nodo || art.articulo_id || '').trim().toUpperCase();
    if (skuKey && mapaImagenes.porSku && mapaImagenes.porSku.has(skuKey)) {
        return { ...mapaImagenes.porSku.get(skuKey), heredada_de_ancla: false };
    }

    const ingId = Number(art.ingrediente_origen_id || art.ing_id || 0);
    if (ingId > 0 && mapaImagenes.porIngredienteId && mapaImagenes.porIngredienteId.has(ingId)) {
        return { ...mapaImagenes.porIngredienteId.get(ingId), heredada_de_ancla: false };
    }

    const claveBase = String(art.clave_producto_base || '').trim();
    if (claveBase && mapaImagenes.porClaveBase && mapaImagenes.porClaveBase.has(claveBase)) {
        return { ...mapaImagenes.porClaveBase.get(claveBase), heredada_de_ancla: false };
    }

    const famId = Number(
        art.jerarquia_b2b?.familia_id ??
        art.bunker_familia_id ??
        art.familia_bunker_id ??
        art.familia_id ??
        0
    ) || 0;
    const artPrincipal = String(
        art.jerarquia_b2b?.articulo_principal ??
        art.articulo_principal_bunker ??
        art.articulo_principal ??
        ''
    ).trim();
    const anclaKey = construirClaveAnclaPrincipal(famId, artPrincipal);
    if (anclaKey && mapaImagenes.porAnclaPrincipal && mapaImagenes.porAnclaPrincipal.has(anclaKey)) {
        return { ...mapaImagenes.porAnclaPrincipal.get(anclaKey), heredada_de_ancla: true };
    }

    return null;
}

function resolverExcepcionDirectaVariedad(variedad, mapaImg) {
    if (!mapaImg || !variedad) return null;
    if (variedad.ingrediente_id && mapaImg.porIngredienteId.has(Number(variedad.ingrediente_id))) {
        return mapaImg.porIngredienteId.get(Number(variedad.ingrediente_id));
    }
    const claves = [variedad.clave_producto_base, ...(variedad.claves_secundarias || [])].filter(Boolean);
    for (const c of claves) {
        if (mapaImg.porClaveBase.has(c)) {
            return mapaImg.porClaveBase.get(c);
        }
    }
    if (variedad.es_combo && variedad.sku_principal_combo) {
        const skuUp = String(variedad.sku_principal_combo).trim().toUpperCase();
        if (mapaImg.porSku.has(skuUp)) {
            return mapaImg.porSku.get(skuUp);
        }
    }
    return null;
}

async function listarProductosBaseConImagenes(db, {
    soloCatalogoNodos = false,
    busqueda = '',
    familiaId = null,
    articuloPrincipal = '',
    incluirInternas = false
} = {}) {
    const famIdFiltro = Number(familiaId || 0) || 0;
    const artPrincipalFiltroNorm = jh.normalizarClaveTexto(articuloPrincipal);

    const [mapaJer, mapaImg, artRes] = await Promise.all([
        jh.cargarMapaJerarquiaB2B(db),
        obtenerMapaImagenesBaseActivas(db),
        db.query(`
            SELECT ba.articulo_id AS sku_nodo,
                   ba.descripcion,
                   ba.descripcion_generada,
                   ba.familia_id,
                   COALESCE(bf.nombre, ba.rubro, 'Almacén') AS familia_nombre,
                   ba.kilos_unidad,
                   ba.es_pack,
                   ba.pack_unidades,
                   ba.pack_hijo_codigo,
                   COALESCE(nac.es_combo, ba.es_combo, false) AS es_combo,
                   ba.propiedades_dinamicas,
                   COALESCE(nac.ingrediente_origen_id, ing_rec.id, ing_dir.id) AS ingrediente_origen_id,
                   COALESCE(ing_nac.codigo, ing_rec.codigo, ing_dir.codigo) AS ingrediente_codigo,
                   COALESCE(ing_nac.nombre, ing_rec.nombre, ing_dir.nombre) AS ingrediente_nombre,
                   nac.id AS catalogo_nodo_id,
                   nac.activo AS en_catalogo_nodos,
                   nac.precio_base_nodo_final,
                   COALESCE(bla.disponible, false) AS disponible_lista_8
            FROM public.bunker_articulos ba
            LEFT JOIN public.bunker_familias bf ON bf.id = ba.familia_id
            LEFT JOIN public.nodos_articulos_catalogo nac ON UPPER(nac.sku_nodo) = UPPER(ba.articulo_id)
            LEFT JOIN public.bunker_lista_articulos bla ON UPPER(bla.articulo_numero) = UPPER(ba.articulo_id) AND bla.lista_id = 8
            LEFT JOIN public.ingredientes ing_nac ON ing_nac.id = nac.ingrediente_origen_id
            LEFT JOIN LATERAL (
                SELECT i.id, i.codigo, i.nombre
                FROM public.recetas r
                JOIN public.receta_ingredientes ri ON ri.receta_id = r.id
                JOIN public.ingredientes i ON i.id = ri.ingrediente_id AND COALESCE(i.es_insumo, false) = false
                WHERE UPPER(r.articulo_numero) = UPPER(COALESCE(NULLIF(ba.pack_hijo_codigo, ''), ba.articulo_id))
                ORDER BY ri.cantidad DESC
                LIMIT 1
            ) ing_rec ON true
            LEFT JOIN public.ingredientes ing_dir
              ON UPPER(ing_dir.articulo_vinculado_numero) = UPPER(ba.articulo_id)
             AND COALESCE(ing_dir.es_insumo, false) = false
            ${soloCatalogoNodos ? 'WHERE nac.id IS NOT NULL AND nac.activo = true' : ''}
            ORDER BY familia_nombre ASC, ba.descripcion_generada ASC, ba.articulo_id ASC
        `)
    ]);

    const gruposMap = new Map();
    const anclasMap = new Map();

    for (const row of artRes.rows) {
        const jer = jh.resolverJerarquiaArticuloBunker(row, mapaJer);
        const famNorm = jh.normalizarClaveTexto(jer.familia_nombre);
        const artPNorm = jh.normalizarClaveTexto(jer.articulo_principal);

        if (famIdFiltro > 0 && Number(jer.familia_id || 0) !== famIdFiltro) {
            continue;
        }
        if (artPrincipalFiltroNorm && artPNorm !== artPrincipalFiltroNorm) {
            continue;
        }
        if (!incluirInternas && famIdFiltro <= 0 && FAMILIAS_INTERNAS_EXCLUIDAS_NORM.has(famNorm)) {
            continue;
        }

        const { nombre_base_oficial, presentacion_corta } = jh.extraerNombreBaseYPresentacion(row);
        const claveBase = jh.construirClaveProductoBase({ ...row, articulo_catalogo_id: row.catalogo_nodo_id }, jer);
        const enNodos = Boolean(row.en_catalogo_nodos && row.catalogo_nodo_id);
        const ingId = row.ingrediente_origen_id ? Number(row.ingrediente_origen_id) : null;

        // 1. Mantener grupos granulares para compatibilidad (productos_base)
        if (!gruposMap.has(claveBase)) {
            const tipoAnclaDefault = row.es_combo
                ? 'ARTICULO_SKU'
                : (ingId ? 'INGREDIENTE' : 'PRODUCTO_BASE');
            gruposMap.set(claveBase, {
                clave_producto_base: claveBase,
                familia_id: jer.familia_id,
                familia_nombre: jer.familia_nombre,
                articulo_principal: jer.articulo_principal,
                sub_categoria: jer.sub_categoria,
                sub_sub_categoria: jer.sub_sub_categoria,
                sub_sub_sub_categoria: jer.sub_sub_sub_categoria,
                ruta_compacta: jer.ruta_compacta,
                nombre_base_oficial,
                es_combo: Boolean(row.es_combo),
                ingrediente_id: ingId,
                ingrediente_codigo: row.ingrediente_codigo || null,
                ingrediente_nombre: row.ingrediente_nombre || null,
                tipo_ancla_default: tipoAnclaDefault,
                sku_principal_combo: row.es_combo ? row.sku_nodo : null,
                presentaciones: [],
                en_nodos_count: 0,
                imagen_base: null
            });
        }
        const g = gruposMap.get(claveBase);
        if (enNodos) g.en_nodos_count += 1;
        const imgResuelta = resolverImagenBaseLamdaParaArticulo({ ...row, jerarquia_b2b: jer, clave_producto_base: claveBase }, mapaImg);
        if (!g.imagen_base && imgResuelta) g.imagen_base = imgResuelta;

        const presObj = {
            sku_nodo: row.sku_nodo,
            descripcion_generada: row.descripcion_generada,
            presentacion_corta,
            kilos_unidad: Number(row.kilos_unidad || 0),
            es_pack: Boolean(row.es_pack),
            catalogo_nodo_id: row.catalogo_nodo_id ? Number(row.catalogo_nodo_id) : null,
            en_catalogo_nodos: enNodos,
            disponible_lista_8: Boolean(row.disponible_lista_8),
            precio_base_nodo_final: row.precio_base_nodo_final ? Number(row.precio_base_nodo_final) : null,
            imagen_override_sku: mapaImg.porSku.get(String(row.sku_nodo || '').toUpperCase()) || null
        };
        g.presentaciones.push(presObj);

        // 2. Agrupar por Ancla Principal (familia_id + articulo_principal_norm)
        const anclaKey = `fam_${Number(jer.familia_id || 0)}__${sanitizarSegmentoPath(artPNorm, 'general')}`;
        const claveMapaAncla = construirClaveAnclaPrincipal(jer.familia_id, artPNorm);
        const imagenAncla = claveMapaAncla ? (mapaImg.porAnclaPrincipal.get(claveMapaAncla) || null) : null;

        if (!anclasMap.has(anclaKey)) {
            anclasMap.set(anclaKey, {
                ancla_key: anclaKey,
                familia_id: Number(jer.familia_id || 0) || null,
                familia_nombre: jer.familia_nombre,
                familia_slug: sanitizarSegmentoPath(jer.familia_nombre, 'general'),
                articulo_principal: jer.articulo_principal || jer.familia_nombre,
                articulo_principal_norm: artPNorm,
                imagen_ancla: imagenAncla,
                variedadesMap: new Map(),
                total_presentaciones: 0,
                en_nodos_count: 0
            });
        }
        const anclaObj = anclasMap.get(anclaKey);
        anclaObj.total_presentaciones += 1;
        if (enNodos) anclaObj.en_nodos_count += 1;

        // Unificar bulto + fracción + presentaciones del mismo ingrediente en una sola fila de variedad
        const varNorm = (!row.es_combo && ingId > 0)
            ? `ing_${ingId}`
            : (jh.normalizarClaveTexto(nombre_base_oficial) || claveBase);
        if (!anclaObj.variedadesMap.has(varNorm)) {
            anclaObj.variedadesMap.set(varNorm, {
                variedad_key: varNorm,
                clave_producto_base: claveBase,
                claves_secundarias: [],
                familia_id: Number(jer.familia_id || 0) || null,
                familia_nombre: jer.familia_nombre,
                articulo_principal: jer.articulo_principal || jer.familia_nombre,
                articulo_principal_norm: artPNorm,
                ruta_compacta: jer.ruta_compacta,
                nombre_base_oficial,
                _tieneNombreDeNodo: Boolean(enNodos),
                es_combo: Boolean(row.es_combo),
                ingrediente_id: ingId,
                ingrediente_codigo: row.ingrediente_codigo || null,
                ingrediente_nombre: row.ingrediente_nombre || null,
                tipo_ancla_default: row.es_combo ? 'ARTICULO_SKU' : (ingId ? 'INGREDIENTE' : 'PRODUCTO_BASE'),
                sku_principal_combo: row.es_combo ? row.sku_nodo : null,
                presentaciones: [],
                en_nodos_count: 0
            });
        }
        const vObj = anclaObj.variedadesMap.get(varNorm);
        if ((enNodos && !vObj._tieneNombreDeNodo) ||
            (Boolean(enNodos) === Boolean(vObj._tieneNombreDeNodo) && nombre_base_oficial.length > vObj.nombre_base_oficial.length)) {
            vObj.nombre_base_oficial = nombre_base_oficial;
            vObj._tieneNombreDeNodo = Boolean(enNodos);
        }
        // Priorizar ancla de ingrediente real cuando coexisten ing_<id> y tax_<hash> del mismo producto base
        if (!vObj.ingrediente_id && ingId) {
            vObj.claves_secundarias.push(vObj.clave_producto_base);
            vObj.clave_producto_base = claveBase;
            vObj.ingrediente_id = ingId;
            vObj.ingrediente_codigo = row.ingrediente_codigo || null;
            vObj.ingrediente_nombre = row.ingrediente_nombre || null;
            vObj.tipo_ancla_default = row.es_combo ? 'ARTICULO_SKU' : 'INGREDIENTE';
        } else if (claveBase !== vObj.clave_producto_base && !vObj.claves_secundarias.includes(claveBase)) {
            vObj.claves_secundarias.push(claveBase);
        }
        if (enNodos) vObj.en_nodos_count += 1;
        vObj.presentaciones.push(presObj);
    }

    const qNorm = jh.normalizarClaveTexto(busqueda);
    const terms = qNorm ? qNorm.split(/\s+/).filter(Boolean) : [];

    let productosBase = Array.from(gruposMap.values()).map(g => {
        g.presentaciones.sort((a, b) => a.kilos_unidad - b.kilos_unidad || a.sku_nodo.localeCompare(b.sku_nodo));
        return {
            ...g,
            total_presentaciones: g.presentaciones.length
        };
    });

    if (terms.length > 0) {
        productosBase = productosBase.filter(g => {
            const bolsa = jh.normalizarClaveTexto([
                g.familia_nombre,
                g.articulo_principal,
                ...(g.ruta_compacta || []),
                g.nombre_base_oficial,
                g.ingrediente_codigo,
                g.ingrediente_nombre,
                g.clave_producto_base,
                ...g.presentaciones.map(p => `${p.sku_nodo} ${p.descripcion_generada} ${p.presentacion_corta}`)
            ].filter(Boolean).join(' '));
            return terms.every(t => bolsa.includes(t));
        });
    }

    productosBase.sort((a, b) =>
        a.familia_nombre.localeCompare(b.familia_nombre, 'es-AR') ||
        a.nombre_base_oficial.localeCompare(b.nombre_base_oficial, 'es-AR')
    );

    let anclasPrincipales = Array.from(anclasMap.values()).map(a => {
        const variedades = Array.from(a.variedadesMap.values()).map(v => {
            v.presentaciones.sort((x, y) => x.kilos_unidad - y.kilos_unidad || x.sku_nodo.localeCompare(y.sku_nodo));
            const imagenPropia = resolverExcepcionDirectaVariedad(v, mapaImg);
            const imagenEfectiva = imagenPropia || a.imagen_ancla || null;
            const { _tieneNombreDeNodo, ...vClean } = v;
            return {
                ...vClean,
                claves_secundarias: Array.from(new Set(v.claves_secundarias)),
                total_presentaciones: v.presentaciones.length,
                tiene_excepcion_propia: Boolean(imagenPropia),
                imagen_propia: imagenPropia,
                imagen_efectiva: imagenEfectiva
            };
        }).sort((x, y) => x.nombre_base_oficial.localeCompare(y.nombre_base_oficial, 'es-AR'));

        const excepcionesCount = variedades.filter(v => v.tiene_excepcion_propia).length;
        const imagenEfectivaAncla = a.imagen_ancla || variedades.find(v => v.imagen_propia)?.imagen_propia || null;

        return {
            ancla_key: a.ancla_key,
            familia_id: a.familia_id,
            familia_nombre: a.familia_nombre,
            familia_slug: a.familia_slug,
            articulo_principal: a.articulo_principal,
            articulo_principal_norm: a.articulo_principal_norm,
            imagen_ancla: a.imagen_ancla,
            imagen_efectiva: imagenEfectivaAncla,
            total_variedades: variedades.length,
            total_presentaciones: a.total_presentaciones,
            en_nodos_count: a.en_nodos_count,
            excepciones_count: excepcionesCount,
            variedades
        };
    });

    if (terms.length > 0) {
        anclasPrincipales = anclasPrincipales.filter(a => {
            const bolsa = jh.normalizarClaveTexto([
                a.familia_nombre,
                a.articulo_principal,
                ...a.variedades.map(v => `${v.nombre_base_oficial} ${v.ingrediente_codigo || ''} ${v.ingrediente_nombre || ''} ${v.presentaciones.map(p => p.sku_nodo).join(' ')}`)
            ].filter(Boolean).join(' '));
            return terms.every(t => bolsa.includes(t));
        });
    }

    anclasPrincipales.sort((a, b) =>
        a.familia_nombre.localeCompare(b.familia_nombre, 'es-AR') ||
        a.articulo_principal.localeCompare(b.articulo_principal, 'es-AR')
    );

    const resumen = {
        total_anclas_principales: anclasPrincipales.length,
        anclas_con_foto: anclasPrincipales.filter(a => Boolean(a.imagen_ancla)).length,
        total_excepciones_activas: anclasPrincipales.reduce((s, a) => s + a.excepciones_count, 0),
        total_productos_base: productosBase.length,
        con_imagen_base: productosBase.filter(p => Boolean(p.imagen_base)).length,
        sin_imagen_base: productosBase.filter(p => !p.imagen_base).length,
        total_en_nodos: productosBase.filter(p => p.en_nodos_count > 0).length
    };

    return {
        anclas_principales: anclasPrincipales,
        productos_base: productosBase,
        estilos_ia: Object.values(ESTILOS_IA_IMAGEN_BASE),
        resumen
    };
}

async function guardarEnBibliotecaLamda(db, {
    familia_id = null,
    familia_nombre = null,
    articulo_principal = null,
    etiqueta = null,
    buffer,
    origen_tipo = 'UPLOAD_PC',
    modelo_ia = null,
    preset_estilo = null,
    prompt_usado = null
}) {
    let famIdNum = familia_id ? Number(familia_id) : null;
    let famNomClean = String(familia_nombre || '').trim();
    if (famIdNum && !famNomClean) {
        const fRes = await db.query('SELECT nombre FROM public.bunker_familias WHERE id = $1 LIMIT 1', [famIdNum]);
        if (fRes.rows[0]?.nombre) famNomClean = fRes.rows[0].nombre;
    }

    const fotoId = generarIdMediaBase(origen_tipo === 'IA_GEMINI' ? 'ia' : 'lib');
    const rutas = obtenerRutasArchivoBiblioteca(famNomClean || 'general', fotoId);
    const metaImg = await procesarYGuardarWebp(buffer, rutas.pubPath, rutas.origPath);
    const artPNorm = articulo_principal ? jh.normalizarClaveTexto(articulo_principal) : null;
    const etiquetaFinal = String(etiqueta || articulo_principal || famNomClean || 'Imagen LAMDA').trim().slice(0, 180);

    try {
        const ins = await db.query(
            `INSERT INTO public.lamda_biblioteca_imagenes (
                familia_id, familia_slug, articulo_principal_norm, etiqueta,
                foto_id, url, url_original, width, height, bytes,
                origen_tipo, modelo_ia, preset_estilo, prompt_usado, activo
             ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,true)
             RETURNING *`,
            [
                famIdNum,
                rutas.famSlug,
                artPNorm,
                etiquetaFinal,
                fotoId,
                rutas.publicUrl,
                rutas.origUrl,
                metaImg.width,
                metaImg.height,
                metaImg.bytes,
                String(origen_tipo || 'UPLOAD_PC').slice(0, 24),
                modelo_ia ? String(modelo_ia).slice(0, 80) : null,
                preset_estilo ? String(preset_estilo).slice(0, 40) : null,
                prompt_usado ? String(prompt_usado).slice(0, 2000) : null
            ]
        );
        return ins.rows[0];
    } catch (err) {
        borrarArchivoPorUrlPublicaSilencioso(rutas.publicUrl, { protegerBiblioteca: false });
        throw err;
    }
}

async function listarBibliotecaImagenesLamda(db, { familiaId = null, articuloPrincipal = '', busqueda = '' } = {}) {
    const famIdFiltro = Number(familiaId || 0) || 0;
    const artPNorm = jh.normalizarClaveTexto(articuloPrincipal);
    const qNorm = jh.normalizarClaveTexto(busqueda);
    const terms = qNorm ? qNorm.split(/\s+/).filter(Boolean) : [];

    const res = await db.query(`
        SELECT b.*, bf.nombre AS familia_nombre,
               (SELECT COUNT(*)::int FROM public.lamda_imagenes_base ib WHERE ib.biblioteca_imagen_id = b.id AND ib.activo = true) AS usos_activos
        FROM public.lamda_biblioteca_imagenes b
        LEFT JOIN public.bunker_familias bf ON bf.id = b.familia_id
        WHERE b.activo = true
        ORDER BY b.id DESC
    `);

    let items = res.rows.map(r => {
        const rArtNorm = jh.normalizarClaveTexto(r.articulo_principal_norm);
        const matchExacto = Boolean(famIdFiltro > 0 && Number(r.familia_id || 0) === famIdFiltro && (!artPNorm || rArtNorm === artPNorm));
        const matchFamilia = Boolean(famIdFiltro > 0 && Number(r.familia_id || 0) === famIdFiltro);
        return {
            ...r,
            id: Number(r.id),
            familia_id: r.familia_id ? Number(r.familia_id) : null,
            usos_activos: Number(r.usos_activos || 0),
            relevancia: matchExacto ? 2 : (matchFamilia ? 1 : 0)
        };
    });

    if (terms.length > 0) {
        items = items.filter(it => {
            const bolsa = jh.normalizarClaveTexto([it.etiqueta, it.familia_nombre, it.familia_slug, it.articulo_principal_norm, it.modelo_ia, it.preset_estilo].filter(Boolean).join(' '));
            return terms.every(t => bolsa.includes(t));
        });
    }

    items.sort((a, b) => (b.relevancia - a.relevancia) || (b.id - a.id));
    return { items, total: items.length };
}

async function eliminarImagenBibliotecaLamda(db, bibliotecaId) {
    const idNum = Number(bibliotecaId);
    if (!Number.isInteger(idNum) || idNum <= 0) {
        const err = new Error('ID de imagen de biblioteca inválido.');
        err.statusCode = 400;
        throw err;
    }

    const client = await db.connect();
    let eliminada;
    try {
        await client.query('BEGIN');
        await client.query(
            `UPDATE public.lamda_imagenes_base
             SET activo = false, updated_at = NOW()
             WHERE biblioteca_imagen_id = $1 AND activo = true`,
            [idNum]
        );
        const del = await client.query(
            `UPDATE public.lamda_biblioteca_imagenes
             SET activo = false, updated_at = NOW()
             WHERE id = $1 AND activo = true
             RETURNING *`,
            [idNum]
        );
        if (del.rows.length === 0) {
            const err = new Error('Imagen de biblioteca no encontrada o ya eliminada.');
            err.statusCode = 404;
            throw err;
        }
        eliminada = del.rows[0];
        await client.query('COMMIT');
    } catch (err) {
        await client.query('ROLLBACK');
        throw err;
    } finally {
        client.release();
    }

    borrarArchivoPorUrlPublicaSilencioso(eliminada.url, { protegerBiblioteca: false });
    return eliminada;
}

async function insertarAsignacionImagenBaseEnTx(client, {
    tipoNorm,
    famIdNum = null,
    artPNorm = null,
    ingIdNum = null,
    claveBaseClean = null,
    skuClean = null,
    bibRow,
    tituloReferencia = null
}) {
    let prevRes;
    if (tipoNorm === 'ANCLA_PRINCIPAL') {
        prevRes = await client.query(
            `UPDATE public.lamda_imagenes_base
             SET activo = false, updated_at = NOW()
             WHERE activo = true AND tipo_ancla = 'ANCLA_PRINCIPAL'
               AND familia_id = $1 AND articulo_principal_norm = $2
             RETURNING url`,
            [famIdNum, artPNorm]
        );
    } else if (tipoNorm === 'INGREDIENTE') {
        prevRes = await client.query(
            `UPDATE public.lamda_imagenes_base
             SET activo = false, updated_at = NOW()
             WHERE activo = true AND tipo_ancla = 'INGREDIENTE' AND ingrediente_id = $1
             RETURNING url`,
            [ingIdNum]
        );
    } else if (tipoNorm === 'PRODUCTO_BASE') {
        prevRes = await client.query(
            `UPDATE public.lamda_imagenes_base
             SET activo = false, updated_at = NOW()
             WHERE activo = true AND tipo_ancla = 'PRODUCTO_BASE' AND clave_producto_base = $1
             RETURNING url`,
            [claveBaseClean]
        );
    } else {
        prevRes = await client.query(
            `UPDATE public.lamda_imagenes_base
             SET activo = false, updated_at = NOW()
             WHERE activo = true AND tipo_ancla = 'ARTICULO_SKU' AND UPPER(articulo_sku) = UPPER($1)
             RETURNING url`,
            [skuClean]
        );
    }

    const prevUrls = (prevRes.rows || []).map(r => r.url).filter(Boolean);
    const ins = await client.query(
        `INSERT INTO public.lamda_imagenes_base (
            tipo_ancla, ingrediente_id, clave_producto_base, articulo_sku,
            familia_id, articulo_principal_norm, biblioteca_imagen_id,
            foto_id, url, url_original, width, height, bytes,
            origen_tipo, titulo_referencia, activo
         ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,true)
         RETURNING *`,
        [
            tipoNorm,
            ingIdNum,
            claveBaseClean,
            skuClean,
            famIdNum,
            artPNorm,
            Number(bibRow.id),
            bibRow.foto_id,
            bibRow.url,
            bibRow.url_original,
            bibRow.width,
            bibRow.height,
            bibRow.bytes,
            String(bibRow.origen_tipo || 'BIBLIOTECA').slice(0, 24),
            tituloReferencia ? String(tituloReferencia).slice(0, 160) : (bibRow.etiqueta || null)
        ]
    );
    return { guardada: ins.rows[0], prevUrls };
}

async function asignarImagenBibliotecaAAncla(db, {
    biblioteca_imagen_id,
    tipo_ancla,
    familia_id = null,
    articulo_principal = null,
    ingrediente_id = null,
    clave_producto_base = null,
    claves_secundarias = [],
    articulo_sku = null,
    titulo_referencia = null
}) {
    const bibIdNum = Number(biblioteca_imagen_id);
    if (!Number.isInteger(bibIdNum) || bibIdNum <= 0) {
        const err = new Error('biblioteca_imagen_id inválido.');
        err.statusCode = 400;
        throw err;
    }

    const bibRes = await db.query('SELECT * FROM public.lamda_biblioteca_imagenes WHERE id = $1 AND activo = true LIMIT 1', [bibIdNum]);
    if (bibRes.rows.length === 0) {
        const err = new Error('Imagen no encontrada en Biblioteca LAMDA.');
        err.statusCode = 404;
        throw err;
    }
    const bibRow = bibRes.rows[0];
    const tipoNorm = normalizarTipoAncla(tipo_ancla);

    let famIdNum = familia_id ? Number(familia_id) : null;
    let artPNorm = articulo_principal ? jh.normalizarClaveTexto(articulo_principal) : null;
    let ingIdNum = ingrediente_id ? Number(ingrediente_id) : null;
    let claveBaseClean = clave_producto_base ? sanitizarSegmentoPath(clave_producto_base, '') : null;
    let skuClean = articulo_sku ? String(articulo_sku).trim().toUpperCase() : null;

    if (tipoNorm === 'ANCLA_PRINCIPAL') {
        if (!Number.isInteger(famIdNum) || famIdNum <= 0 || !artPNorm) {
            const err = new Error('familia_id y articulo_principal son requeridos para ancla ANCLA_PRINCIPAL.');
            err.statusCode = 400;
            throw err;
        }
        ingIdNum = null;
        claveBaseClean = null;
        skuClean = null;
    } else if (tipoNorm === 'INGREDIENTE') {
        if (!Number.isInteger(ingIdNum) || ingIdNum <= 0) {
            const err = new Error('ingrediente_id válido requerido para ancla INGREDIENTE.');
            err.statusCode = 400;
            throw err;
        }
        const ingChk = await db.query('SELECT id, codigo, nombre FROM public.ingredientes WHERE id = $1 LIMIT 1', [ingIdNum]);
        if (ingChk.rows.length === 0) {
            const err = new Error(`Ingrediente #${ingIdNum} no encontrado.`);
            err.statusCode = 404;
            throw err;
        }
        titulo_referencia = titulo_referencia || `[${ingChk.rows[0].codigo || ingIdNum}] ${ingChk.rows[0].nombre}`;
        claveBaseClean = claveBaseClean || `ing_${ingIdNum}`;
        skuClean = null;
    } else if (tipoNorm === 'PRODUCTO_BASE') {
        if (!claveBaseClean) {
            const err = new Error('clave_producto_base requerida para ancla PRODUCTO_BASE.');
            err.statusCode = 400;
            throw err;
        }
        ingIdNum = null;
        skuClean = null;
    } else {
        if (!skuClean) {
            const err = new Error('articulo_sku requerido para ancla ARTICULO_SKU.');
            err.statusCode = 400;
            throw err;
        }
        ingIdNum = null;
    }

    const secClaves = Array.isArray(claves_secundarias)
        ? claves_secundarias.map(c => sanitizarSegmentoPath(c, '')).filter(c => c && c !== claveBaseClean)
        : [];

    const client = await db.connect();
    let guardada;
    const oldNonLibUrls = [];
    try {
        await client.query('BEGIN');
        const mainRes = await insertarAsignacionImagenBaseEnTx(client, {
            tipoNorm,
            famIdNum,
            artPNorm,
            ingIdNum,
            claveBaseClean,
            skuClean,
            bibRow,
            tituloReferencia: titulo_referencia
        });
        guardada = mainRes.guardada;
        oldNonLibUrls.push(...mainRes.prevUrls);

        for (const secClave of secClaves) {
            const secRes = await insertarAsignacionImagenBaseEnTx(client, {
                tipoNorm: 'PRODUCTO_BASE',
                famIdNum,
                artPNorm,
                ingIdNum: null,
                claveBaseClean: secClave,
                skuClean: null,
                bibRow,
                tituloReferencia: titulo_referencia
            });
            oldNonLibUrls.push(...secRes.prevUrls);
        }

        await client.query('COMMIT');
    } catch (err) {
        await client.query('ROLLBACK');
        throw err;
    } finally {
        client.release();
    }

    oldNonLibUrls.forEach(u => borrarArchivoPorUrlPublicaSilencioso(u, { protegerBiblioteca: true }));

    const listado = await listarProductosBaseConImagenes(db, {
        familiaId: famIdNum || undefined,
        articuloPrincipal: artPNorm || undefined
    });
    const anclaAfectada = listado.anclas_principales[0] || null;

    return {
        imagen: guardada,
        biblioteca_item: bibRow,
        presentaciones_heredadas: anclaAfectada ? anclaAfectada.total_presentaciones : 1,
        presentaciones_en_nodos: anclaAfectada ? anclaAfectada.en_nodos_count : 0
    };
}

async function guardarImagenBaseLamda(db, {
    tipo_ancla,
    familia_id = null,
    familia_nombre = null,
    articulo_principal = null,
    ingrediente_id = null,
    clave_producto_base = null,
    claves_secundarias = [],
    articulo_sku = null,
    titulo_referencia = null,
    origen_tipo = 'UPLOAD_PC',
    buffer
}) {
    const bibItem = await guardarEnBibliotecaLamda(db, {
        familia_id,
        familia_nombre,
        articulo_principal,
        etiqueta: titulo_referencia || articulo_principal || familia_nombre || 'Imagen LAMDA',
        buffer,
        origen_tipo: origen_tipo || 'UPLOAD_PC'
    });

    return asignarImagenBibliotecaAAncla(db, {
        biblioteca_imagen_id: bibItem.id,
        tipo_ancla,
        familia_id,
        articulo_principal,
        ingrediente_id,
        clave_producto_base,
        claves_secundarias,
        articulo_sku,
        titulo_referencia
    });
}

async function eliminarImagenBaseLamda(db, imagenId, { claves_secundarias = [] } = {}) {
    const idNum = Number(imagenId);
    if (!Number.isInteger(idNum) || idNum <= 0) {
        const err = new Error('ID de imagen base inválido.');
        err.statusCode = 400;
        throw err;
    }

    const res = await db.query(
        `UPDATE public.lamda_imagenes_base
         SET activo = false, updated_at = NOW()
         WHERE id = $1 AND activo = true
         RETURNING *`,
        [idNum]
    );
    if (res.rows.length === 0) {
        const err = new Error('Imagen base no encontrada o ya eliminada.');
        err.statusCode = 404;
        throw err;
    }
    const eliminada = res.rows[0];

    const secClaves = Array.isArray(claves_secundarias)
        ? claves_secundarias.map(c => sanitizarSegmentoPath(c, '')).filter(Boolean)
        : [];
    if (secClaves.length > 0) {
        await db.query(
            `UPDATE public.lamda_imagenes_base
             SET activo = false, updated_at = NOW()
             WHERE activo = true AND tipo_ancla = 'PRODUCTO_BASE' AND clave_producto_base = ANY($1::text[])`,
            [secClaves]
        );
    }

    // Solo borrar del disco si era una imagen legacy fuera de biblioteca-lamda
    borrarArchivoPorUrlPublicaSilencioso(eliminada.url, { protegerBiblioteca: true });
    return eliminada;
}

function construirPromptImagenBase({
    familia_nombre = '',
    articulo_principal = '',
    nombre_variante = '',
    preset_estilo = 'cuenco_neutro'
} = {}) {
    const estilo = ESTILOS_IA_IMAGEN_BASE[preset_estilo] || ESTILOS_IA_IMAGEN_BASE.cuenco_neutro;
    const sujeto = String(nombre_variante || articulo_principal || 'ingrediente natural').trim();
    const fam = String(familia_nombre || '').trim();
    const contextoFam = fam && jh.normalizarClaveTexto(fam) !== jh.normalizarClaveTexto(sujeto)
        ? ` (rubro: ${fam})`
        : '';

    return [
        estilo.descripcion_prompt,
        `Producto protagonista único: "${sujeto}"${contextoFam}.`,
        'Mostrar únicamente el alimento natural real con fidelidad botánica y textura apetitosa, nitidez alta, encuadre centrado.',
        'Regla estricta: SIN envases, SIN bolsas plásticas, SIN frascos, SIN cajas, SIN etiquetas, SIN marcas comerciales, SIN logos, SIN texto sobreimpreso, SIN manos ni cubiertos.'
    ].join(' ');
}

function extraerImagenBase64DesdeGemini(data = {}) {
    const candidates = Array.isArray(data.candidates) ? data.candidates : [];
    for (const c of candidates) {
        const parts = Array.isArray(c?.content?.parts) ? c.content.parts : [];
        for (const p of parts) {
            const inline = p.inlineData || p.inline_data;
            if (inline && inline.data && String(inline.mimeType || inline.mime_type || 'image/png').startsWith('image/')) {
                return {
                    base64: inline.data,
                    mimeType: inline.mimeType || inline.mime_type || 'image/png'
                };
            }
        }
    }
    return null;
}

async function generarPreviewImagenBaseIA({
    familia_nombre = '',
    articulo_principal = '',
    nombre_variante = '',
    preset_estilo = 'cuenco_neutro',
    calidad = 'estandar',
    prompt_personalizado = ''
} = {}) {
    limpiarPreviewsExpirados();

    const cred = iaMonitor.leerCredencialesGeminiEnCaliente();
    const keys = [];
    if (cred.apiKey) keys.push(cred.apiKey);
    const backupKey = String(process.env.GEMINI_API_KEY_BACKUP || '').trim();
    if (backupKey && backupKey.length > 15 && !keys.includes(backupKey)) {
        keys.push(backupKey);
    }
    if (keys.length === 0) {
        const err = new Error('GEMINI_API_KEY no configurada en este entorno.');
        err.statusCode = 500;
        throw err;
    }

    const calidadNorm = String(calidad || '').trim().toLowerCase() === 'pro' ? 'pro' : 'estandar';
    const modelos = calidadNorm === 'pro'
        ? ['gemini-3-pro-image', 'gemini-3.1-flash-image', 'gemini-2.5-flash-image']
        : ['gemini-3.1-flash-image', 'gemini-2.5-flash-image'];

    const promptFinal = String(prompt_personalizado || '').trim() || construirPromptImagenBase({
        familia_nombre,
        articulo_principal,
        nombre_variante,
        preset_estilo
    });

    let ultimoError = 'No se pudo generar imagen con Gemini.';
    let rawSuccess = null;
    let imgData = null;
    let modeloUsado = modelos[0];

    outerLoop:
    for (const modelo of modelos) {
        for (const apiKey of keys) {
            const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${modelo}:generateContent?key=${encodeURIComponent(apiKey)}`;
            try {
                const resp = await axios.post(endpoint, {
                    contents: [{ parts: [{ text: promptFinal }] }],
                    generationConfig: { responseModalities: ['IMAGE'] }
                }, { timeout: 45000 });

                const extracted = extraerImagenBase64DesdeGemini(resp.data);
                if (extracted) {
                    rawSuccess = resp.data;
                    imgData = extracted;
                    modeloUsado = modelo;
                    break outerLoop;
                }
                ultimoError = `El modelo ${modelo} no devolvió imagen en su respuesta.`;
            } catch (err) {
                const status = err.response?.status;
                const msg = err.response?.data?.error?.message || err.message;
                ultimoError = `${modelo} (HTTP ${status || 'ERR'}): ${msg}`;
                if (status === 402) {
                    iaMonitor.registrarEventoIaSistema({
                        modulo: 'IMAGENES_BASE_IA',
                        detalle: `Error cuota generando foto: ${articulo_principal || nombre_variante}`,
                        modelo,
                        errorMsg: ultimoError
                    });
                }
            }
        }
    }

    if (!imgData) {
        iaMonitor.registrarEventoIaSistema({
            modulo: 'IMAGENES_BASE_IA',
            detalle: `Fallo generando foto base (${articulo_principal || nombre_variante})`,
            modelo: modeloUsado,
            errorMsg: ultimoError
        });
        const err = new Error(`No se pudo generar la imagen con IA: ${ultimoError}`);
        err.statusCode = 502;
        throw err;
    }

    iaMonitor.registrarEventoIaSistema({
        modulo: 'IMAGENES_BASE_IA',
        detalle: `Foto base IA: ${String(nombre_variante || articulo_principal || 'Producto').slice(0, 42)}`,
        rawResponseData: rawSuccess,
        modelo: modeloUsado
    });

    const rawBuf = Buffer.from(imgData.base64, 'base64');
    const normalizedWebp = await sharp(rawBuf, { failOnError: true })
        .rotate()
        .resize(MAX_BASE_DIM, MAX_BASE_DIM, { fit: 'inside', withoutEnlargement: true })
        .webp({ quality: 86, effort: 4 })
        .toBuffer({ resolveWithObject: true });

    const previewToken = generarIdMediaBase('prv');
    _previewsIaCache.set(previewToken, {
        buffer: rawBuf,
        width: normalizedWebp.info.width || null,
        height: normalizedWebp.info.height || null,
        bytes: normalizedWebp.info.size || null,
        modelo_usado: modeloUsado,
        preset_estilo,
        prompt_usado: promptFinal,
        createdAt: Date.now()
    });

    return {
        preview_token: previewToken,
        preview_data_url: `data:image/webp;base64,${normalizedWebp.data.toString('base64')}`,
        modelo_usado: modeloUsado,
        preset_estilo,
        prompt_usado: promptFinal,
        width: normalizedWebp.info.width || null,
        height: normalizedWebp.info.height || null,
        bytes: normalizedWebp.info.size || null
    };
}

async function confirmarPreviewImagenBaseIA(db, {
    preview_token,
    familia_id = null,
    familia_nombre = null,
    articulo_principal = null,
    etiqueta = null,
    tipo_ancla = 'ANCLA_PRINCIPAL',
    ingrediente_id = null,
    clave_producto_base = null,
    claves_secundarias = [],
    articulo_sku = null,
    titulo_referencia = null,
    aplicar_al_ancla = true
}) {
    const tok = String(preview_token || '').trim();
    const cached = _previewsIaCache.get(tok);
    if (!cached || (Date.now() - cached.createdAt) > PREVIEW_TTL_MS) {
        _previewsIaCache.delete(tok);
        const err = new Error('La previsualización IA expiró o no existe. Generá una nueva imagen.');
        err.statusCode = 404;
        throw err;
    }

    const bibItem = await guardarEnBibliotecaLamda(db, {
        familia_id,
        familia_nombre,
        articulo_principal,
        etiqueta: etiqueta || titulo_referencia || articulo_principal || familia_nombre || 'Imagen IA LAMDA',
        buffer: cached.buffer,
        origen_tipo: 'IA_GEMINI',
        modelo_ia: cached.modelo_usado,
        preset_estilo: cached.preset_estilo,
        prompt_usado: cached.prompt_usado
    });

    _previewsIaCache.delete(tok);

    if (!aplicar_al_ancla) {
        return {
            biblioteca_item: bibItem,
            imagen: null,
            presentaciones_heredadas: 0,
            presentaciones_en_nodos: 0
        };
    }

    return asignarImagenBibliotecaAAncla(db, {
        biblioteca_imagen_id: bibItem.id,
        tipo_ancla,
        familia_id,
        articulo_principal,
        ingrediente_id,
        clave_producto_base,
        claves_secundarias,
        articulo_sku,
        titulo_referencia: titulo_referencia || bibItem.etiqueta
    });
}

async function guardarFotoPropiaGrupoGestor(db, { nodoId, claveProductoBase, buffer }) {
    const nId = Number(nodoId);
    const claveSafe = sanitizarSegmentoPath(claveProductoBase, '');
    if (!Number.isInteger(nId) || nId <= 0 || !claveSafe) {
        const err = new Error('Identificadores de nodo y producto base inválidos.');
        err.statusCode = 400;
        throw err;
    }

    const fotoId = generarIdMediaBase('nf');
    const dir = path.join(obtenerDirectorioMediaNodos(), 'grupos', String(nId), claveSafe);
    const pubPath = path.join(dir, `${fotoId}.webp`);
    const origPath = path.join(dir, `${fotoId}_orig.webp`);
    const publicUrl = `/media/nodos/grupos/${nId}/${claveSafe}/${fotoId}.webp`;

    const metaImg = await procesarYGuardarWebp(buffer, pubPath, origPath);
    const fotoObj = {
        id: fotoId,
        url: publicUrl,
        width: metaImg.width,
        height: metaImg.height,
        bytes: metaImg.bytes,
        orden: 1,
        created_at: new Date().toISOString()
    };

    const prevRes = await db.query(
        `SELECT foto_propia_grupo
         FROM public.nodos_grupos_vidriera
         WHERE nodo_id = $1 AND clave_producto_base = $2
         LIMIT 1`,
        [nId, claveSafe]
    );
    const prevUrl = prevRes.rows[0]?.foto_propia_grupo?.url || null;

    const upsert = await db.query(
        `INSERT INTO public.nodos_grupos_vidriera (
            nodo_id, clave_producto_base, imagen_origen_modo, foto_propia_grupo, updated_at
         ) VALUES ($1, $2, 'PROPIA', $3::jsonb, NOW())
         ON CONFLICT (nodo_id, clave_producto_base)
         DO UPDATE SET
            imagen_origen_modo = 'PROPIA',
            foto_propia_grupo = EXCLUDED.foto_propia_grupo,
            updated_at = NOW()
         RETURNING *`,
        [nId, claveSafe, JSON.stringify(fotoObj)]
    );

    if (prevUrl && prevUrl !== publicUrl) {
        borrarArchivoPorUrlPublicaSilencioso(prevUrl, { protegerBiblioteca: true });
    }

    return {
        grupo_config: upsert.rows[0],
        foto: fotoObj
    };
}

module.exports = {
    ESTILOS_IA_IMAGEN_BASE,
    obtenerMapaImagenesBaseActivas,
    resolverImagenBaseLamdaParaArticulo,
    listarProductosBaseConImagenes,
    guardarEnBibliotecaLamda,
    listarBibliotecaImagenesLamda,
    eliminarImagenBibliotecaLamda,
    asignarImagenBibliotecaAAncla,
    guardarImagenBaseLamda,
    eliminarImagenBaseLamda,
    construirPromptImagenBase,
    generarPreviewImagenBaseIA,
    confirmarPreviewImagenBaseIA,
    guardarFotoPropiaGrupoGestor
};
