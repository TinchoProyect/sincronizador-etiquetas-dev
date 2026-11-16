'use strict';

/**
 * Servicio Integral de Álbum de Fotos por Oferta del Nodo (`nodosFotosService.js`)
 * --------------------------------------------------------------------------------
 * - Persistencia desacoplada del árbol Git:
 *     * Laboratorio (`LAMDA_MODO_LABORATORIO === 'true'` o `DB_NAME === 'etiquetas_pruebas'`):
 *       `<cwd>/data/nodos-fotos/<nodo_id>/<oferta_id>/`
 *     * Producción (`LAMDA_MODO_LABORATORIO !== 'true'`):
 *       `process.env.NODOS_MEDIA_DIR || '/opt/lamda/nodos-fotos'` (por fuera de `/opt/lamda/sincronizador-etiquetas`)
 * - Conserva `<foto_id>_orig.webp` (base normalizada EXIF sin filtro) y `<foto_id>.webp` (versión publicada),
 *   permitiendo re-editar recorte, rotación 90° o prender/apagar el filtro sin pérdida generacional.
 * - Pipeline `sharp` adaptativo calibrado para envases transparentes, frutos secos, semillas y granolas.
 */

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const sharp = require('sharp');
const db = require('../config/database');

const MAX_FOTOS_POR_OFERTA = 6;
const MAX_ORIG_DIM = 1600;
const MAX_PUB_DIM = 1280;
const MAX_PREVIEW_DIM = 960;

function esModoLaboratorioFotos() {
    const flagLab = String(process.env.LAMDA_MODO_LABORATORIO || process.env.MODO_LABORATORIO || '').trim().toLowerCase();
    const dbName = String(process.env.DB_NAME || '').trim().toLowerCase();
    return flagLab === 'true' || flagLab === '1' || dbName === 'etiquetas_pruebas';
}

function obtenerDirectorioMediaNodos() {
    if (esModoLaboratorioFotos()) {
        if (process.env.NODOS_MEDIA_DIR_LAB) {
            return path.resolve(process.env.NODOS_MEDIA_DIR_LAB);
        }
        return path.join(process.cwd(), 'data', 'nodos-fotos');
    }
    if (process.env.NODOS_MEDIA_DIR) {
        return path.resolve(process.env.NODOS_MEDIA_DIR);
    }
    if (process.platform === 'win32') {
        return path.join(process.cwd(), 'data', 'nodos-fotos');
    }
    return '/opt/lamda/nodos-fotos';
}

function esFotoIdSeguro(fotoId) {
    return /^nf-[a-z0-9]{6,36}$/.test(String(fotoId || '').trim());
}

function generarFotoId() {
    const ts = Date.now().toString(36);
    const rnd = crypto.randomBytes(4).toString('hex');
    return `nf-${ts}${rnd}`.toLowerCase();
}

function obtenerCarpetaOfertaDisco(nodoId, ofertaId) {
    const nId = Number(nodoId);
    const oId = Number(ofertaId);
    if (!Number.isInteger(nId) || nId <= 0 || !Number.isInteger(oId) || oId <= 0) {
        const err = new Error('Identificadores de nodo u oferta inválidos para almacenamiento.');
        err.statusCode = 400;
        throw err;
    }
    return path.join(obtenerDirectorioMediaNodos(), String(nId), String(oId));
}

function obtenerRutasArchivoFoto(nodoId, ofertaId, fotoId) {
    const cleanId = String(fotoId || '').trim();
    if (!esFotoIdSeguro(cleanId)) {
        const err = new Error('Identificador de foto inválido.');
        err.statusCode = 400;
        throw err;
    }
    const dir = obtenerCarpetaOfertaDisco(nodoId, ofertaId);
    return {
        dir,
        pubPath: path.join(dir, `${cleanId}.webp`),
        origPath: path.join(dir, `${cleanId}_orig.webp`)
    };
}

function normalizarRotacion(valor) {
    const n = Number(valor || 0);
    if (!Number.isFinite(n)) return 0;
    const mod = ((Math.round(n / 90) * 90) % 360 + 360) % 360;
    return [0, 90, 180, 270].includes(mod) ? mod : 0;
}

