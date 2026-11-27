'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const axios = require('axios');
const sharp = require('sharp');
const { obtenerDirectorioMediaNodos } = require('./nodosFotosService');
const jh = require('../../shared/jerarquiaBunkerHelper');
const iaMonitor = require('../../services/iaCreditoMonitorService');
const {
    construirCatalogoIngredientesComerciales,
    obtenerDesgloseIngredientesParaItem
} = require('./desgloseIngredientesComercialService');

const MAX_BASE_DIM = 1080;
const PREVIEW_TTL_MS = 15 * 60 * 1000;
const MAX_PREVIEWS_CACHE = 25;

const FAMILIAS_INTERNAS_EXCLUIDAS_NORM = new Set([
    'produccion',
    'insumos',
    'para clasificar'
]);

const ESTILOS_IA_IMAGEN_BASE = {
    libre: {
        id: 'libre',
        label: 'Prompt libre',
        emoji: '✍️',
        es_libre: true,
        descripcion_prompt: ''
    },
    cuenco_neutro: {
        id: 'cuenco_neutro',
        label: 'Cuenco cerámico 45°',
        emoji: '🥣',
        es_libre: false,
        descripcion_prompt: 'Fotografía gastronómica profesional en plano a 45 grados del ingrediente real servido en un cuenco cerámico artesanal minimalista de tono claro, apoyado sobre una superficie neutra cálida mate con luz natural suave de estudio.'
    },
    granel_cenital: {
        id: 'granel_cenital',
        label: 'A granel cenital',
        emoji: '🪨',
        es_libre: false,
        descripcion_prompt: 'Fotografía gastronómica profesional en plano cenital (vista superior 90 grados) del ingrediente real a granel dispuesto de forma orgánica y prolija sobre piedra natural clara o madera clara suave, con iluminación natural difusa.'
    },
    macro_editorial: {
        id: 'macro_editorial',
        label: 'Macro cinematográfico',
        emoji: '🔍',
        es_libre: false,
        descripcion_prompt: 'Fotografía macro gastronómica de ultra detalle y enfoque selectivo (shallow depth of field) del producto real, resaltando vetas, crocancia, textura natural e iluminación lateral cinematográfica suave.'
    },
    mesa_cinematografica: {
        id: 'mesa_cinematografica',
        label: 'Mesa editorial',
        emoji: '🎬',
        es_libre: false,
        descripcion_prompt: 'Fotografía editorial gastronómica con el producto real esparcido de forma natural y armónica directamente sobre una mesa de madera cálida o piedra mate (sin cuenco ni recipiente), luz lateral cinematográfica suave.'
    },
    producto_elaborado: {
        id: 'producto_elaborado',
        label: 'Producto elaborado',
        emoji: '🍫',
        es_libre: false,
        descripcion_prompt: 'Fotografía gastronómica comercial de estudio del producto elaborado real (por ejemplo barritas, bocados o granola) presentado entero y con un corte o detalle que muestre su interior, ingredientes visibles y textura real sobre superficie limpia (sin cuenco), luz lateral definida.'
    },
    fondo_blanco: {
        id: 'fondo_blanco',
        label: 'Fondo blanco limpio',
        emoji: '⬜',
        es_libre: false,
        descripcion_prompt: 'Fotografía profesional de catálogo e-commerce del ingrediente real agrupado en una pequeña pila limpia sobre fondo blanco puro minimalista, iluminación suave de estudio y sombra natural muy sutil.'
    }
};

const REGLA_SIN_ENVASES_TXT = 'Regla estricta: SIN envases, SIN bolsas plásticas, SIN frascos, SIN cajas, SIN etiquetas, SIN marcas comerciales, SIN logos, SIN texto sobreimpreso.';
const INSTRUCCION_REFERENCIA_VISUAL_TXT = 'REFERENCIA VISUAL REAL ADJUNTA (PRIORIDAD ABSOLUTA): Usá las fotografías reales adjuntas como verdad física de morfología, color, proporción e ingredientes visibles reales, por encima de cualquier arquetipo genérico. Eliminá por completo el fondo casero y la iluminación amateur, conservando únicamente los ingredientes presentes en las fotos de referencia y la receta; NO agregues frutos secos, semillas ni frutas ajenas.';

const IDS_PREMEZCLAS_INTERMEDIAS_FALLBACK_IA = new Set([109, 132, 134, 135, 136, 140]);
const SKUS_PREMEZCLAS_INTERMEDIAS_FALLBACK_IA = new Set(['MPB', 'MPGDSX7', 'MPGDFX6,9']);

async function obtenerContextoPremezclasIntermediasIA(db) {
    if (!db || typeof db.query !== 'function') {
        return {
            ids: IDS_PREMEZCLAS_INTERMEDIAS_FALLBACK_IA,
            skus: SKUS_PREMEZCLAS_INTERMEDIAS_FALLBACK_IA
        };
    }
    try {
        const res = await db.query(`
            SELECT id, articulo_vinculado_numero
            FROM public.ingredientes
            WHERE COALESCE(rol_ingrediente, 'MATERIA_PRIMA') = 'FORMULA_INTERNA'
               OR id IN (
                   SELECT (elem->>'ingrediente_id')::int
                   FROM public.articulos_produccion_externa_relacion aper,
                        LATERAL jsonb_array_elements(COALESCE(aper.insumos_fase_externa_json, '[]'::jsonb)) elem
                   WHERE elem->>'ingrediente_id' ~ '^[0-9]+$'
               )
        `);
        const upRes = await db.query(`
            SELECT DISTINCT UPPER(BTRIM(articulo_premezcla_codigo)) AS sku_pre
            FROM public.articulos_produccion_externa_relacion
            WHERE articulo_premezcla_codigo IS NOT NULL AND BTRIM(articulo_premezcla_codigo) <> ''
        `);
        const ids = new Set(res.rows.map(r => Number(r.id)).filter(Boolean));
        const skus = new Set(upRes.rows.map(r => String(r.sku_pre || '').toUpperCase()).filter(Boolean));
        return {
            ids: ids.size > 0 ? ids : IDS_PREMEZCLAS_INTERMEDIAS_FALLBACK_IA,
            skus: skus.size > 0 ? skus : SKUS_PREMEZCLAS_INTERMEDIAS_FALLBACK_IA
        };
    } catch (_) {
        return {
            ids: IDS_PREMEZCLAS_INTERMEDIAS_FALLBACK_IA,
            skus: SKUS_PREMEZCLAS_INTERMEDIAS_FALLBACK_IA
        };
    }
}

const DESCRIPTORES_MORFOLOGICOS_SOLIDOS_IA = [
    { match: (n) => /^avena$/.test(n) || /\bavena\b/.test(n), desc: 'copos de avena arrollada tostados dorados en clusters crujientes' },
    { match: (n) => /^nueces$|\bnuez$/.test(n), desc: 'trozos y mitades arrugadas de nuez mariposa beige claro' },
    { match: (n) => /\bnuez pecan\b|\bpecan\b/.test(n), desc: 'mitades alargadas de nuez pecán con surcos marrones' },
    { match: (n) => /\balmendr/.test(n), desc: 'almendras enteras ovaladas con piel marrón acanelada' },
    { match: (n) => /\bcastana|\bcaju\b/.test(n), desc: 'castañas de cajú curvadas color marfil' },
    { match: (n) => /\bavellan/.test(n), desc: 'avellanas redondas tostadas' },
    { match: (n) => /^mani$|\bmani\b/.test(n), desc: 'granos ovalados pálidos de maní pelado sin piel' },
    { match: (n) => /\bgirasol\b/.test(n), desc: 'pequeñas semillas peladas de girasol gris-beige' },
    { match: (n) => /\bzapallo\b|\bcalabaza\b/.test(n), desc: 'semillas planas verde oscuro de zapallo' },
    { match: (n) => /\bcoco\b/.test(n) && !/\baceite/.test(n), desc: 'láminas finas blancas de coco en escamas' },
    { match: (n) => /\barandan/.test(n), desc: 'arándanos rojos deshidratados color rubí' },
    { match: (n) => /pasas? de uva/.test(n) && /\brubia/.test(n), desc: 'pasas de uva rubias doradas ámbar' },
    { match: (n) => /pasas? de uva/.test(n) && !/\brubia/.test(n), desc: 'pasas de uva oscuras/negras arrugadas' },
    { match: (n) => /\bbanana\b/.test(n), desc: 'rodajas finas crujientes de banana deshidratada amarillo claro' },
    { match: (n) => /\bmaiz frito\b/.test(n), desc: 'granos dorados crujientes de maíz frito salado' },
    { match: (n) => /\bpapaya\b/.test(n), desc: 'cubos translúcidos naranja-rojizos de papaya deshidratada' },
    { match: (n) => /\bkiwi\b/.test(n), desc: 'trozos verdes translúcidos de kiwi deshidratado' },
    { match: (n) => /\bnaranja\b/.test(n), desc: 'tiras y trozos cítricos anaranjados de naranja deshidratada' },
    { match: (n) => /\banana\b/.test(n), desc: 'trozos amarillos dorados de ananá deshidratado' }
];

