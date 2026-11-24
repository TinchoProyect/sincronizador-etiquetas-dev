'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const sharp = require('sharp');
const { obtenerDirectorioMediaNodos } = require('./nodosFotosService');
const jh = require('../../shared/jerarquiaBunkerHelper');

const MAX_BASE_DIM = 1080;

function generarIdMediaBase(prefijo = 'ib') {
    const ts = Date.now().toString(36);
    const rnd = crypto.randomBytes(4).toString('hex');
    return `${prefijo}-${ts}${rnd}`.toLowerCase();
}

function normalizarTipoAncla(raw) {
    const t = String(raw || '').trim().toUpperCase();
    if (t === 'INGREDIENTE' || t === 'PRODUCTO_BASE' || t === 'ARTICULO_SKU') return t;
    const err = new Error('tipo_ancla inválido. Usá INGREDIENTE, PRODUCTO_BASE o ARTICULO_SKU.');
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

function obtenerRutasArchivoBase(tipoAncla, anclaSlug, fotoId) {
    const tipoFolder = tipoAncla.toLowerCase();
    const cleanSlug = sanitizarSegmentoPath(anclaSlug);
    const cleanFotoId = sanitizarSegmentoPath(fotoId, 'ib');
    const dir = path.join(obtenerDirectorioMediaNodos(), 'catalogo-base', tipoFolder, cleanSlug);
    return {
        dir,
        tipoFolder,
        cleanSlug,
        pubPath: path.join(dir, `${cleanFotoId}.webp`),
        origPath: path.join(dir, `${cleanFotoId}_orig.webp`),
        publicUrl: `/media/nodos/catalogo-base/${tipoFolder}/${cleanSlug}/${cleanFotoId}.webp`,
        origUrl: `/media/nodos/catalogo-base/${tipoFolder}/${cleanSlug}/${cleanFotoId}_orig.webp`
    };
}

function borrarArchivoPorUrlPublicaSilencioso(urlPublica) {
    try {
        const u = String(urlPublica || '').trim();
        if (!u.startsWith('/media/nodos/')) return;
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
               foto_id, url, width, height, bytes, origen_tipo, origen_foto_lote_id,
               titulo_referencia, created_at, updated_at
        FROM public.lamda_imagenes_base
        WHERE activo = true
        ORDER BY id DESC
    `);

    const porIngredienteId = new Map();
    const porClaveBase = new Map();
    const porSku = new Map();

    for (const row of res.rows) {
        const entry = {
            id: Number(row.id),
            tipo_ancla: row.tipo_ancla,
            ingrediente_id: row.ingrediente_id ? Number(row.ingrediente_id) : null,
            clave_producto_base: row.clave_producto_base || null,
            articulo_sku: row.articulo_sku || null,
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
        }
    }

    return { porIngredienteId, porClaveBase, porSku };
}

function resolverImagenBaseLamdaParaArticulo(art = {}, mapaImagenes = null) {
    if (!mapaImagenes) return null;
    const skuKey = String(art.sku_nodo || art.articulo_id || '').trim().toUpperCase();
    if (skuKey && mapaImagenes.porSku && mapaImagenes.porSku.has(skuKey)) {
        return mapaImagenes.porSku.get(skuKey);
    }
    const ingId = Number(art.ingrediente_origen_id || art.ing_id || 0);
    if (ingId > 0 && mapaImagenes.porIngredienteId && mapaImagenes.porIngredienteId.has(ingId)) {
        return mapaImagenes.porIngredienteId.get(ingId);
    }
    const claveBase = String(art.clave_producto_base || '').trim();
    if (claveBase && mapaImagenes.porClaveBase && mapaImagenes.porClaveBase.has(claveBase)) {
        return mapaImagenes.porClaveBase.get(claveBase);
    }
    return null;
}

async function listarProductosBaseConImagenes(db, { soloCatalogoNodos = false, busqueda = '' } = {}) {
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
    for (const row of artRes.rows) {
        const jer = jh.resolverJerarquiaArticuloBunker(row, mapaJer);
        const { nombre_base_oficial, presentacion_corta } = jh.extraerNombreBaseYPresentacion(row);
        const claveBase = jh.construirClaveProductoBase({ ...row, articulo_catalogo_id: row.catalogo_nodo_id }, jer);

        if (!gruposMap.has(claveBase)) {
            const ingId = row.ingrediente_origen_id ? Number(row.ingrediente_origen_id) : null;
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
        const enNodos = Boolean(row.en_catalogo_nodos && row.catalogo_nodo_id);
        if (enNodos) g.en_nodos_count += 1;

        const imgResuelta = resolverImagenBaseLamdaParaArticulo({ ...row, clave_producto_base: claveBase }, mapaImg);
        if (!g.imagen_base && imgResuelta) {
            g.imagen_base = imgResuelta;
        }

        g.presentaciones.push({
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
        });
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

    const resumen = {
        total_productos_base: productosBase.length,
        con_imagen_base: productosBase.filter(p => Boolean(p.imagen_base)).length,
        sin_imagen_base: productosBase.filter(p => !p.imagen_base).length,
        total_en_nodos: productosBase.filter(p => p.en_nodos_count > 0).length
    };

    return { productos_base: productosBase, resumen };
}

async function guardarImagenBaseLamda(db, {
    tipo_ancla,
    ingrediente_id = null,
    clave_producto_base = null,
    articulo_sku = null,
    titulo_referencia = null,
    origen_tipo = 'UPLOAD_LAMDA',
    origen_foto_lote_id = null,
    buffer
}) {
    const tipoNorm = normalizarTipoAncla(tipo_ancla);
    let ingIdNum = ingrediente_id ? Number(ingrediente_id) : null;
    let claveBaseClean = clave_producto_base ? sanitizarSegmentoPath(clave_producto_base, '') : null;
    let skuClean = articulo_sku ? String(articulo_sku).trim().toUpperCase() : null;
    let anclaSlug = '';

    if (tipoNorm === 'INGREDIENTE') {
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
        anclaSlug = String(ingIdNum);
        skuClean = null;
    } else if (tipoNorm === 'PRODUCTO_BASE') {
        if (!claveBaseClean) {
            const err = new Error('clave_producto_base requerida para ancla PRODUCTO_BASE.');
            err.statusCode = 400;
            throw err;
        }
        anclaSlug = claveBaseClean;
        ingIdNum = null;
        skuClean = null;
    } else {
        if (!skuClean) {
            const err = new Error('articulo_sku requerido para ancla ARTICULO_SKU.');
            err.statusCode = 400;
            throw err;
        }
        anclaSlug = sanitizarSegmentoPath(skuClean);
        ingIdNum = null;
    }

    const fotoId = generarIdMediaBase('ib');
    const rutas = obtenerRutasArchivoBase(tipoNorm, anclaSlug, fotoId);
    const metaImg = await procesarYGuardarWebp(buffer, rutas.pubPath, rutas.origPath);

    const client = await db.connect();
    let anteriorUrls = [];
    let guardada;
    try {
        await client.query('BEGIN');

        let prevRes;
        if (tipoNorm === 'INGREDIENTE') {
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
        anteriorUrls = (prevRes.rows || []).map(r => r.url).filter(Boolean);

        const ins = await client.query(
            `INSERT INTO public.lamda_imagenes_base (
                tipo_ancla, ingrediente_id, clave_producto_base, articulo_sku,
                foto_id, url, url_original, width, height, bytes,
                origen_tipo, origen_foto_lote_id, titulo_referencia, activo
             ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,true)
             RETURNING *`,
            [
                tipoNorm,
                ingIdNum,
                claveBaseClean,
                skuClean,
                fotoId,
                rutas.publicUrl,
                rutas.origUrl,
                metaImg.width,
                metaImg.height,
                metaImg.bytes,
                String(origen_tipo || 'UPLOAD_LAMDA').slice(0, 24),
                origen_foto_lote_id ? Number(origen_foto_lote_id) : null,
                titulo_referencia ? String(titulo_referencia).slice(0, 160) : null
            ]
        );
        guardada = ins.rows[0];
        await client.query('COMMIT');
    } catch (err) {
        await client.query('ROLLBACK');
        borrarArchivoPorUrlPublicaSilencioso(rutas.publicUrl);
        throw err;
    } finally {
        client.release();
    }

    anteriorUrls.forEach(borrarArchivoPorUrlPublicaSilencioso);

    const listado = await listarProductosBaseConImagenes(db, {});
    const grupoAfectado = listado.productos_base.find(p =>
        (tipoNorm === 'INGREDIENTE' && Number(p.ingrediente_id) === ingIdNum) ||
        (tipoNorm === 'PRODUCTO_BASE' && p.clave_producto_base === claveBaseClean) ||
        (tipoNorm === 'ARTICULO_SKU' && p.presentaciones.some(pr => String(pr.sku_nodo).toUpperCase() === skuClean))
    );

    return {
        imagen: guardada,
        presentaciones_heredadas: grupoAfectado ? grupoAfectado.total_presentaciones : 1,
        presentaciones_en_nodos: grupoAfectado ? grupoAfectado.en_nodos_count : 0
    };
}

async function eliminarImagenBaseLamda(db, imagenId) {
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
    borrarArchivoPorUrlPublicaSilencioso(res.rows[0].url);
    return res.rows[0];
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
        borrarArchivoPorUrlPublicaSilencioso(prevUrl);
    }

    return {
        grupo_config: upsert.rows[0],
        foto: fotoObj
    };
}

module.exports = {
    obtenerMapaImagenesBaseActivas,
    resolverImagenBaseLamdaParaArticulo,
    listarProductosBaseConImagenes,
    guardarImagenBaseLamda,
    eliminarImagenBaseLamda,
    guardarFotoPropiaGrupoGestor
};