function normalizarCrop(rawCrop) {
    if (!rawCrop) return null;
    let obj = rawCrop;
    if (typeof rawCrop === 'string') {
        const trimmed = rawCrop.trim();
        if (!trimmed || trimmed === 'null') return null;
        try {
            obj = JSON.parse(trimmed);
        } catch (_) {
            return null;
        }
    }
    if (typeof obj !== 'object' || obj === null) return null;

    let x = Number(obj.x);
    let y = Number(obj.y);
    let w = Number(obj.w);
    let h = Number(obj.h);
    if (![x, y, w, h].every(Number.isFinite)) return null;

    x = Math.max(0, Math.min(0.95, x));
    y = Math.max(0, Math.min(0.95, y));
    w = Math.max(0.05, Math.min(1 - x, w));
    h = Math.max(0.05, Math.min(1 - y, h));

    if (x <= 0.002 && y <= 0.002 && w >= 0.996 && h >= 0.996) {
        return null;
    }

    return {
        x: Number(x.toFixed(4)),
        y: Number(y.toFixed(4)),
        w: Number(w.toFixed(4)),
        h: Number(h.toFixed(4)),
        preset: obj.preset ? String(obj.preset).slice(0, 20) : undefined
    };
}

function parsearBooleanoForm(val, defaultVal = true) {
    if (val === undefined || val === null || val === '') return defaultVal;
    if (typeof val === 'boolean') return val;
    const s = String(val).trim().toLowerCase();
    if (['true', '1', 'yes', 'si', 'on'].includes(s)) return true;
    if (['false', '0', 'no', 'off'].includes(s)) return false;
    return defaultVal;
}

async function validarYGenerarBaseOrigBuffer(inputBuffer) {
    if (!Buffer.isBuffer(inputBuffer) || inputBuffer.length < 32) {
        const err = new Error('El archivo de imagen está vacío o es inválido.');
        err.statusCode = 400;
        throw err;
    }

    let meta;
    try {
        meta = await sharp(inputBuffer, { failOnError: false }).metadata();
    } catch (_) {
        meta = null;
    }
    if (!meta || !meta.width || !meta.height) {
        const err = new Error('Formato de imagen no reconocido. Usá fotos JPG, PNG o WebP.');
        err.statusCode = 400;
        throw err;
    }

    return sharp(inputBuffer, { failOnError: false })
        .rotate() // Auto-orientación EXIF limpia
        .resize(MAX_ORIG_DIM, MAX_ORIG_DIM, { fit: 'inside', withoutEnlargement: true })
        .webp({ quality: 92, effort: 4 })
        .toBuffer();
}

/**
 * Pipeline `sharp` de encuadre + Mejora Automática Adaptativa de Producto:
 * - No usa `.normalize()` ciego para no quemar reflejos del celofán.
 * - Analiza luminancia real (`sharp.stats()`): si la escena es oscura (`< 125`), levanta sombras con
 *   `.gamma(1.08)` y brillo proporcional (`1.05..1.10`).
 * - Realza color natural de frutos secos/semillas (`saturation: 1.12`), micro-contraste (`.linear(1.07, -5)`),
 *   neutraliza dominante fría LED si existe y aplica nitidez selectiva (`.sharpen(0.85, 0.8, 1.5)`).
 */