function esLiganteNoSolidoIA(ingNorm) {
    return /^miel$/.test(ingNorm) || /^aceite de coco$/.test(ingNorm) || /\baceite\b/.test(ingNorm);
}

function obtenerDescriptorMorfologicoIngrediente(nomOriginal, ingNorm) {
    for (const regla of DESCRIPTORES_MORFOLOGICOS_SOLIDOS_IA) {
        if (regla.match(ingNorm)) return regla.desc;
    }
    return String(nomOriginal || '').trim().toLowerCase();
}

function construirExclusionesQuirurgicasIA(normas = []) {
    const has = (rx) => normas.some(n => rx.test(n));
    const hasAlmendras = has(/\balmendr/);
    const hasAvellanas = has(/\bavellan/);
    const hasNueces = has(/\bnuez\b|\bnueces\b/);
    const hasCaju = has(/\bcastana|\bcaju\b/);
    const hasMani = has(/\bmani\b/);
    const hasAvena = has(/\bavena\b/);
    const hasGirasol = has(/\bgirasol\b/);
    const hasZapallo = has(/\bzapallo\b|\bcalabaza\b/);
    const hasPasasOscuras = normas.some(n => /pasas? de uva/.test(n) && !/\brubia/.test(n));
    const hasPasasRubias = normas.some(n => /pasas? de uva/.test(n) && /\brubia/.test(n));
    const hasArandanos = has(/\barandan|\bfrutos rojos/);
    const hasFrutaTropical = has(/\bbanana\b|\bpapaya\b|\bkiwi\b|\banana\b|\bnaranja\b/);
    const hasChocolate = has(/\bchocolate|\bcacao\b/);

    const exclusiones = [];

    if (!hasAlmendras && !hasAvellanas) {
        exclusiones.push('ausencia total de frutos secos ovalados o esféricos con piel marrón lisa (cero almendras enteras o fileteadas, cero avellanas)');
    } else if (!hasAlmendras) {
        exclusiones.push('cero almendras ovaladas o fileteadas');
    }

    if (!hasPasasOscuras && !hasPasasRubias && !hasArandanos && !hasFrutaTropical) {
        exclusiones.push('ausencia total de pasas de uva, arándanos y frutas deshidratadas o confitadas');
    } else if (hasPasasRubias && !hasPasasOscuras && !hasArandanos) {
        exclusiones.push('todas las pasas visibles son rubias doradas ámbar (cero pasas negras oscuras, cero arándanos rojos)');
    } else if (hasArandanos && !hasPasasOscuras && !hasPasasRubias) {
        exclusiones.push('sin pasas de uva negras ni rubias');
    }

    if (!hasMani) {
        exclusiones.push('sin granos pálidos de maní');
    } else if (!hasNueces) {
        exclusiones.push('sin trozos de nuez mariposa');
    }

    if (hasAvena && hasGirasol && !hasZapallo) {
        exclusiones.push('solo pequeñas semillas gris-beige de girasol (cero semillas planas verdes de zapallo)');
    } else if (hasAvena && !hasCaju && !hasAlmendras) {
        exclusiones.push('sin castañas de cajú curvadas');
    }

    if (hasAvena && !hasChocolate && exclusiones.length < 4) {
        exclusiones.push('sin chips ni trozos de chocolate');
    }

    return exclusiones.slice(0, 4);
}

const CATALOGO_EXCLUSION_ANTI_ALUCINACION_IA = [
    { label: 'almendras', check: (ings) => ings.some(n => /\balmendr/.test(n)) },
    { label: 'nueces', check: (ings) => ings.some(n => /\bnuez\b|\bnueces\b/.test(n)) },
    { label: 'castañas de cajú', check: (ings) => ings.some(n => /\bcastana|\bcaju\b/.test(n)) },
    { label: 'avellanas', check: (ings) => ings.some(n => /\bavellan/.test(n)) },
    { label: 'maní', check: (ings) => ings.some(n => /\bmani\b/.test(n)) },
    { label: 'pistachos', check: (ings) => ings.some(n => /\bpistach/.test(n)) },
    {
        label: 'pasas de uva negras/oscuras',
        check: (ings) => ings.some(n => /pasas? de uva/.test(n) && !/\brubia/.test(n))
    },
    {
        label: 'pasas de uva rubias',
        check: (ings) => ings.some(n => (/pasas? de uva/.test(n) && /\brubia/.test(n)) || /^pasas? de uva$/.test(n))
    },
    { label: 'arándanos rojos / frutos rojos', check: (ings) => ings.some(n => /\barandan|\bframbuesa|\bmora\b|\bfresa|\bfrutilla/.test(n)) },
    { label: 'chips o trozos de chocolate', check: (ings) => ings.some(n => /\bchocolate|\bcacao\b/.test(n)) },
    {
        label: 'coco en escamas / rallado',
        check: (ings) => ings.some(n => /\bcoco\b/.test(n) && !/\baceite de coco\b/.test(n))
    },
    { label: 'chips de banana', check: (ings) => ings.some(n => /\bbanana\b/.test(n)) },
    { label: 'semillas de zapallo (verdes)', check: (ings) => ings.some(n => /\bzapallo\b|\bcalabaza\b/.test(n)) },
    { label: 'semillas de girasol', check: (ings) => ings.some(n => /\bgirasol\b/.test(n)) },
    { label: 'semillas de chía / sésamo / lino', check: (ings) => ings.some(n => /\bchia\b|\bsesamo\b|\blino\b/.test(n)) },
    { label: 'papaya / kiwi / ananá confitado', check: (ings) => ings.some(n => /\bpapaya\b|\bkiwi\b|\banana\b/.test(n)) }
];

function calcularFidelidadIngredientes(ingredientesRealesRaw = []) {
    const vistos = new Set();
    const reales = [];
    for (const raw of (ingredientesRealesRaw || [])) {
        const nom = String(typeof raw === 'string' ? raw : (raw?.nombre_comercial || raw?.nombre || '')).trim();
        if (!nom) continue;
        const n = jh.normalizarClaveTexto(nom);
        if (!n || /\b(bolsa|caja|etiqueta|envase|flowpack|carton|tarro|pote|frasco)\b/.test(n)) continue;
        if (vistos.has(n)) continue;
        vistos.add(n);
        reales.push(nom);
    }
    if (reales.length < 2) {
        return {
            tiene_receta: false,
            ingredientes_reales: [],
            ingredientes_prohibidos: [],
            firma_receta: ''
        };
    }
    const normas = reales.map(r => jh.normalizarClaveTexto(r));
    const prohibidos = [];
    for (const cand of CATALOGO_EXCLUSION_ANTI_ALUCINACION_IA) {
        if (!cand.check(normas)) {
            prohibidos.push(cand.label);
        }
    }
    const firma_receta = [...normas].sort().join('|');
    return {
        tiene_receta: true,
        ingredientes_reales: reales,
        ingredientes_prohibidos: prohibidos,
        firma_receta
    };
}

function construirTextoFidelidadIngredientesPrompt(fidelidad) {
    if (!fidelidad || !fidelidad.tiene_receta || !Array.isArray(fidelidad.ingredientes_reales) || fidelidad.ingredientes_reales.length < 2) {
        return '';
    }
    const solidos = [];
    const ligantes = [];
    const normas = [];

    for (const raw of fidelidad.ingredientes_reales) {
        const nom = String(raw || '').trim();
        if (!nom) continue;
        const norm = jh.normalizarClaveTexto(nom);
        normas.push(norm);
        if (esLiganteNoSolidoIA(norm)) {
            ligantes.push(nom.toLowerCase());
        } else {
            solidos.push(obtenerDescriptorMorfologicoIngrediente(nom, norm));
        }
    }

    const listaSolidos = solidos.length > 0 ? solidos.join('; ') : fidelidad.ingredientes_reales.join(', ');
    const partePos = `COMPOSICIÓN VISUAL CERRADA DE RECETA: Mostrar ÚNICAMENTE estos ${solidos.length || fidelidad.ingredientes_reales.length} elementos sólidos visibles reales: ${listaSolidos}. Ningún otro fruto seco, fruta deshidratada, semilla ni chip adicional debe aparecer en escena.`;
    const parteLiga = ligantes.length > 0
        ? `Acabado y ligante: leve brillo dorado tostado de ${ligantes.join(' y ')} aglutinando los clusters sin generar piezas sueltas adicionales.`
        : '';
    const exclusiones = construirExclusionesQuirurgicasIA(normas);
    const parteNeg = exclusiones.length > 0
        ? `Control morfológico estricto: ${exclusiones.join('; ')}.`
        : '';
    return [partePos, parteLiga, parteNeg].filter(Boolean).join(' ');
}

function resolverFidelidadParaListaItemsSync(itemsDesglose = []) {
    const validos = (itemsDesglose || [])
        .map(d => calcularFidelidadIngredientes(d?.ingredientes || []))
        .filter(f => f.tiene_receta);
    if (validos.length === 0) return null;
    const primeraFirma = validos[0].firma_receta;
    if (!validos.every(v => v.firma_receta === primeraFirma)) {
        return null;
    }
    return validos[0];
}

async function resolverFidelidadIngredientesParaDestino(db, {
    familia_id = null,
    articulo_principal = '',
    ruta_subrama = '',
    ruta_subrama_labels = [],
    nombre_variante = '',
    ingrediente_id = null,
    articulo_sku = null,
    presentaciones_skus = []
} = {}, catalogoPrecompilado = null) {
    const vacio = {
        tiene_receta: false,
        ingredientes_reales: [],
        ingredientes_prohibidos: [],
        firma_receta: ''
    };
    if (!db) return vacio;

    const catalogo = catalogoPrecompilado || await construirCatalogoIngredientesComerciales(db).catch(() => null);
    if (!catalogo) return vacio;

    const skusCandidatos = new Set(
        (Array.isArray(presentaciones_skus) ? presentaciones_skus : [])
            .concat(articulo_sku ? [articulo_sku] : [])
            .map(s => String(s || '').trim())
            .filter(Boolean)
    );

    const famIdNum = Number(familia_id || 0);
    const artPNorm = jh.normalizarClaveTexto(articulo_principal);
    const ingIdNum = Number(ingrediente_id || 0);
    const subLabelsArr = Array.isArray(ruta_subrama_labels) && ruta_subrama_labels.length > 0
        ? ruta_subrama_labels.map(s => String(s || '').trim()).filter(Boolean)
        : String(ruta_subrama || '').split(/\s*(?:>|›)\s*/).map(s => s.trim()).filter(Boolean);
    const rutaSubNorm = subLabelsArr.map(s => jh.normalizarClaveTexto(s)).filter(Boolean).join('>');
    const varNorm = jh.normalizarClaveTexto(nombre_variante);

    const intermediosCtx = await obtenerContextoPremezclasIntermediasIA(db);
    const IDS_PREMEZCLAS_INTERMEDIAS_IA = intermediosCtx.ids;
    const SKUS_PREMEZCLAS_INTERMEDIAS_IA = intermediosCtx.skus;

    if (skusCandidatos.size === 0 && ingIdNum > 0 && !IDS_PREMEZCLAS_INTERMEDIAS_IA.has(ingIdNum)) {
        const dIngDirecta = await obtenerDesgloseIngredientesParaItem(
            { ingrediente_origen_id: ingIdNum },
            catalogo,
            db
        ).catch((err) => {
            console.error('❌ [ImagenesBaseIA] Error obteniendo desglose directo por ingrediente_id:', ingIdNum, err);
            return null;
        });
        const fDirecta = (dIngDirecta && Array.isArray(dIngDirecta.ingredientes) && dIngDirecta.ingredientes.length >= 2)
            ? calcularFidelidadIngredientes(dIngDirecta.ingredientes)
            : null;
        if (fDirecta && fDirecta.tiene_receta) {
            return fDirecta;
        }
    }

    if (skusCandidatos.size === 0 && (ingIdNum > 0 || (famIdNum > 0 && artPNorm))) {
        const [mapaJer, resBa] = await Promise.all([
            jh.cargarMapaJerarquiaB2B(db),
            db.query(
                `SELECT ba.articulo_id AS sku_nodo,
                        ba.descripcion,
                        ba.descripcion_generada,
                        ba.familia_id,
                        ba.propiedades_dinamicas,
                        ba.es_combo,
                        bf.nombre AS familia_nombre,
                        COALESCE(ing_rec.id, ing_dir.id, 0) AS ing_id_receta
                 FROM public.bunker_articulos ba
                 JOIN public.bunker_familias bf ON bf.id = ba.familia_id
                 LEFT JOIN LATERAL (
                     SELECT i.id
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
                 WHERE COALESCE(ba.familia_id, 0) > 0
                   AND UPPER(ba.articulo_id) NOT LIKE 'NB-%'
                   AND UPPER(ba.articulo_id) NOT LIKE 'EMB-%'
                   AND ($1::int = 0 OR ba.familia_id = $1::int)`,
                [famIdNum]
            ).catch((err) => {
                console.error('❌ [ImagenesBaseIA] Error consultando bunker_articulos para fidelidad:', err);
                return { rows: [] };
            })
        ]);

        const filasFiltradasPremezcla = resBa.rows.filter(row => {
            const skuU = String(row.sku_nodo || '').toUpperCase();
            return !IDS_PREMEZCLAS_INTERMEDIAS_IA.has(Number(row.ing_id_receta || 0))
                && !SKUS_PREMEZCLAS_INTERMEDIAS_IA.has(skuU);
        });
        const filasEvaluar = (filasFiltradasPremezcla.length > 0 && !SKUS_PREMEZCLAS_INTERMEDIAS_IA.has(String(articulo_sku || '').toUpperCase()) && !IDS_PREMEZCLAS_INTERMEDIAS_IA.has(ingIdNum))
            ? filasFiltradasPremezcla
            : resBa.rows;

        const artPLabelCompact = subLabelsArr.length > 0 && jh.normalizarClaveTexto(subLabelsArr[0]) !== artPNorm
            ? [artPNorm, ...subLabelsArr.map(s => jh.normalizarClaveTexto(s))].join('>')
            : '';

        for (const row of filasEvaluar) {
            const jer = jh.resolverJerarquiaArticuloBunker(row, mapaJer);
            if (!jer || FAMILIAS_INTERNAS_EXCLUIDAS_NORM.has(jh.normalizarClaveTexto(jer.familia_nombre))) continue;
            if (ingIdNum > 0) {
                if (Number(row.ing_id_receta || 0) === ingIdNum) {
                    skusCandidatos.add(row.sku_nodo);
                }
                continue;
            }
            if (artPNorm && jh.normalizarClaveTexto(jer.articulo_principal) !== artPNorm) continue;
            const segs = [jer.sub_categoria, jer.sub_sub_categoria, jer.sub_sub_sub_categoria]
                .filter(s => s && String(s).trim() !== '')
                .map(s => jh.normalizarClaveTexto(s));
            const rowRutaNorm = segs.join('>');
            if (rutaSubNorm) {
                const matchDirecto = rowRutaNorm === rutaSubNorm || rowRutaNorm.startsWith(`${rutaSubNorm}>`);
                const matchConAncla = artPLabelCompact && (rowRutaNorm === artPLabelCompact || rowRutaNorm.startsWith(`${artPLabelCompact}>`));
                if (!matchDirecto && !matchConAncla) continue;
            }
            if (varNorm) {
                const descNorm = jh.normalizarClaveTexto(row.descripcion_generada || row.descripcion || '');
                if (!descNorm.includes(varNorm) && !varNorm.split(' ').every(w => w.length < 3 || descNorm.includes(w))) continue;
            }
            skusCandidatos.add(row.sku_nodo);
        }
    }

    const desgloses = [];
    for (const sku of skusCandidatos) {
        const d = await obtenerDesgloseIngredientesParaItem(
            { articulo_codigo: sku, sku_nodo: sku, ingrediente_origen_id: ingIdNum || undefined },
            catalogo,
            db
        ).catch(() => null);
        if (d && Array.isArray(d.ingredientes) && d.ingredientes.length >= 2) {
            desgloses.push(d);
        }
    }
    if (desgloses.length === 0 && ingIdNum > 0) {
        const dIng = await obtenerDesgloseIngredientesParaItem(
            { ingrediente_origen_id: ingIdNum },
            catalogo,
            db
        ).catch(() => null);
        if (dIng && Array.isArray(dIng.ingredientes) && dIng.ingredientes.length >= 2) {
            desgloses.push(dIng);
        }
    }

    return resolverFidelidadParaListaItemsSync(desgloses) || vacio;
}

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
    if (
        t === 'ANCLA_PRINCIPAL' ||
        t === 'SUBRAMA_JERARQUIA' ||
        t === 'INGREDIENTE' ||
        t === 'PRODUCTO_BASE' ||
        t === 'ARTICULO_SKU'
    ) {
        return t;
    }
    const err = new Error('tipo_ancla inválido. Usá ANCLA_PRINCIPAL, SUBRAMA_JERARQUIA, INGREDIENTE, PRODUCTO_BASE o ARTICULO_SKU.');
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

function extraerSegmentosSubrama(raw) {
    if (Array.isArray(raw)) {
        return raw.map(s => String(s || '').trim()).filter(Boolean).slice(0, 3);
    }
    const txt = String(raw || '').trim();
    if (!txt) return [];
    return txt
        .split(/\s*(?:>|›|___)\s*/)
        .map(s => String(s || '').trim())
        .filter(Boolean)
        .slice(0, 3);
}