async function renderizarVarianteSharp(origWebpBuffer, opciones = {}) {
    const rotacion = normalizarRotacion(opciones.rotacion);
    const crop = normalizarCrop(opciones.crop);
    const aplicarFiltro = Boolean(opciones.aplicarFiltro);
    const maxDim = Number(opciones.maxDim) > 0 ? Number(opciones.maxDim) : MAX_PUB_DIM;
    const quality = Number(opciones.quality) > 0 ? Number(opciones.quality) : 82;

    // 1. Aplicar rotación manual (0 | 90 | 180 | 270) sobre la base ya orientada por EXIF
    let rotPipe = sharp(origWebpBuffer, { failOnError: false });
    if (rotacion > 0) {
        rotPipe = rotPipe.rotate(rotacion);
    }
    const rotObj = await rotPipe.png({ compressionLevel: 2 }).toBuffer({ resolveWithObject: true });
    let workingBuffer = rotObj.data;
    const rotW = Number(rotObj.info.width || 1);
    const rotH = Number(rotObj.info.height || 1);

    // 2. Aplicar recorte normalizado (crop: { x, y, w, h } en 0..1) y escalado hasta maxDim
    let framePipe = sharp(workingBuffer, { failOnError: false });
    if (crop) {
        const left = Math.max(0, Math.min(rotW - 16, Math.round(crop.x * rotW)));
        const top = Math.max(0, Math.min(rotH - 16, Math.round(crop.y * rotH)));
        const width = Math.max(16, Math.min(rotW - left, Math.round(crop.w * rotW)));
        const height = Math.max(16, Math.min(rotH - top, Math.round(crop.h * rotH)));
        framePipe = framePipe.extract({ left, top, width, height });
    }
    const framedBuffer = await framePipe
        .resize(maxDim, maxDim, { fit: 'inside', withoutEnlargement: true })
        .png({ compressionLevel: 2 })
        .toBuffer();

    // 3. Si no lleva filtro, exportar directamente en WebP optimizado
    if (!aplicarFiltro) {
        const outOrig = await sharp(framedBuffer, { failOnError: false })
            .webp({ quality, effort: 4, smartSubsample: true })
            .toBuffer({ resolveWithObject: true });
        return {
            buffer: outOrig.data,
            width: outOrig.info.width,
            height: outOrig.info.height,
            bytes: outOrig.info.size,
            luminancia_media: null
        };
    }

    // 4. Mejora Automática Adaptativa de Producto
    const stats = await sharp(framedBuffer, { failOnError: false }).stats();
    const rMean = Number(stats.channels?.[0]?.mean ?? 128);
    const gMean = Number(stats.channels?.[1]?.mean ?? 128);
    const bMean = Number(stats.channels?.[2]?.mean ?? 128);
    const lumMean = (0.2126 * rMean) + (0.7152 * gMean) + (0.0722 * bMean);

    let brightness = 1.00;
    let usarGamma = false;
    if (lumMean < 125) {
        usarGamma = true;
        const deficit = (125 - lumMean) / 125;
        brightness = Number(Math.min(1.10, Math.max(1.05, 1.05 + deficit * 0.07)).toFixed(3));
    } else if (lumMean < 158) {
        brightness = 1.025;
    }

    let enhPipe = sharp(framedBuffer, { failOnError: false });
    if (usarGamma) {
        enhPipe = enhPipe.gamma(1.08, 2.2);
    }
    enhPipe = enhPipe.modulate({
        brightness,
        saturation: 1.12
    });

    // Neutralización suave si hay dominante fría/azulada de tubo LED hogareño
    if (bMean > rMean * 1.06 && bMean > 85) {
        enhPipe = enhPipe.recomb([
            [1.02, 0.00, 0.00],
            [0.00, 1.00, 0.00],
            [0.00, 0.00, 0.97]
        ]);
    }

    const outEnh = await enhPipe
        .linear(1.07, -5)
        .sharpen({ sigma: 0.85, m1: 0.8, m2: 1.5 })
        .webp({ quality, effort: 4, smartSubsample: true })
        .toBuffer({ resolveWithObject: true });

    return {
        buffer: outEnh.data,
        width: outEnh.info.width,
        height: outEnh.info.height,
        bytes: outEnh.info.size,
        luminancia_media: Number(lumMean.toFixed(1))
    };
}

function normalizarArrayFotosBd(rawFotos) {
    if (!Array.isArray(rawFotos)) return [];
    return rawFotos
        .filter(f => f && typeof f === 'object' && esFotoIdSeguro(f.id) && f.url)
        .slice()
        .sort((a, b) => (Number(a.orden || 0) - Number(b.orden || 0)))
        .map((f, idx) => ({
            id: String(f.id),
            url: String(f.url),
            width: Number(f.width || 0) || null,
            height: Number(f.height || 0) || null,
            bytes: Number(f.bytes || 0) || null,
            orden: idx + 1,
            filtro_aplicado: f.filtro_aplicado !== false,
            rotacion: normalizarRotacion(f.rotacion),
            crop: normalizarCrop(f.crop),
            created_at: f.created_at || new Date().toISOString(),
            updated_at: f.updated_at || new Date().toISOString()
        }));
}

function borrarArchivosFotoSilencioso(nodoId, ofertaId, fotoId) {
    try {
        if (!esFotoIdSeguro(fotoId)) return;
        const { dir, pubPath, origPath } = obtenerRutasArchivoFoto(nodoId, ofertaId, fotoId);
        if (fs.existsSync(pubPath)) fs.unlinkSync(pubPath);
        if (fs.existsSync(origPath)) fs.unlinkSync(origPath);
        if (fs.existsSync(dir) && fs.readdirSync(dir).length === 0) {
            fs.rmdirSync(dir);
        }
    } catch (_) {}
}

async function obtenerOfertaYValidarNodo(runner, ofertaId, nodoAuthId = null, forUpdate = false) {
    const oId = Number(ofertaId);
    if (!Number.isInteger(oId) || oId <= 0) {
        const err = new Error('ID de oferta inválido.');
        err.statusCode = 400;
        throw err;
    }
    const lockSql = forUpdate ? ' FOR UPDATE OF nog' : '';
    const res = await runner.query(
        `SELECT nog.id, nog.nodo_id, COALESCE(nog.fotos_vidriera, '[]'::jsonb) AS fotos_vidriera,
                nm.activo AS nodo_activo
         FROM public.nodos_ofertas_gestor nog
         JOIN public.nodos_maestro nm ON nm.id = nog.nodo_id
         WHERE nog.id = $1${lockSql}`,
        [oId]
    );
    if (res.rows.length === 0) {
        const err = new Error('Oferta de gestor no encontrada.');
        err.statusCode = 404;
        throw err;
    }
    const row = res.rows[0];
    if (nodoAuthId !== null && nodoAuthId !== undefined && Number(row.nodo_id) !== Number(nodoAuthId)) {
        const err = new Error('No autorizado: la oferta pertenece a otro Nodo.');
        err.statusCode = 403;
        throw err;
    }
    if (row.nodo_activo === false) {
        const err = new Error('Este Nodo se encuentra archivado.');
        err.statusCode = 403;
        throw err;
    }
    return row;
}

/**
 * 1) Vista previa en memoria ("Original vs. Mejorada") sin escribir en disco ni BD.
 */
async function previsualizarFotoOferta({ ofertaId, nodoAuthId = null, fileBuffer = null, fotoId = null, rotacion = 0, crop = null, previewAmbas = true, incluirBaseEncuadre = false }) {
    const ofertaRow = await obtenerOfertaYValidarNodo(db, ofertaId, nodoAuthId, false);
    const nodoId = Number(ofertaRow.nodo_id);

    let origBaseBuffer = null;
    if (Buffer.isBuffer(fileBuffer) && fileBuffer.length > 0) {
        origBaseBuffer = await validarYGenerarBaseOrigBuffer(fileBuffer);
    } else if (fotoId) {
        const fotos = normalizarArrayFotosBd(ofertaRow.fotos_vidriera);
        const existeEnOferta = fotos.find(f => f.id === String(fotoId).trim());
        if (!existeEnOferta) {
            const err = new Error('La foto solicitada no pertenece a esta oferta.');
            err.statusCode = 404;
            throw err;
        }
        const { origPath, pubPath } = obtenerRutasArchivoFoto(nodoId, ofertaRow.id, existeEnOferta.id);
        if (fs.existsSync(origPath)) {
            origBaseBuffer = fs.readFileSync(origPath);
        } else if (fs.existsSync(pubPath)) {
            origBaseBuffer = fs.readFileSync(pubPath);
        } else {
            const err = new Error('No se encontró el archivo base de la foto en el servidor.');
            err.statusCode = 404;
            throw err;
        }
    } else {
        const err = new Error('Debés enviar una imagen o indicar un foto_id existente para previsualizar.');
        err.statusCode = 400;
        throw err;
    }

    const promesas = [
        renderizarVarianteSharp(origBaseBuffer, {
            rotacion,
            crop,
            aplicarFiltro: true,
            maxDim: MAX_PREVIEW_DIM,
            quality: 78
        }),
        previewAmbas !== false
            ? renderizarVarianteSharp(origBaseBuffer, {
                rotacion,
                crop,
                aplicarFiltro: false,
                maxDim: MAX_PREVIEW_DIM,
                quality: 78
            })
            : Promise.resolve(null),
        incluirBaseEncuadre
            ? renderizarVarianteSharp(origBaseBuffer, {
                rotacion: 0,
                crop: null,
                aplicarFiltro: false,
                maxDim: MAX_PREVIEW_DIM,
                quality: 80
            })
            : Promise.resolve(null)
    ];

    const [varMejorada, varOriginal, varBaseEncuadre] = await Promise.all(promesas);

    return {
        mejorada_data_url: `data:image/webp;base64,${varMejorada.buffer.toString('base64')}`,
        original_data_url: varOriginal ? `data:image/webp;base64,${varOriginal.buffer.toString('base64')}` : null,
        base_encuadre_data_url: varBaseEncuadre ? `data:image/webp;base64,${varBaseEncuadre.buffer.toString('base64')}` : null,
        width: varMejorada.width,
        height: varMejorada.height,
        bytes_mejorada: varMejorada.bytes,
        bytes_original: varOriginal ? varOriginal.bytes : null,
        luminancia_media: varMejorada.luminancia_media
    };
}