function normalizarRutaSubrama(raw) {
    const segs = extraerSegmentosSubrama(raw)
        .map(s => jh.normalizarClaveTexto(s))
        .filter(Boolean);
    return segs.join('>');
}

function construirClaveAnclaPrincipal(familiaId, articuloPrincipal) {
    const fam = Number(familiaId || 0) || 0;
    const artNorm = jh.normalizarClaveTexto(articuloPrincipal);
    if (!fam || !artNorm) return '';
    return `${fam}::${artNorm}`;
}

function construirClaveSubrama(familiaId, articuloPrincipal, rutaSubrama) {
    const fam = Number(familiaId || 0) || 0;
    const artNorm = jh.normalizarClaveTexto(articuloPrincipal);
    const rutaNorm = normalizarRutaSubrama(rutaSubrama);
    if (!fam || !artNorm || !rutaNorm) return '';
    return `${fam}::${artNorm}::${rutaNorm}`;
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
               familia_id, articulo_principal_norm, ruta_subrama_norm, biblioteca_imagen_id,
               foto_id, url, width, height, bytes, origen_tipo, origen_foto_lote_id,
               titulo_referencia, created_at, updated_at
        FROM public.lamda_imagenes_base
        WHERE activo = true
        ORDER BY id DESC
    `);

    const porIngredienteId = new Map();
    const porClaveBase = new Map();
    const porSku = new Map();
    const porSubrama = new Map();
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
            ruta_subrama_norm: row.ruta_subrama_norm || null,
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
        } else if (row.tipo_ancla === 'SUBRAMA_JERARQUIA' && row.familia_id && row.articulo_principal_norm && row.ruta_subrama_norm) {
            const srKey = construirClaveSubrama(row.familia_id, row.articulo_principal_norm, row.ruta_subrama_norm);
            if (srKey && !porSubrama.has(srKey)) porSubrama.set(srKey, entry);
        } else if (row.tipo_ancla === 'ANCLA_PRINCIPAL' && row.familia_id && row.articulo_principal_norm) {
            const anclaKey = construirClaveAnclaPrincipal(row.familia_id, row.articulo_principal_norm);
            if (anclaKey && !porAnclaPrincipal.has(anclaKey)) porAnclaPrincipal.set(anclaKey, entry);
        }
    }

    return { porIngredienteId, porClaveBase, porSku, porSubrama, porAnclaPrincipal };
}

function resolverSubramaDesdeMapa(famId, artPrincipal, segmentosRaw = [], mapaImagenes = null) {
    if (!mapaImagenes || !mapaImagenes.porSubrama || !famId || !artPrincipal) return null;
    const cleanSegs = segmentosRaw.map(s => String(s || '').trim()).filter(Boolean).slice(0, 3);
    for (let len = cleanSegs.length; len >= 1; len--) {
        const subSegs = cleanSegs.slice(0, len);
        const srKey = construirClaveSubrama(famId, artPrincipal, subSegs);
        if (srKey && mapaImagenes.porSubrama.has(srKey)) {
            return {
                entry: mapaImagenes.porSubrama.get(srKey),
                nivel: len === 3 ? 'SUBRAMA_N5' : (len === 2 ? 'SUBRAMA_N4' : 'SUBRAMA_N3')
            };
        }
    }
    return null;
}

/**
 * Cascada determinista de 7 escalones:
 *   1. ARTICULO_SKU -> 2. INGREDIENTE -> 3. PRODUCTO_BASE
 *   4. SUBRAMA_N5 -> 5. SUBRAMA_N4 -> 6. SUBRAMA_N3 -> 7. ANCLA_PRINCIPAL
 */
function resolverImagenBaseLamdaParaArticulo(art = {}, mapaImagenes = null) {
    if (!mapaImagenes) return null;

    const skuKey = String(art.sku_nodo || art.articulo_id || '').trim().toUpperCase();
    if (skuKey && mapaImagenes.porSku && mapaImagenes.porSku.has(skuKey)) {
        return { ...mapaImagenes.porSku.get(skuKey), heredada_de_ancla: false, nivel_herencia: 'ARTICULO_SKU' };
    }

    const ingId = Number(art.ingrediente_origen_id || art.ing_id || 0);
    if (ingId > 0 && mapaImagenes.porIngredienteId && mapaImagenes.porIngredienteId.has(ingId)) {
        return { ...mapaImagenes.porIngredienteId.get(ingId), heredada_de_ancla: false, nivel_herencia: 'INGREDIENTE' };
    }

    const claveBase = String(art.clave_producto_base || '').trim();
    if (claveBase && mapaImagenes.porClaveBase && mapaImagenes.porClaveBase.has(claveBase)) {
        return { ...mapaImagenes.porClaveBase.get(claveBase), heredada_de_ancla: false, nivel_herencia: 'PRODUCTO_BASE' };
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

    const segsSub = [
        art.jerarquia_b2b?.sub_categoria,
        art.jerarquia_b2b?.sub_sub_categoria,
        art.jerarquia_b2b?.sub_sub_sub_categoria
    ].filter(s => s && String(s).trim() !== '');
    const matchSub = resolverSubramaDesdeMapa(famId, artPrincipal, segsSub, mapaImagenes);
    if (matchSub && matchSub.entry) {
        return {
            ...matchSub.entry,
            heredada_de_ancla: true,
            nivel_herencia: matchSub.nivel
        };
    }

    const anclaKey = construirClaveAnclaPrincipal(famId, artPrincipal);
    if (anclaKey && mapaImagenes.porAnclaPrincipal && mapaImagenes.porAnclaPrincipal.has(anclaKey)) {
        return {
            ...mapaImagenes.porAnclaPrincipal.get(anclaKey),
            heredada_de_ancla: true,
            nivel_herencia: 'ANCLA_PRINCIPAL'
        };
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
    rutaSubrama = '',
    incluirInternas = false
} = {}) {
    const famIdFiltro = Number(familiaId || 0) || 0;
    const artPrincipalFiltroNorm = jh.normalizarClaveTexto(articuloPrincipal);
    const rutaSubramaFiltro = normalizarRutaSubrama(rutaSubrama);

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
                subramasMap: new Map(),
                variedadesMap: new Map(),
                total_presentaciones: 0,
                en_nodos_count: 0
            });
        }
        const anclaObj = anclasMap.get(anclaKey);
        const segsSubRow = [
            jer.sub_categoria,
            jer.sub_sub_categoria,
            jer.sub_sub_sub_categoria
        ].filter(s => s && String(s).trim() !== '');
        const varNormRow = (!row.es_combo && ingId > 0)
            ? `ing_${ingId}`
            : (jh.normalizarClaveTexto(nombre_base_oficial) || claveBase);

        for (let len = 1; len <= segsSubRow.length; len++) {
            const subSegs = segsSubRow.slice(0, len);
            const rNorm = normalizarRutaSubrama(subSegs);
            if (!rNorm) continue;
            if (!anclaObj.subramasMap.has(rNorm)) {
                anclaObj.subramasMap.set(rNorm, {
                    ruta_subrama_norm: rNorm,
                    ruta_subrama_labels: subSegs.slice(),
                    label_display: subSegs[subSegs.length - 1],
                    nivel: 2 + len,
                    variedadesSet: new Set(),
                    total_presentaciones: 0,
                    en_nodos_count: 0
                });
            }
            const srObj = anclaObj.subramasMap.get(rNorm);
            srObj.variedadesSet.add(varNormRow);
            srObj.total_presentaciones += 1;
            if (enNodos) srObj.en_nodos_count += 1;
        }

        const rutaSubRowNorm = normalizarRutaSubrama(segsSubRow);
        if (rutaSubramaFiltro) {
            const coincideSub = rutaSubRowNorm === rutaSubramaFiltro || rutaSubRowNorm.startsWith(`${rutaSubramaFiltro}>`);
            if (!coincideSub) continue;
        }

        anclaObj.total_presentaciones += 1;
        if (enNodos) anclaObj.en_nodos_count += 1;

        // Unificar bulto + fracción + presentaciones del mismo ingrediente en una sola fila de variedad
        const varNorm = varNormRow;
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
                ruta_subrama_labels: segsSubRow,
                ruta_subrama_norm: rutaSubRowNorm,
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
        const subramas = Array.from(a.subramasMap.values()).map(sr => {
            const srKey = construirClaveSubrama(a.familia_id, a.articulo_principal, sr.ruta_subrama_norm);
            const imgPropia = srKey ? (mapaImg.porSubrama.get(srKey) || null) : null;
            const parentSegs = sr.ruta_subrama_labels.slice(0, -1);
            const matchParent = parentSegs.length > 0
                ? resolverSubramaDesdeMapa(a.familia_id, a.articulo_principal, parentSegs, mapaImg)
                : null;
            const imgHeredada = (matchParent && matchParent.entry) ? matchParent.entry : (a.imagen_ancla || null);
            const imgEfectiva = imgPropia || imgHeredada || null;
            let heredaDeLabel = a.articulo_principal;
            if (matchParent && matchParent.entry) {
                const pLabels = sr.ruta_subrama_labels.slice(0, matchParent.nivel === 'SUBRAMA_N4' ? 2 : 1);
                heredaDeLabel = pLabels.join(' › ');
            }
            return {
                ruta_subrama_norm: sr.ruta_subrama_norm,
                ruta_subrama_labels: sr.ruta_subrama_labels,
                label_display: sr.label_display,
                nivel: sr.nivel,
                total_variedades: sr.variedadesSet.size,
                total_presentaciones: sr.total_presentaciones,
                en_nodos_count: sr.en_nodos_count,
                tiene_foto_propia: Boolean(imgPropia),
                imagen_propia: imgPropia,
                imagen_heredada: imgHeredada,
                imagen_efectiva: imgEfectiva,
                hereda_de_label: heredaDeLabel
            };
        }).sort((x, y) =>
            x.ruta_subrama_labels.join(' > ').localeCompare(y.ruta_subrama_labels.join(' > '), 'es-AR')
        );

        const variedades = Array.from(a.variedadesMap.values()).map(v => {
            v.presentaciones.sort((x, y) => x.kilos_unidad - y.kilos_unidad || x.sku_nodo.localeCompare(y.sku_nodo));
            const imagenPropia = resolverExcepcionDirectaVariedad(v, mapaImg);
            const matchSub = resolverSubramaDesdeMapa(a.familia_id, a.articulo_principal, v.ruta_subrama_labels || [], mapaImg);
            const imagenSub = (matchSub && matchSub.entry) ? matchSub.entry : null;
            const imagenEfectiva = imagenPropia || imagenSub || a.imagen_ancla || null;
            let heredaDeLabel = a.articulo_principal;
            if (matchSub && matchSub.entry) {
                const lenUsado = matchSub.nivel === 'SUBRAMA_N5' ? 3 : (matchSub.nivel === 'SUBRAMA_N4' ? 2 : 1);
                heredaDeLabel = (v.ruta_subrama_labels || []).slice(0, lenUsado).join(' › ') || a.articulo_principal;
            }
            const { _tieneNombreDeNodo, ...vClean } = v;
            return {
                ...vClean,
                claves_secundarias: Array.from(new Set(v.claves_secundarias)),
                total_presentaciones: v.presentaciones.length,
                tiene_excepcion_propia: Boolean(imagenPropia),
                imagen_propia: imagenPropia,
                imagen_heredada_subrama: imagenSub,
                hereda_de_label: heredaDeLabel,
                imagen_efectiva: imagenEfectiva
            };
        }).sort((x, y) => x.nombre_base_oficial.localeCompare(y.nombre_base_oficial, 'es-AR'));

        const excepcionesCount = variedades.filter(v => v.tiene_excepcion_propia).length;
        const subramasPropiasCount = subramas.filter(s => s.tiene_foto_propia).length;
        const imagenEfectivaAncla = a.imagen_ancla ||
            subramas.find(s => s.imagen_propia)?.imagen_propia ||
            variedades.find(v => v.imagen_propia)?.imagen_propia ||
            null;

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
            subramas_con_foto_count: subramasPropiasCount,
            subramas,
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

    const [catalogoIng, intermediosCatCtx] = await Promise.all([
        construirCatalogoIngredientesComerciales(db).catch(() => null),
        obtenerContextoPremezclasIntermediasIA(db)
    ]);
    const IDS_PREMEZCLAS_INTERMEDIAS_IA = intermediosCatCtx.ids;
    const SKUS_PREMEZCLAS_INTERMEDIAS_IA = intermediosCatCtx.skus;
    if (catalogoIng) {
        const fidelidadPorSku = new Map();
        const obtenerFidelidadSku = async (sku, ingIdOpt) => {
            const k = `${String(sku || '').toUpperCase()}#${Number(ingIdOpt || 0)}`;
            if (fidelidadPorSku.has(k)) return fidelidadPorSku.get(k);
            const d = await obtenerDesgloseIngredientesParaItem(
                { articulo_codigo: sku || undefined, sku_nodo: sku || undefined, ingrediente_origen_id: ingIdOpt || undefined },
                catalogoIng,
                db
            ).catch(() => null);
            const f = (d && Array.isArray(d.ingredientes) && d.ingredientes.length >= 2)
                ? calcularFidelidadIngredientes(d.ingredientes)
                : null;
            const resF = (f && f.tiene_receta) ? f : null;
            fidelidadPorSku.set(k, resF);
            return resF;
        };

        for (const a of anclasPrincipales) {
            for (const v of a.variedades) {
                const candF = [];
                if (v.presentaciones && v.presentaciones.length > 0) {
                    const f = await obtenerFidelidadSku(v.presentaciones[0].sku_nodo, v.ingrediente_id);
                    if (f) candF.push(f);
                } else if (v.sku_principal_combo || v.ingrediente_id) {
                    const f = await obtenerFidelidadSku(v.sku_principal_combo, v.ingrediente_id);
                    if (f) candF.push(f);
                }
                v.fidelidad_ingredientes = (candF.length > 0) ? candF[0] : null;
            }

            for (const sr of a.subramas) {
                const varsSrRaw = a.variedades.filter(v =>
                    v.ruta_subrama_norm === sr.ruta_subrama_norm ||
                    v.ruta_subrama_norm.startsWith(`${sr.ruta_subrama_norm}>`)
                );
                const varsComercialesSr = varsSrRaw.filter(v =>
                    !IDS_PREMEZCLAS_INTERMEDIAS_IA.has(Number(v.ingrediente_id || 0)) &&
                    !(v.presentaciones || []).every(p => SKUS_PREMEZCLAS_INTERMEDIAS_IA.has(String(p.sku_nodo || '').toUpperCase()))
                );
                const varsSr = varsComercialesSr.length > 0 ? varsComercialesSr : varsSrRaw;
                const todasTienen = varsSr.length > 0 && varsSr.every(v => v.fidelidad_ingredientes && v.fidelidad_ingredientes.tiene_receta);
                if (todasTienen) {
                    const firma0 = varsSr[0].fidelidad_ingredientes.firma_receta;
                    sr.fidelidad_ingredientes = varsSr.every(v => v.fidelidad_ingredientes.firma_receta === firma0)
                        ? varsSr[0].fidelidad_ingredientes
                        : null;
                } else {
                    sr.fidelidad_ingredientes = null;
                }
            }

            const varsComercialesAncla = a.variedades.filter(v =>
                !IDS_PREMEZCLAS_INTERMEDIAS_IA.has(Number(v.ingrediente_id || 0)) &&
                !(v.presentaciones || []).every(p => SKUS_PREMEZCLAS_INTERMEDIAS_IA.has(String(p.sku_nodo || '').toUpperCase()))
            );
            const varsAnclaEval = varsComercialesAncla.length > 0 ? varsComercialesAncla : a.variedades;
            const todasAncla = varsAnclaEval.length > 0 && varsAnclaEval.every(v => v.fidelidad_ingredientes && v.fidelidad_ingredientes.tiene_receta);
            if (todasAncla) {
                const firma0 = varsAnclaEval[0].fidelidad_ingredientes.firma_receta;
                a.fidelidad_ingredientes = varsAnclaEval.every(v => v.fidelidad_ingredientes.firma_receta === firma0)
                    ? varsAnclaEval[0].fidelidad_ingredientes
                    : null;
            } else {
                a.fidelidad_ingredientes = null;
            }
        }
    }

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
    prompt_usado = null,
    uso_referencias_count = 0,
    prompt_guardado_id = null
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
    const refsCountNum = Math.max(0, Math.min(2, Number(uso_referencias_count) || 0));
    const promptIdNum = Number(prompt_guardado_id || 0) > 0 ? Number(prompt_guardado_id) : null;

    try {
        const ins = await db.query(
            `INSERT INTO public.lamda_biblioteca_imagenes (
                familia_id, familia_slug, articulo_principal_norm, etiqueta,
                foto_id, url, url_original, width, height, bytes,
                origen_tipo, modelo_ia, preset_estilo, prompt_usado,
                uso_referencias_count, prompt_guardado_id, activo
             ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,true)
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
                prompt_usado ? String(prompt_usado).slice(0, 4000) : null,
                refsCountNum,
                promptIdNum
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
    rutaSubramaNorm = null,
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
    } else if (tipoNorm === 'SUBRAMA_JERARQUIA') {
        prevRes = await client.query(
            `UPDATE public.lamda_imagenes_base
             SET activo = false, updated_at = NOW()
             WHERE activo = true AND tipo_ancla = 'SUBRAMA_JERARQUIA'
               AND familia_id = $1 AND articulo_principal_norm = $2 AND ruta_subrama_norm = $3
             RETURNING url`,
            [famIdNum, artPNorm, rutaSubramaNorm]
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
            familia_id, articulo_principal_norm, ruta_subrama_norm, biblioteca_imagen_id,
            foto_id, url, url_original, width, height, bytes,
            origen_tipo, titulo_referencia, activo
         ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,true)
         RETURNING *`,
        [
            tipoNorm,
            ingIdNum,
            claveBaseClean,
            skuClean,
            famIdNum,
            artPNorm,
            rutaSubramaNorm,
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
    ruta_subrama = null,
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
    let rutaSubramaNorm = ruta_subrama ? normalizarRutaSubrama(ruta_subrama) : null;
    let ingIdNum = ingrediente_id ? Number(ingrediente_id) : null;
    let claveBaseClean = clave_producto_base ? sanitizarSegmentoPath(clave_producto_base, '') : null;
    let skuClean = articulo_sku ? String(articulo_sku).trim().toUpperCase() : null;

    if (tipoNorm === 'ANCLA_PRINCIPAL') {
        if (!Number.isInteger(famIdNum) || famIdNum <= 0 || !artPNorm) {
            const err = new Error('familia_id y articulo_principal son requeridos para ancla ANCLA_PRINCIPAL.');
            err.statusCode = 400;
            throw err;
        }
        rutaSubramaNorm = null;
        ingIdNum = null;
        claveBaseClean = null;
        skuClean = null;
    } else if (tipoNorm === 'SUBRAMA_JERARQUIA') {
        if (!Number.isInteger(famIdNum) || famIdNum <= 0 || !artPNorm || !rutaSubramaNorm) {
            const err = new Error('familia_id, articulo_principal y ruta_subrama son requeridos para ancla SUBRAMA_JERARQUIA.');
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
        rutaSubramaNorm = null;
        skuClean = null;
    } else if (tipoNorm === 'PRODUCTO_BASE') {
        if (!claveBaseClean) {
            const err = new Error('clave_producto_base requerida para ancla PRODUCTO_BASE.');
            err.statusCode = 400;
            throw err;
        }
        rutaSubramaNorm = null;
        ingIdNum = null;
        skuClean = null;
    } else {
        if (!skuClean) {
            const err = new Error('articulo_sku requerido para ancla ARTICULO_SKU.');
            err.statusCode = 400;
            throw err;
        }
        rutaSubramaNorm = null;
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
            rutaSubramaNorm,
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
                rutaSubramaNorm: null,
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
        articuloPrincipal: artPNorm || undefined,
        rutaSubrama: tipoNorm === 'SUBRAMA_JERARQUIA' ? rutaSubramaNorm : undefined
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
    ruta_subrama = null,
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
        ruta_subrama,
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

function limpiarTextoComercialParaPrompt(raw) {
    return String(raw || '')
        .replace(/\bRELDO\b/gi, 'Repelado')
        .replace(/\bCHLER\b/gi, 'Chandler')
        .replace(/\bEXLIGHT\b/gi, 'Extra Light')
        .replace(/\bVGNA\b/gi, 'Virginia')
        .replace(/\bMPSA\b/gi, 'Mariposa')
        .replace(/\bS\/PIEL\b/gi, 'Sin piel')
        .replace(/\bC\/CASCARA\b/gi, 'Con cáscara')
        .replace(/\bS\/CASCARA\b/gi, 'Sin cáscara')
        .replace(/\bTOST\/SAL\b/gi, 'Tostado y Salado')
        .replace(/\bF\/SCOS\b/gi, 'Frutos Secos')
        .replace(/\s+/g, ' ')
        .trim();
}

function inferirDescriptoresVisualesPrompt(tokensTxt) {
    const norm = jh.normalizarClaveTexto(tokensTxt);
    const notas = [];
    if (/\bcon cascara\b/.test(norm)) {
        notas.push('Frutos enteros CON su cáscara natural intacta, sin pelar.');
    } else if (/\b(repelado|peladas|pelado|sin cascara|sin piel)\b/.test(norm)) {
        notas.push('Granos o frutos completamente pelados, SIN cáscara, SIN vainas ni restos de piel.');
    }
    if (/\bcrudo\b/.test(norm) && /\bmani\b/.test(norm)) {
        notas.push('Granos de maní crudos sin tostar con su fina piel natural rojiza/rosada, sin cáscara dura exterior.');
    }
    if (/\bmariposa\b/.test(norm)) {
        notas.push('En mitades enteras bien formadas tipo mariposa.');
    }
    if (/\b(cuarto|partida|picada)\b/.test(norm)) {
        notas.push('En cuartos o trozos irregulares naturales (no mitades enteras).');
    }
    if (/\b(fileteada|laminada)\b/.test(norm)) {
        notas.push('Cortadas en láminas finas fileteadas.');
    }
    if (/\bpecan\b/.test(norm)) {
        notas.push('Nuez pecán alargada con surcos característicos.');
    }
    if (/\b(tostado|tostada)\b/.test(norm)) {
        notas.push('Aspecto dorado tostado apetitoso.');
    }
    if (/\bsalado\b/.test(norm) && !/\bsin sal\b/.test(norm)) {
        notas.push('Con ligeros cristales finos de sal superficial.');
    } else if (/\bsin sal\b/.test(norm)) {
        notas.push('Al natural sin cristales de sal.');
    }
    if (/\bextra light\b|\blight\b/.test(norm)) {
        notas.push('De tono claro dorado pálido (extra light).');
    } else if (/\bambar\b/.test(norm)) {
        notas.push('De tono ámbar dorado intenso.');
    }
    if (/\brubia\b/.test(norm)) {
        notas.push('De color dorado claro rubio.');
    } else if (/\bnegra\b/.test(norm)) {
        notas.push('De color oscuro intenso natural.');
    }
    return notas;
}

function compactarSegmentosRutaPrompt(segs = []) {
    const out = [];
    for (const raw of (segs || [])) {
        const clean = limpiarTextoComercialParaPrompt(raw);
        if (!clean) continue;
        const norm = jh.normalizarClaveTexto(clean);
        if (out.length === 0 || jh.normalizarClaveTexto(out[out.length - 1]) !== norm) {
            out.push(clean);
        }
    }
    return out;
}

function limpiarRepeticionesAdyacentesPrompt(texto = '') {
    return String(texto || '').replace(/\b([A-Za-zÁÉÍÓÚÜÑáéíóúüñ0-9]+)(?:\s+\1\b)+/gi, '$1');
}

function construirPromptImagenBase({
    familia_nombre = '',
    articulo_principal = '',
    ruta_subrama_labels = [],
    nombre_variante = '',
    preset_estilo = 'cuenco_neutro',
    incluir_regla_sin_envases = true
} = {}) {
    if (String(preset_estilo || '').trim() === 'libre') {
        return '';
    }
    const estilo = ESTILOS_IA_IMAGEN_BASE[preset_estilo] || ESTILOS_IA_IMAGEN_BASE.cuenco_neutro;
    const subSegs = extraerSegmentosSubrama(ruta_subrama_labels).map(limpiarTextoComercialParaPrompt);
    const artClean = limpiarTextoComercialParaPrompt(articulo_principal);
    const varClean = limpiarTextoComercialParaPrompt(nombre_variante);
    const rutaCompacta = compactarSegmentosRutaPrompt([artClean, ...subSegs]);
    const rutaVisual = rutaCompacta.join(' › ');
    const sujeto = varClean || rutaVisual || 'ingrediente natural';
    const fam = String(familia_nombre || '').trim();
    const contextoFam = fam && jh.normalizarClaveTexto(fam) !== jh.normalizarClaveTexto(artClean || sujeto)
        ? ` (rubro: ${fam})`
        : '';
    const notasVisuales = inferirDescriptoresVisualesPrompt(`${fam} ${artClean} ${subSegs.join(' ')} ${varClean}`);

    const partes = [
        estilo.descripcion_prompt,
        `Producto protagonista único: "${sujeto}"${contextoFam}.`,
        ...notasVisuales,
        'Mostrar únicamente el producto natural/elaborado real con fidelidad visual y textura apetitosa, nitidez alta, encuadre centrado.'
    ];
    if (incluir_regla_sin_envases !== false) {
        partes.push(REGLA_SIN_ENVASES_TXT);
    }
    return partes.filter(Boolean).join(' ');
}

function interpolarPromptGuardado(texto, { producto = '', rubro = '' } = {}) {
    return String(texto || '')
        .replace(/\{\{\s*PRODUCTO\s*\}\}/gi, String(producto || '').trim() || 'producto natural')
        .replace(/\{\{\s*RUBRO\s*\}\}/gi, String(rubro || '').trim() || 'Almacén')
        .replace(/[ \t]+/g, ' ')
        .trim();
}

async function normalizarImagenesReferencia(rawList = []) {
    if (!rawList || (Array.isArray(rawList) && rawList.length === 0)) {
        return [];
    }
    if (!Array.isArray(rawList)) {
        const err = new Error('imagenes_referencia debe ser una lista de hasta 2 fotografías.');
        err.statusCode = 400;
        throw err;
    }
    if (rawList.length > 2) {
        const err = new Error('Podés adjuntar como máximo 2 fotografías de referencia.');
        err.statusCode = 400;
        throw err;
    }

    const normalizadas = [];
    for (let idx = 0; idx < rawList.length; idx++) {
        const item = rawList[idx];
        let rawBuf = null;
        if (Buffer.isBuffer(item)) {
            rawBuf = item;
        } else if (item && Buffer.isBuffer(item.buffer)) {
            rawBuf = item.buffer;
        } else {
            const rawStr = typeof item === 'string'
                ? item.trim()
                : String(item?.data || item?.dataUrl || item?.base64 || '').trim();
            if (!rawStr) continue;
            const matchDataUrl = /^data:image\/[a-z0-9.+-]+;base64,(.+)$/i.exec(rawStr);
            const b64 = matchDataUrl ? matchDataUrl[1] : rawStr;
            rawBuf = Buffer.from(b64, 'base64');
        }

        if (!rawBuf || rawBuf.length === 0) {
            const err = new Error(`La foto de referencia #${idx + 1} está vacía o es inválida.`);
            err.statusCode = 400;
            throw err;
        }
        if (rawBuf.length > 10 * 1024 * 1024) {
            const err = new Error(`La foto de referencia #${idx + 1} supera los 10 MB permitidos.`);
            err.statusCode = 400;
            throw err;
        }

        try {
            const outBuf = await sharp(rawBuf, { failOnError: true })
                .rotate()
                .resize(1280, 1280, { fit: 'inside', withoutEnlargement: true })
                .jpeg({ quality: 85 })
                .toBuffer();
            normalizadas.push({
                mimeType: 'image/jpeg',
                data: outBuf.toString('base64'),
                bytes: outBuf.length
            });
        } catch (sharpErr) {
            const err = new Error(`La foto de referencia #${idx + 1} no es una imagen válida (${sharpErr.message}).`);
            err.statusCode = 400;
            throw err;
        }
    }
    return normalizadas;
}

function yaContieneReglaSinEnvases(texto) {
    const norm = jh.normalizarClaveTexto(texto);
    return norm.includes('sin envase') || norm.includes('sin bolsas') || norm.includes('sin marcas');
}

function armarPromptYPartesGemini({
    familia_nombre = '',
    articulo_principal = '',
    ruta_subrama_labels = [],
    nombre_variante = '',
    preset_estilo = 'cuenco_neutro',
    modo_prompt = null,
    prompt_personalizado = '',
    incluir_regla_sin_envases = true,
    incluir_fidelidad_ingredientes = true,
    fidelidad_ingredientes = null,
    referencias = []
} = {}) {
    const subSegs = extraerSegmentosSubrama(ruta_subrama_labels).map(limpiarTextoComercialParaPrompt);
    const artClean = limpiarTextoComercialParaPrompt(articulo_principal);
    const varClean = limpiarTextoComercialParaPrompt(nombre_variante);
    const rutaCompacta = compactarSegmentosRutaPrompt([artClean, ...subSegs]);
    const sujeto = varClean || rutaCompacta.join(' › ') || 'producto natural';
    const fam = String(familia_nombre || '').trim();
    const sinEnvasesBool = incluir_regla_sin_envases !== false && String(incluir_regla_sin_envases).toLowerCase() !== 'false';
    const fidelidadBool = incluir_fidelidad_ingredientes !== false && String(incluir_fidelidad_ingredientes).toLowerCase() !== 'false';

    const rawPrompt = String(prompt_personalizado || '').trim();
    const rawModo = String(modo_prompt || '').trim().toLowerCase();
    const presetNorm = String(preset_estilo || '').trim();

    let modoEfectivo = 'preset';
    if (presetNorm === 'libre' || rawModo === 'libre') {
        modoEfectivo = 'libre';
    } else if (rawModo === 'guardado') {
        modoEfectivo = 'guardado';
    } else if (rawPrompt && rawModo !== 'preset') {
        modoEfectivo = 'libre';
    }

    if (modoEfectivo === 'libre' && !rawPrompt) {
        const err = new Error('En modo Prompt libre debés escribir la descripción deseada.');
        err.statusCode = 400;
        throw err;
    }

    let promptUsuarioFinal = '';
    if (rawPrompt) {
        promptUsuarioFinal = limpiarRepeticionesAdyacentesPrompt(
            interpolarPromptGuardado(rawPrompt, { producto: sujeto, rubro: fam || artClean })
        );
        if (sinEnvasesBool && !yaContieneReglaSinEnvases(promptUsuarioFinal)) {
            promptUsuarioFinal = `${promptUsuarioFinal} ${REGLA_SIN_ENVASES_TXT}`.trim();
        }
    } else {
        const presetUsar = (presetNorm && presetNorm !== 'libre' && ESTILOS_IA_IMAGEN_BASE[presetNorm])
            ? presetNorm
            : 'cuenco_neutro';
        promptUsuarioFinal = construirPromptImagenBase({
            familia_nombre,
            articulo_principal,
            ruta_subrama_labels,
            nombre_variante,
            preset_estilo: presetUsar,
            incluir_regla_sin_envases: sinEnvasesBool
        });
    }

    const fidelidadActiva = fidelidadBool && fidelidad_ingredientes && fidelidad_ingredientes.tiene_receta
        ? fidelidad_ingredientes
        : null;
    const bloqueFidelidad = fidelidadActiva ? construirTextoFidelidadIngredientesPrompt(fidelidadActiva) : '';

    const refs = Array.isArray(referencias) ? referencias : [];
    const segmentosEnvio = [];
    if (refs.length > 0) segmentosEnvio.push(INSTRUCCION_REFERENCIA_VISUAL_TXT);
    segmentosEnvio.push(promptUsuarioFinal);
    if (bloqueFidelidad) segmentosEnvio.push(bloqueFidelidad);
    const promptEnviado = segmentosEnvio.filter(Boolean).join('\n\n');

    const parts = [
        ...refs.map(r => ({ inlineData: { mimeType: r.mimeType, data: r.data } })),
        { text: promptEnviado }
    ];

    let presetEfectivo = 'cuenco_neutro';
    if (modoEfectivo === 'libre') {
        presetEfectivo = 'libre';
    } else if (modoEfectivo === 'guardado') {
        presetEfectivo = 'guardado';
    } else if (presetNorm && ESTILOS_IA_IMAGEN_BASE[presetNorm]) {
        presetEfectivo = presetNorm;
    }

    return {
        promptEnviado,
        promptUsuarioFinal,
        presetEfectivo,
        modoEfectivo,
        fidelidadAplicada: fidelidadActiva,
        parts
    };
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
    db = null,
    familia_id = null,
    familia_nombre = '',
    articulo_principal = '',
    ruta_subrama_labels = [],
    nombre_variante = '',
    ingrediente_id = null,
    articulo_sku = null,
    preset_estilo = 'cuenco_neutro',
    modo_prompt = null,
    calidad = 'estandar',
    prompt_personalizado = '',
    incluir_regla_sin_envases = true,
    incluir_fidelidad_ingredientes = true,
    fidelidad_ingredientes = null,
    prompt_guardado_id = null,
    imagenes_referencia = []
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

    const fidelidadBool = incluir_fidelidad_ingredientes !== false && String(incluir_fidelidad_ingredientes).toLowerCase() !== 'false';
    let fidelidadResuelta = fidelidad_ingredientes;
    if (fidelidadBool && !fidelidadResuelta && db) {
        fidelidadResuelta = await resolverFidelidadIngredientesParaDestino(db, {
            familia_id,
            articulo_principal,
            ruta_subrama_labels,
            nombre_variante,
            ingrediente_id,
            articulo_sku
        }).catch((err) => {
            console.error('❌ [ImagenesBaseIA] Fallo resolviendo fidelidad de receta para', {
                familia_id,
                articulo_principal,
                ruta_subrama_labels,
                nombre_variante,
                ingrediente_id,
                articulo_sku
            }, err);
            return null;
        });
    }

    const referenciasNorm = await normalizarImagenesReferencia(imagenes_referencia);
    const {
        promptEnviado,
        promptUsuarioFinal,
        presetEfectivo,
        modoEfectivo,
        fidelidadAplicada,
        parts
    } = armarPromptYPartesGemini({
        familia_nombre,
        articulo_principal,
        ruta_subrama_labels,
        nombre_variante,
        preset_estilo,
        modo_prompt,
        prompt_personalizado,
        incluir_regla_sin_envases,
        incluir_fidelidad_ingredientes: fidelidadBool,
        fidelidad_ingredientes: fidelidadResuelta,
        referencias: referenciasNorm
    });

    const calidadNorm = String(calidad || '').trim().toLowerCase() === 'pro' ? 'pro' : 'estandar';
    const modelos = calidadNorm === 'pro'
        ? ['gemini-3-pro-image', 'gemini-3.1-flash-image', 'gemini-2.5-flash-image']
        : ['gemini-3.1-flash-image', 'gemini-2.5-flash-image'];

    const timeoutMs = referenciasNorm.length > 0 ? 60000 : 45000;

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
                    contents: [{ parts }],
                    generationConfig: { responseModalities: ['IMAGE'] }
                }, { timeout: timeoutMs });

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

    const promptGuardadoIdNum = Number(prompt_guardado_id || 0) > 0 ? Number(prompt_guardado_id) : null;
    if (db && promptGuardadoIdNum) {
        await db.query(
            `UPDATE public.lamda_biblioteca_prompts
             SET usos_count = COALESCE(usos_count, 0) + 1, updated_at = NOW()
             WHERE id = $1 AND activo = true`,
            [promptGuardadoIdNum]
        ).catch(() => {});
    }

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
        preset_estilo: presetEfectivo,
        modo_prompt: modoEfectivo,
        prompt_usado: promptUsuarioFinal,
        uso_referencias_count: referenciasNorm.length,
        prompt_guardado_id: promptGuardadoIdNum,
        createdAt: Date.now()
    });

    return {
        preview_token: previewToken,
        preview_data_url: `data:image/webp;base64,${normalizedWebp.data.toString('base64')}`,
        modelo_usado: modeloUsado,
        preset_estilo: presetEfectivo,
        modo_prompt: modoEfectivo,
        prompt_usado: promptUsuarioFinal,
        prompt_enviado_ia: promptEnviado,
        uso_referencias_count: referenciasNorm.length,
        prompt_guardado_id: promptGuardadoIdNum,
        fidelidad_ingredientes: fidelidadAplicada || null,
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
    ruta_subrama = null,
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
        prompt_usado: cached.prompt_usado,
        uso_referencias_count: cached.uso_referencias_count || 0,
        prompt_guardado_id: cached.prompt_guardado_id || null
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
        ruta_subrama,
        ingrediente_id,
        clave_producto_base,
        claves_secundarias,
        articulo_sku,
        titulo_referencia: titulo_referencia || bibItem.etiqueta
    });
}