/**
 * 2) Agregar nueva foto al álbum de una oferta (máx. 6 fotos).
 */
async function agregarFotoOferta({ ofertaId, nodoAuthId = null, fileBuffer, rotacion = 0, crop = null, aplicarFiltro = true }) {
    const origBaseBuffer = await validarYGenerarBaseOrigBuffer(fileBuffer);
    const rotNorm = normalizarRotacion(rotacion);
    const cropNorm = normalizarCrop(crop);
    const usarFiltro = parsearBooleanoForm(aplicarFiltro, true);

    const publicada = await renderizarVarianteSharp(origBaseBuffer, {
        rotacion: rotNorm,
        crop: cropNorm,
        aplicarFiltro: usarFiltro,
        maxDim: MAX_PUB_DIM,
        quality: 82
    });

    const client = await db.connect();
    let rutasEscritas = null;
    try {
        await client.query('BEGIN');
        const ofertaRow = await obtenerOfertaYValidarNodo(client, ofertaId, nodoAuthId, true);
        const nodoId = Number(ofertaRow.nodo_id);
        const fotosActuales = normalizarArrayFotosBd(ofertaRow.fotos_vidriera);

        if (fotosActuales.length >= MAX_FOTOS_POR_OFERTA) {
            const err = new Error(`El álbum ya alcanzó el máximo de ${MAX_FOTOS_POR_OFERTA} fotos por producto.`);
            err.statusCode = 400;
            throw err;
        }

        const fotoId = generarFotoId();
        const ts = Date.now();
        const { dir, pubPath, origPath } = obtenerRutasArchivoFoto(nodoId, ofertaRow.id, fotoId);
        fs.mkdirSync(dir, { recursive: true });
        fs.writeFileSync(origPath, origBaseBuffer);
        fs.writeFileSync(pubPath, publicada.buffer);
        rutasEscritas = { nodoId, ofertaId: ofertaRow.id, fotoId };

        const nowIso = new Date(ts).toISOString();
        const nuevaFoto = {
            id: fotoId,
            url: `/media/nodos/${nodoId}/${ofertaRow.id}/${fotoId}.webp?v=${ts}`,
            width: publicada.width,
            height: publicada.height,
            bytes: publicada.bytes,
            orden: fotosActuales.length + 1,
            filtro_aplicado: usarFiltro,
            rotacion: rotNorm,
            crop: cropNorm,
            created_at: nowIso,
            updated_at: nowIso
        };

        const nuevoAlbum = [...fotosActuales, nuevaFoto].map((f, idx) => ({ ...f, orden: idx + 1 }));

        await client.query(
            `UPDATE public.nodos_ofertas_gestor
             SET fotos_vidriera = $1::jsonb,
                 updated_at = NOW()
             WHERE id = $2`,
            [JSON.stringify(nuevoAlbum), ofertaRow.id]
        );

        await client.query('COMMIT');
        return { foto: nuevaFoto, fotos_vidriera: nuevoAlbum };
    } catch (err) {
        await client.query('ROLLBACK').catch(() => {});
        if (rutasEscritas) {
            borrarArchivosFotoSilencioso(rutasEscritas.nodoId, rutasEscritas.ofertaId, rutasEscritas.fotoId);
        }
        throw err;
    } finally {
        client.release();
    }
}