async function listarPromptsGuardados(db, { busqueda = '', categoria = '' } = {}) {
    const qNorm = jh.normalizarClaveTexto(busqueda);
    const terms = qNorm ? qNorm.split(/\s+/).filter(Boolean) : [];
    const catClean = String(categoria || '').trim().toUpperCase();

    const params = [];
    let whereExtra = '';
    if (catClean && catClean !== 'TODAS') {
        params.push(catClean);
        whereExtra = ` AND UPPER(categoria) = $${params.length}`;
    }

    const res = await db.query(
        `SELECT id, nombre, categoria, prompt_texto, preset_base, regla_sin_envases,
                es_favorito, usos_count, created_by, activo, created_at, updated_at
         FROM public.lamda_biblioteca_prompts
         WHERE activo = true${whereExtra}
         ORDER BY es_favorito DESC, usos_count DESC, id DESC`,
        params
    );

    let items = res.rows.map(r => ({
        ...r,
        id: Number(r.id),
        usos_count: Number(r.usos_count || 0),
        es_favorito: Boolean(r.es_favorito),
        regla_sin_envases: r.regla_sin_envases !== false
    }));

    if (terms.length > 0) {
        items = items.filter(it => {
            const bolsa = jh.normalizarClaveTexto([it.nombre, it.categoria, it.prompt_texto, it.preset_base].filter(Boolean).join(' '));
            return terms.every(t => bolsa.includes(t));
        });
    }

    return { items, total: items.length };
}