/**
 * 3) Re-editar una foto existente (sobre su `_orig.webp`) o reemplazarla por un archivo nuevo.
 */
async function editarOReemplazarFotoOferta({ ofertaId, fotoId, nodoAuthId = null, fileBuffer = null, rotacion = undefined, crop = undefined, aplicarFiltro = undefined }) {
    const targetId = String(fotoId || '').trim();
    if (!esFotoIdSeguro(targetId)) {
        const err = new Error('Identificador de foto inválido.');
        err.statusCode = 400;
        throw err;
    }

    const esReemplazoArchivo = Buffer.isBuffer(fileBuffer) && fileBuffer.length > 0;
    const nuevoOrigBuffer = esReemplazoArchivo ? await validarYGenerarBaseOrigBuffer(fileBuffer) : null;

    const client = await db.connect();
    let nuevaRutaCreada = null;
    try {
        await client.query('BEGIN');
        const ofertaRow = await obtenerOfertaYValidarNodo(client, ofertaId, nodoAuthId, true);
        const nodoId = Number(ofertaRow.nodo_id);
        const fotosActuales = normalizarArrayFotosBd(ofertaRow.fotos_vidriera);
        const idx = fotosActuales.findIndex(f => f.id === targetId);

        if (idx === -1) {
            const err = new Error('La foto indicada no existe en el álbum de esta oferta.');
            err.statusCode = 404;
            throw err;
        }

        const fotoPrev = fotosActuales[idx];
        const rotEfectiva = rotacion !== undefined
            ? normalizarRotacion(rotacion)
            : (esReemplazoArchivo ? 0 : normalizarRotacion(fotoPrev.rotacion));
        const cropEfectivo = crop !== undefined
            ? normalizarCrop(crop)
            : (esReemplazoArchivo ? null : normalizarCrop(fotoPrev.crop));
        const filtroEfectivo = aplicarFiltro !== undefined
            ? parsearBooleanoForm(aplicarFiltro, true)
            : Boolean(fotoPrev.filtro_aplicado);

        let baseParaRender = nuevoOrigBuffer;
        if (!baseParaRender) {
            const { origPath, pubPath } = obtenerRutasArchivoFoto(nodoId, ofertaRow.id, targetId);
            if (fs.existsSync(origPath)) {
                baseParaRender = fs.readFileSync(origPath);
            } else if (fs.existsSync(pubPath)) {
                baseParaRender = fs.readFileSync(pubPath);
            } else {
                const err = new Error('No se encontró la imagen original en disco para re-editarla.');
                err.statusCode = 404;
                throw err;
            }
        }

        const publicada = await renderizarVarianteSharp(baseParaRender, {
            rotacion: rotEfectiva,
            crop: cropEfectivo,
            aplicarFiltro: filtroEfectivo,
            maxDim: MAX_PUB_DIM,
            quality: 82
        });

        const ts = Date.now();
        const nowIso = new Date(ts).toISOString();
        let fotoActualizada;

        if (esReemplazoArchivo) {
            const nuevoId = generarFotoId();
            const { dir, pubPath, origPath } = obtenerRutasArchivoFoto(nodoId, ofertaRow.id, nuevoId);
            fs.mkdirSync(dir, { recursive: true });
            fs.writeFileSync(origPath, nuevoOrigBuffer);
            fs.writeFileSync(pubPath, publicada.buffer);
            nuevaRutaCreada = { nodoId, ofertaId: ofertaRow.id, fotoId: nuevoId };

            fotoActualizada = {
                id: nuevoId,
                url: `/media/nodos/${nodoId}/${ofertaRow.id}/${nuevoId}.webp?v=${ts}`,
                width: publicada.width,
                height: publicada.height,
                bytes: publicada.bytes,
                orden: idx + 1,
                filtro_aplicado: filtroEfectivo,
                rotacion: rotEfectiva,
                crop: cropEfectivo,
                created_at: fotoPrev.created_at || nowIso,
                updated_at: nowIso
            };
        } else {
            const { dir, pubPath, origPath } = obtenerRutasArchivoFoto(nodoId, ofertaRow.id, targetId);
            fs.mkdirSync(dir, { recursive: true });
            if (!fs.existsSync(origPath)) {
                fs.writeFileSync(origPath, baseParaRender);
            }
            fs.writeFileSync(pubPath, publicada.buffer);

            fotoActualizada = {
                ...fotoPrev,
                url: `/media/nodos/${nodoId}/${ofertaRow.id}/${targetId}.webp?v=${ts}`,
                width: publicada.width,
                height: publicada.height,
                bytes: publicada.bytes,
                orden: idx + 1,
                filtro_aplicado: filtroEfectivo,
                rotacion: rotEfectiva,
                crop: cropEfectivo,
                updated_at: nowIso
            };
        }

        const nuevoAlbum = fotosActuales.slice();
        nuevoAlbum[idx] = fotoActualizada;
        nuevoAlbum.forEach((f, i) => { f.orden = i + 1; });

        await client.query(
            `UPDATE public.nodos_ofertas_gestor
             SET fotos_vidriera = $1::jsonb,
                 updated_at = NOW()
             WHERE id = $2`,
            [JSON.stringify(nuevoAlbum), ofertaRow.id]
        );

        await client.query('COMMIT');

        if (esReemplazoArchivo) {
            borrarArchivosFotoSilencioso(nodoId, ofertaRow.id, targetId);
        }

        return { foto: fotoActualizada, fotos_vidriera: nuevoAlbum, reemplazada: esReemplazoArchivo };
    } catch (err) {
        await client.query('ROLLBACK').catch(() => {});
        if (nuevaRutaCreada) {
            borrarArchivosFotoSilencioso(nuevaRutaCreada.nodoId, nuevaRutaCreada.ofertaId, nuevaRutaCreada.fotoId);
        }
        throw err;
    } finally {
        client.release();
    }
}

/**
 * 4) Actualizar el orden del álbum y cuál queda como portada (#1).
 */
async function reordenarFotosOferta({ ofertaId, nodoAuthId = null, ordenIds = null, portadaId = null }) {
    const client = await db.connect();
    try {
        await client.query('BEGIN');
        const ofertaRow = await obtenerOfertaYValidarNodo(client, ofertaId, nodoAuthId, true);
        const fotosActuales = normalizarArrayFotosBd(ofertaRow.fotos_vidriera);
        if (fotosActuales.length <= 1) {
            await client.query('COMMIT');
            return { fotos_vidriera: fotosActuales };
        }

        const mapa = new Map(fotosActuales.map(f => [f.id, f]));
        let nuevoAlbum = [];

        if (portadaId && mapa.has(String(portadaId).trim())) {
            const pId = String(portadaId).trim();
            nuevoAlbum.push(mapa.get(pId));
            for (const f of fotosActuales) {
                if (f.id !== pId) nuevoAlbum.push(f);
            }
        } else if (Array.isArray(ordenIds) && ordenIds.length > 0) {
            const usados = new Set();
            for (const rawId of ordenIds) {
                const clean = String(rawId || '').trim();
                if (mapa.has(clean) && !usados.has(clean)) {
                    nuevoAlbum.push(mapa.get(clean));
                    usados.add(clean);
                }
            }
            for (const f of fotosActuales) {
                if (!usados.has(f.id)) {
                    nuevoAlbum.push(f);
                }
            }
        } else {
            const err = new Error('Debés indicar orden_ids o portada_id para reordenar el álbum.');
            err.statusCode = 400;
            throw err;
        }

        nuevoAlbum = nuevoAlbum.map((f, idx) => ({ ...f, orden: idx + 1 }));

        await client.query(
            `UPDATE public.nodos_ofertas_gestor
             SET fotos_vidriera = $1::jsonb,
                 updated_at = NOW()
             WHERE id = $2`,
            [JSON.stringify(nuevoAlbum), ofertaRow.id]
        );
        await client.query('COMMIT');
        return { fotos_vidriera: nuevoAlbum };
    } catch (err) {
        await client.query('ROLLBACK').catch(() => {});
        throw err;
    } finally {
        client.release();
    }
}