async function crearPromptGuardado(db, {
    nombre,
    categoria = 'GENERAL',
    prompt_texto,
    preset_base = 'libre',
    regla_sin_envases = true,
    es_favorito = false,
    created_by = null
} = {}) {
    const nomClean = String(nombre || '').trim().slice(0, 120);
    const txtClean = String(prompt_texto || '').trim().slice(0, 4000);
    if (!nomClean) {
        const err = new Error('El nombre del prompt es obligatorio.');
        err.statusCode = 400;
        throw err;
    }
    if (!txtClean) {
        const err = new Error('El texto del prompt es obligatorio.');
        err.statusCode = 400;
        throw err;
    }
    const catClean = String(categoria || 'GENERAL').trim().toUpperCase().slice(0, 40) || 'GENERAL';
    const presetClean = String(preset_base || 'libre').trim().slice(0, 40) || 'libre';

    const ins = await db.query(
        `INSERT INTO public.lamda_biblioteca_prompts (
            nombre, categoria, prompt_texto, preset_base, regla_sin_envases, es_favorito, created_by, activo
         ) VALUES ($1,$2,$3,$4,$5,$6,$7,true)
         RETURNING *`,
        [
            nomClean,
            catClean,
            txtClean,
            presetClean,
            regla_sin_envases !== false,
            Boolean(es_favorito),
            created_by ? String(created_by).trim().slice(0, 80) : null
        ]
    );
    return ins.rows[0];
}

async function actualizarPromptGuardado(db, id, {
    nombre,
    categoria,
    prompt_texto,
    preset_base,
    regla_sin_envases,
    es_favorito
} = {}) {
    const idNum = Number(id);
    if (!Number.isInteger(idNum) || idNum <= 0) {
        const err = new Error('ID de prompt inválido.');
        err.statusCode = 400;
        throw err;
    }

    const curRes = await db.query(
        `SELECT * FROM public.lamda_biblioteca_prompts WHERE id = $1 AND activo = true LIMIT 1`,
        [idNum]
    );
    if (curRes.rows.length === 0) {
        const err = new Error('Prompt guardado no encontrado.');
        err.statusCode = 404;
        throw err;
    }
    const cur = curRes.rows[0];

    const nomFinal = nombre !== undefined ? String(nombre || '').trim().slice(0, 120) : cur.nombre;
    const txtFinal = prompt_texto !== undefined ? String(prompt_texto || '').trim().slice(0, 4000) : cur.prompt_texto;
    if (!nomFinal || !txtFinal) {
        const err = new Error('Nombre y texto del prompt no pueden quedar vacíos.');
        err.statusCode = 400;
        throw err;
    }

    const catFinal = categoria !== undefined
        ? (String(categoria || 'GENERAL').trim().toUpperCase().slice(0, 40) || 'GENERAL')
        : cur.categoria;
    const presetFinal = preset_base !== undefined
        ? (String(preset_base || 'libre').trim().slice(0, 40) || 'libre')
        : cur.preset_base;
    const reglaFinal = regla_sin_envases !== undefined ? Boolean(regla_sin_envases) : cur.regla_sin_envases;
    const favFinal = es_favorito !== undefined ? Boolean(es_favorito) : cur.es_favorito;

    const upd = await db.query(
        `UPDATE public.lamda_biblioteca_prompts
         SET nombre = $2,
             categoria = $3,
             prompt_texto = $4,
             preset_base = $5,
             regla_sin_envases = $6,
             es_favorito = $7,
             updated_at = NOW()
         WHERE id = $1 AND activo = true
         RETURNING *`,
        [idNum, nomFinal, catFinal, txtFinal, presetFinal, reglaFinal, favFinal]
    );
    return upd.rows[0];
}