/**
 * 5) Eliminar una foto puntual del JSONB y borrar físicamente `<foto_id>.webp` y `<foto_id>_orig.webp`.
 */
async function eliminarFotoOferta({ ofertaId, fotoId, nodoAuthId = null }) {
    const targetId = String(fotoId || '').trim();
    if (!esFotoIdSeguro(targetId)) {
        const err = new Error('Identificador de foto inválido.');
        err.statusCode = 400;
        throw err;
    }

    const client = await db.connect();
    try {
        await client.query('BEGIN');
        const ofertaRow = await obtenerOfertaYValidarNodo(client, ofertaId, nodoAuthId, true);
        const nodoId = Number(ofertaRow.nodo_id);
        const fotosActuales = normalizarArrayFotosBd(ofertaRow.fotos_vidriera);
        const existe = fotosActuales.some(f => f.id === targetId);
        if (!existe) {
            const err = new Error('La foto ya no existe en el álbum.');
            err.statusCode = 404;
            throw err;
        }

        const nuevoAlbum = fotosActuales
            .filter(f => f.id !== targetId)
            .map((f, idx) => ({ ...f, orden: idx + 1 }));

        await client.query(
            `UPDATE public.nodos_ofertas_gestor
             SET fotos_vidriera = $1::jsonb,
                 updated_at = NOW()
             WHERE id = $2`,
            [JSON.stringify(nuevoAlbum), ofertaRow.id]
        );
        await client.query('COMMIT');

        borrarArchivosFotoSilencioso(nodoId, ofertaRow.id, targetId);
        return { eliminada_id: targetId, fotos_vidriera: nuevoAlbum };
    } catch (err) {
        await client.query('ROLLBACK').catch(() => {});
        throw err;
    } finally {
        client.release();
    }
}

/**
 * 6) Vaciar por completo el álbum de una oferta y limpiar todos sus archivos en disco.
 */
async function vaciarAlbumOferta({ ofertaId, nodoAuthId = null }) {
    const client = await db.connect();
    try {
        await client.query('BEGIN');
        const ofertaRow = await obtenerOfertaYValidarNodo(client, ofertaId, nodoAuthId, true);
        const nodoId = Number(ofertaRow.nodo_id);
        const fotosPrevias = normalizarArrayFotosBd(ofertaRow.fotos_vidriera);

        await client.query(
            `UPDATE public.nodos_ofertas_gestor
             SET fotos_vidriera = '[]'::jsonb,
                 updated_at = NOW()
             WHERE id = $1`,
            [ofertaRow.id]
        );
        await client.query('COMMIT');

        try {
            const dir = obtenerCarpetaOfertaDisco(nodoId, ofertaRow.id);
            if (fs.existsSync(dir)) {
                for (const entry of fs.readdirSync(dir)) {
                    if (entry.endsWith('.webp')) {
                        try { fs.unlinkSync(path.join(dir, entry)); } catch (_) {}
                    }
                }
                if (fs.readdirSync(dir).length === 0) {
                    try { fs.rmdirSync(dir); } catch (_) {}
                }
            }
        } catch (_) {}

        return { eliminadas: fotosPrevias.length, fotos_vidriera: [] };
    } catch (err) {
        await client.query('ROLLBACK').catch(() => {});
        throw err;
    } finally {
        client.release();
    }
}

module.exports = {
    MAX_FOTOS_POR_OFERTA,
    esModoLaboratorioFotos,
    obtenerDirectorioMediaNodos,
    esFotoIdSeguro,
    previsualizarFotoOferta,
    agregarFotoOferta,
    editarOReemplazarFotoOferta,
    reordenarFotosOferta,
    eliminarFotoOferta,
    vaciarAlbumOferta
};