async function eliminarPromptGuardado(db, id) {
    const idNum = Number(id);
    if (!Number.isInteger(idNum) || idNum <= 0) {
        const err = new Error('ID de prompt inválido.');
        err.statusCode = 400;
        throw err;
    }
    const del = await db.query(
        `UPDATE public.lamda_biblioteca_prompts
         SET activo = false, updated_at = NOW()
         WHERE id = $1 AND activo = true
         RETURNING *`,
        [idNum]
    );
    if (del.rows.length === 0) {
        const err = new Error('Prompt guardado no encontrado o ya eliminado.');
        err.statusCode = 404;
        throw err;
    }
    return del.rows[0];
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
    REGLA_SIN_ENVASES_TXT,
    normalizarRutaSubrama,
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
    interpolarPromptGuardado,
    calcularFidelidadIngredientes,
    construirTextoFidelidadIngredientesPrompt,
    resolverFidelidadIngredientesParaDestino,
    normalizarImagenesReferencia,
    armarPromptYPartesGemini,
    generarPreviewImagenBaseIA,
    confirmarPreviewImagenBaseIA,
    listarPromptsGuardados,
    crearPromptGuardado,
    actualizarPromptGuardado,
    eliminarPromptGuardado,
    guardarFotoPropiaGrupoGestor
};
