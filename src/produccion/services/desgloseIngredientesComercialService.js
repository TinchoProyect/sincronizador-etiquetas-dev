'use strict';

/**
 * Motor Dinámico de Resolución Recursiva de "Contenido / Ingredientes" Comerciales
 * --------------------------------------------------------------------------------
 * - Recorre en tiempo real la cadena productiva real en PostgreSQL hacia atrás:
 *   Packs comerciales -> Fracciones -> Ingredientes simples intermedios ->
 *   Artículos Puente (Línea 3 Mixes) / Etapas encadenadas de Unidades Productivas y Pre-mezclas
 *   (Línea 6 Granolas, Línea 5 Barritas y futuras líneas elaboradas) -> Materias primas base.
 * - Descarta automáticamente envases, bolsas e insumos no alimenticios (`es_insumo = true`).
 * - Oculta por completo cantidades, pesos, porcentajes, mermas y costos.
 * - Simplifica nombres técnicos a nombres comerciales limpios deterministas y deduplica variantes.
 * - En Producción Titular (y jamás en Modo Laboratorio), sincroniza `ingredientes_comerciales.json`
 *   en el bucket público de Supabase Storage (`b2b_lotes_fotos`) para consumo instantáneo en Portal B2B.
 */

const dbDefault = require('../config/database');
const { normalizarStockComercial, esSkuPremezclaInterna } = require('../../shared/stockComercialHelper');

const BUCKET_B2B_PUBLIC = 'b2b_lotes_fotos';
const MANIFEST_FILENAME = 'ingredientes_comerciales.json';
const PROD_SUPABASE_ID = 'zysyxtbcvgswancxtpib';

// Micro-caché en memoria de corta vida (3 segundos) para evitar tormentas de queries simultáneas
// sin sacrificar actualización inmediata al modificar recetas o composiciones.
let _cacheCatalogo = null;
let _cacheTimestampMs = 0;
const CACHE_TTL_MS = 3000;

function invalidarCacheIngredientesComerciales() {
    _cacheCatalogo = null;
    _cacheTimestampMs = 0;
}

function esModoLaboratorioOSinCredencialesSupabase() {
    const dbName = String(process.env.DB_NAME || '').trim().toLowerCase();
    const flagLab = String(process.env.LAMDA_MODO_LABORATORIO || '').trim().toLowerCase();
    const modoLab = String(process.env.MODO_LABORATORIO || '').trim().toLowerCase();
    const flagNube = String(process.env.LAMDA_MODO_PRUEBA_NUBE || '').trim().toLowerCase();
    const safeRedirect = String(process.env.SAFE_DELIVERY_REDIRECT || '').trim().toLowerCase();
    const lamdaRole = String(process.env.LAMDA_ROLE || '').trim().toLowerCase();

    const isLab =
        dbName === 'etiquetas_pruebas' ||
        flagLab === 'true' || flagLab === '1' ||
        modoLab === 'true' || modoLab === '1';
    const isPruebaNube =
        flagNube === 'true' || flagNube === '1' ||
        safeRedirect === 'true' || safeRedirect === '1';
    const isStandbyBridge = lamdaRole === 'galpon_bridge_only';

    if (isLab || isPruebaNube || isStandbyBridge) {
        return true;
    }

    const supaUrl = String(process.env.SUPABASE_B2B_URL || '').trim();
    const supaKey = String(process.env.SUPABASE_B2B_SERVICE_KEY || '').trim();
    if (!supaUrl || !supaKey || supaUrl.includes('127.0.0.1') || supaKey === 'modo_laboratorio_desconectado') {
        return true;
    }

    if (dbName !== 'etiquetas' && supaUrl.toLowerCase().includes(PROD_SUPABASE_ID)) {
        return true;
    }

    return false;
}

function quitarAcentos(str = '') {
    return String(str || '')
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '');
}

function claveDeduplicacion(nombre = '') {
    return quitarAcentos(nombre)
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, ' ')
        .trim();
}

function esIngredienteNoAlimenticio(ingObj = null, nombreFallback = '', unidadMedida = '') {
    if (ingObj && ingObj.es_insumo === true) {
        return true;
    }

    const rawNombre = String((ingObj && ingObj.nombre) || nombreFallback || '').trim();
    if (!rawNombre) return true;

    const norm = quitarAcentos(rawNombre).toLowerCase().trim();

    // Descartar envases, bolsas, cajas, etiquetas, films y artículos de prueba internos
    if (/^(bolsa|bolsas|caja|cajas|envase|envases|etiqueta|etiquetas|cinta|film|stretch|pote|potes|frasco|frascos|bandeja|bandejas|precinto|pallet|separador)\b/.test(norm)) {
        return true;
    }
    if (/^(test\d*|prueba\s+duplicado)$/i.test(norm)) {
        return true;
    }

    const umNorm = quitarAcentos(unidadMedida || (ingObj && ingObj.unidad_medida) || '').toLowerCase().trim();
    if ((umNorm === 'unidad' || umNorm === 'unidades') && /\b(\d+\s*x\s*\d+|micrones|polietileno|cristal|kraft)\b/.test(norm)) {
        return true;
    }

    return false;
}

/**
 * Simplificador comercial determinista y tolerante a ingredientes futuros inéditos.
 * Elimina calibres, variedades botánicas internas, grados técnicos y sufijos de empaque,
 * respetando distinciones relevantes para el comprador (ej. Nuez pecán, Pasas rubias, Pasas de arándanos).
 */
function simplificarNombreComercialIngrediente(rawName = '') {
    let original = String(rawName || '').trim();
    if (!original) return '';

    // Limpiar aclaraciones entre paréntesis o corchetes de uso interno: (Simple), (Mix), (Para mix), etc.
    let limpio = original
        .replace(/\([^)]*\)/g, ' ')
        .replace(/\[[^\]]*\]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();

    const norm = quitarAcentos(limpio).toLowerCase();

    // 1. Avena (sin detallar instantánea, arrollada, fina, gruesa, mediana, tradicional)
    if (/^avena\b/.test(norm) && !/\b(harina|salvado|leche|bebida)\b/.test(norm)) {
        return 'Avena';
    }

    // 2. Aceite de coco y Miel
    if (/\baceite\s+(?:de\s+)?coco\b/.test(norm)) {
        return 'Aceite de coco';
    }
    if (/^miel\b/.test(norm)) {
        return 'Miel';
    }

    // 3. Nueces (Excepción explícita: Nuez pecán; preservar Nuez moscada si existiera)
    if (/\bpecan\b/.test(norm)) {
        return 'Nuez pecán';
    }
    if (/\bnuez\s+moscada\b/.test(norm)) {
        return 'Nuez moscada';
    }
    if (/^nue(?:z|ces)\b/.test(norm)) {
        return 'Nueces';
    }

    // 4. Almendras (sin calibres 25/27, Nonpareil, Carmel, Guara, pelada, partida, ramillada, etc.)
    if (/^almendras?\b/.test(norm) && !/\b(harina|leche|chocolate|banad[oa]|garrapinad[oa])\b/.test(norm)) {
        return 'Almendras';
    }

    // 5. Otros frutos secos habituales
    if (/^castanas?\s+(?:de\s+)?caju\b/.test(norm) || /^caju\b/.test(norm)) {
        return 'Castañas de cajú';
    }
    if (/^castanas?\s+(?:de\s+)?para\b/.test(norm)) {
        return 'Castañas de Pará';
    }
    if (/^avellanas?\b/.test(norm) && !/\b(pasta|crema|harina|chocolate)\b/.test(norm)) {
        return 'Avellanas';
    }
    if (/^mani(?:es)?\b/.test(norm) && !/\b(pasta|mantequilla|crema|chocolate|garrapinad[oa]|japones)\b/.test(norm)) {
        return 'Maní';
    }
    if (/^pistachos?\b/.test(norm)) {
        return 'Pistachos';
    }

    // 6. Maíz frito (sin detallar sabores específicos como barbacoa, queso, mostaza y miel)
    if (/^maiz\s+frito\b/.test(norm)) {
        return 'Maíz frito';
    }

    // 7. Semillas (plural limpio sin grados A/AA, partido, pelado, integral, etc.)
    if (/\b(?:semillas?\s+(?:de\s+)?)?girasol\b/.test(norm) && !/\baceite\b/.test(norm)) {
        return 'Semillas de girasol';
    }
    if (/\bsemillas?\s+(?:de\s+)?zapallo\b/.test(norm) || /^zapallo\s+pelad[oa]\b/.test(norm)) {
        return 'Semillas de zapallo';
    }
    if (/\b(?:semillas?\s+(?:de\s+)?)?chia\b/.test(norm)) {
        return 'Semillas de chía';
    }
    if (/\b(?:semillas?\s+(?:de\s+)?)?sesamo\b/.test(norm)) {
        return 'Semillas de sésamo';
    }
    if (/\b(?:semillas?\s+(?:de\s+)?)?lino\b/.test(norm)) {
        return 'Semillas de lino';
    }
    if (/\b(?:semillas?\s+(?:de\s+)?)?amapola\b/.test(norm)) {
        return 'Semillas de amapola';
    }
    const matchSemillaGenerica = norm.match(/^semillas?\s+(?:de\s+)?([a-z0-9]+)/);
    if (matchSemillaGenerica && matchSemillaGenerica[1]) {
        const baseSem = restaurarAcentosComunes(matchSemillaGenerica[1]);
        return `Semillas de ${baseSem.toLowerCase()}`;
    }

    // 8. Pasas, coco y frutas deshidratadas / glaseadas
    if (/\barandanos?\b/.test(norm)) {
        return 'Pasas de arándanos';
    }
    if (/\bpasas?\b.*\brubia/.test(norm) || /\buvas?\s+rubias?\b/.test(norm) || /\bsultanina\s+rubia\b/.test(norm)) {
        return 'Pasas de uva rubias';
    }
    if (/\bpasas?\s+(?:de\s+)?ciruelas?\b/.test(norm) || /^ciruelas?\b.*\b(?:pasas?|s\/carozo|sin\s+carozo|deshidratad|presidente|d\s*agen)\b/.test(norm)) {
        return 'Ciruelas pasas';
    }
    if (/^pasas?\b/.test(norm) || /\bpasas?\s+de\s+uvas?\b/.test(norm)) {
        return 'Pasas de uva';
    }
    if (/\bcoco\b.*\bescamas?\b/.test(norm)) {
        return 'Coco en escamas';
    }
    if (/\bcoco\b.*\brallado\b/.test(norm)) {
        return 'Coco rallado';
    }
    if (/\bchips?\s+(?:de\s+)?bananas?\b/.test(norm) || /\bbananas?\s+chips?\b/.test(norm)) {
        return 'Chips de banana';
    }
    if (/^anana\b/.test(norm)) {
        return 'Ananá';
    }
    if (/^papaya\b/.test(norm)) {
        return 'Papaya';
    }
    if (/^kiwi\b/.test(norm)) {
        return 'Kiwi';
    }
    if (/^naranja\b/.test(norm)) {
        return 'Naranja';
    }
    if (/^mango\b/.test(norm)) {
        return 'Mango';
    }
    if (/^datil(?:es)?\b/.test(norm)) {
        return 'Dátiles';
    }
    if (/^damascos?\b|^damazcos?\b/.test(norm)) {
        return 'Damascos';
    }
    if (/^higos?\b/.test(norm)) {
        return 'Higos';
    }

    // 9. Regla abierta para cualquier ingrediente futuro inédito:
    // Limpiar calibres, empaques, códigos de lote al final y adjetivos técnicos de proceso interno.
    let generico = limpio
        // Quitar presentaciones tipo "x 10kg", "10 x 1kg", "x 250g"
        .replace(/\b\d+\s*[xX]\s*\d+(?:[.,]\d+)?\s*(?:kg|kilos?|g|gr|gramos?|lt|l|ml|u|unid\w*)?\b/gi, ' ')
        .replace(/\b[xX]\s*\d+(?:[.,]\d+)?\s*(?:kg|kilos?|g|gr|gramos?|lt|l|ml)?\b/gi, ' ')
        // Quitar calibres tipo 25/27, 13-15, 50/60, W4, W320
        .replace(/\b\d{1,3}\s*[\/\-]\s*\d{1,3}\b/g, ' ')
        .replace(/\b[wW]\d{1,4}\b/g, ' ')
        // Quitar sufijos técnicos internos de depósito
        .replace(/\b(?:para\s+mix|extra\s+light|light|ligth|ambar|ámbar|chandler|nonpareil?|carmel|guara|franquette|criolla|mariposa|cuartillo|cuarto|media|enter[oa]s?|partid[oa]s?|pelad[oa]s?|repelad[oa]s?|ramillad[oa]s?|filetead[oa]s?|en\s+rodajas|en\s+cubos|en\s+tiras|multicolor|glasead[oa]s?|glsdo|neutr[oa]|s\/carozo|sin\s+carozo|c\/cascara|s\/cascara|calibre\s*\w*)\b/gi, ' ')
        // Quitar grados finales A / AA / AAA o números de partida sueltos al final ("Mani 2", "Zapallo A")
        .replace(/\s+(?:A|AA|AAA|AAAA|\d+)$/i, '')
        .replace(/\s+/g, ' ')
        .replace(/^[\s,\-\/]+|[\s,\-\/]+$/g, '')
        .trim();

    if (!generico) {
        generico = limpio;
    }

    generico = restaurarAcentosComunes(generico);
    return capitalizarFraseComercial(generico);
}

function restaurarAcentosComunes(texto = '') {
    const mapaPalabras = {
        mani: 'maní',
        caju: 'cajú',
        anana: 'ananá',
        arandano: 'arándano',
        arandanos: 'arándanos',
        sesamo: 'sésamo',
        chia: 'chía',
        maiz: 'maíz',
        pecan: 'pecán',
        datil: 'dátil',
        datiles: 'dátiles',
        azucar: 'azúcar',
        curcuma: 'cúrcuma',
        oregano: 'orégano',
        damazco: 'damasco',
        damazcos: 'damascos',
        semilla: 'semillas'
    };

    return String(texto || '')
        .split(/\s+/)
        .map((palabra) => {
            const clave = quitarAcentos(palabra).toLowerCase();
            return mapaPalabras[clave] || palabra.toLowerCase();
        })
        .join(' ');
}

function capitalizarFraseComercial(frase = '') {
    const limpia = String(frase || '').trim();
    if (!limpia) return '';
    return limpia.charAt(0).toUpperCase() + limpia.slice(1);
}

/**
 * Carga en una sola tanda ligera todas las relaciones del recetario y producción externa.
 */
async function cargarGrafoRecetario(runner = null) {
    const db = runner || dbDefault;

    const [
        articulosRes,
        recetasRes,
        recetaIngRes,
        recetaArtRes,
        ingredientesRes,
        composicionRes,
        bunkerIngVincRes,
        upRelRes
    ] = await Promise.all([
        db.query(`
            SELECT
                ba.articulo_id,
                COALESCE(ba.descripcion_generada, ba.descripcion, ba.articulo_id) AS descripcion_display,
                ba.descripcion,
                ba.descripcion_generada,
                ba.rubro,
                ba.sub_rubro,
                COALESCE(bf.nombre, '') AS familia_nombre,
                COALESCE(ba.es_pack, src.es_pack, false) AS es_pack,
                COALESCE(NULLIF(TRIM(ba.pack_hijo_codigo), ''), NULLIF(TRIM(src.pack_hijo_codigo), '')) AS pack_hijo_codigo,
                COALESCE(ba.pack_unidades, src.pack_unidades, 1) AS pack_unidades,
                COALESCE(ba.no_producido_por_lambda, false) AS no_producido_por_lambda
            FROM public.bunker_articulos ba
            LEFT JOIN public.bunker_familias bf ON bf.id = ba.familia_id
            LEFT JOIN public.stock_real_consolidado src ON UPPER(TRIM(src.articulo_numero)) = UPPER(TRIM(ba.articulo_id))
        `),
        db.query(`
            SELECT id, articulo_numero, descripcion, articulo_sugerido_numero, COALESCE(enlazado_externo, false) AS enlazado_externo
            FROM public.recetas
        `),
        db.query(`
            SELECT id, receta_id, ingrediente_id, nombre_ingrediente, unidad_medida, COALESCE(cantidad, 0) AS cantidad, fase_produccion
            FROM public.receta_ingredientes
            ORDER BY id ASC
        `),
        db.query(`
            SELECT id, receta_id, articulo_numero, COALESCE(cantidad, 1) AS cantidad
            FROM public.receta_articulos
            ORDER BY id ASC
        `),
        db.query(`
            SELECT id, codigo, nombre, unidad_medida, padre_id, articulo_vinculado_numero, COALESCE(es_insumo, false) AS es_insumo
            FROM public.ingredientes
        `),
        db.query(`
            SELECT mix_id, ingrediente_id, COALESCE(cantidad, 0) AS cantidad
            FROM public.ingrediente_composicion
            ORDER BY cantidad DESC, ingrediente_id ASC
        `),
        db.query(`
            SELECT ingrediente_id, bunker_articulo_id
            FROM public.ingrediente_bunker_articulos
        `).catch(() => ({ rows: [] })),
        db.query(`
            SELECT id, articulo_produccion_codigo, articulo_kilo_codigo, COALESCE(multiplicador_ingredientes, 1) AS multiplicador_ingredientes, ingredientes_custom
            FROM public.articulos_produccion_externa_relacion
        `).catch(() => ({ rows: [] }))
    ]);

    const articulosByUpper = new Map();
    for (const row of articulosRes.rows) {
        const cod = String(row.articulo_id || '').trim();
        if (!cod) continue;
        articulosByUpper.set(cod.toUpperCase(), row);
    }

    const ingredientesById = new Map();
    const ingredientesByNombreNorm = new Map();
    for (const row of ingredientesRes.rows) {
        const idNum = Number(row.id);
        ingredientesById.set(idNum, row);
        const nomKey = quitarAcentos(row.nombre || '').toLowerCase().trim();
        if (nomKey && !ingredientesByNombreNorm.has(nomKey)) {
            ingredientesByNombreNorm.set(nomKey, row);
        }
    }

    const composicionByMixId = new Map();
    for (const row of composicionRes.rows) {
        const mixId = Number(row.mix_id);
        if (!composicionByMixId.has(mixId)) composicionByMixId.set(mixId, []);
        composicionByMixId.get(mixId).push({
            ingrediente_id: Number(row.ingrediente_id),
            cantidad: Math.max(0, parseFloat(row.cantidad) || 0)
        });
    }

    const bunkerLinksByIngId = new Map();
    for (const row of bunkerIngVincRes.rows) {
        const ingId = Number(row.ingrediente_id);
        const cod = String(row.bunker_articulo_id || '').trim();
        if (!ingId || !cod) continue;
        if (!bunkerLinksByIngId.has(ingId)) bunkerLinksByIngId.set(ingId, []);
        bunkerLinksByIngId.get(ingId).push(cod);
    }

    const recetaIngByRecetaId = new Map();
    for (const row of recetaIngRes.rows) {
        const rid = Number(row.receta_id);
        if (!recetaIngByRecetaId.has(rid)) recetaIngByRecetaId.set(rid, []);
        recetaIngByRecetaId.get(rid).push({
            ingrediente_id: row.ingrediente_id ? Number(row.ingrediente_id) : null,
            nombre_ingrediente: row.nombre_ingrediente || '',
            unidad_medida: row.unidad_medida || '',
            cantidad: Math.max(0, parseFloat(row.cantidad) || 0),
            fase_produccion: row.fase_produccion || ''
        });
    }

    const recetaArtByRecetaId = new Map();
    for (const row of recetaArtRes.rows) {
        const rid = Number(row.receta_id);
        const cod = String(row.articulo_numero || '').trim();
        if (!rid || !cod) continue;
        if (!recetaArtByRecetaId.has(rid)) recetaArtByRecetaId.set(rid, []);
        recetaArtByRecetaId.get(rid).push({
            articulo_numero: cod,
            cantidad: Math.max(0, parseFloat(row.cantidad) || 1)
        });
    }

    const recetasByUpper = new Map();
    for (const row of recetasRes.rows) {
        const cod = String(row.articulo_numero || '').trim();
        if (!cod) continue;
        const rid = Number(row.id);
        recetasByUpper.set(cod.toUpperCase(), {
            id: rid,
            articulo_numero: cod,
            descripcion: row.descripcion || '',
            articulo_sugerido_numero: row.articulo_sugerido_numero ? String(row.articulo_sugerido_numero).trim() : null,
            enlazado_externo: Boolean(row.enlazado_externo),
            ingredientes: recetaIngByRecetaId.get(rid) || [],
            articulos: recetaArtByRecetaId.get(rid) || []
        });
    }

    const upRelByKiloUpper = new Map();
    const skusProduccionUpSet = new Set();
    const skusPremezclaConsumidosPorUpSet = new Set();

    for (const row of upRelRes.rows) {
        const prodCod = String(row.articulo_produccion_codigo || '').trim();
        const kiloCod = String(row.articulo_kilo_codigo || '').trim();
        if (prodCod) skusProduccionUpSet.add(prodCod.toUpperCase());
        if (kiloCod && prodCod && kiloCod.toUpperCase() !== prodCod.toUpperCase()) {
            upRelByKiloUpper.set(kiloCod.toUpperCase(), {
                articulo_produccion_codigo: prodCod,
                articulo_kilo_codigo: kiloCod,
                multiplicador_ingredientes: Math.max(0.0001, parseFloat(row.multiplicador_ingredientes) || 1),
                ingredientes_custom: Array.isArray(row.ingredientes_custom) ? row.ingredientes_custom : []
            });
        }
    }

    // Identificar estructuralmente pre-mezclas internas consumidas en recetas UP (ej. MPB, MPGDSX7, MPGDFX6,9)
    for (const prodUpper of skusProduccionUpSet) {
        const recUp = recetasByUpper.get(prodUpper);
        if (recUp && Array.isArray(recUp.articulos)) {
            for (const subArt of recUp.articulos) {
                const subUpper = String(subArt.articulo_numero || '').trim().toUpperCase();
                if (subUpper) {
                    skusPremezclaConsumidosPorUpSet.add(subUpper);
                }
            }
        }
    }

    return {
        articulosByUpper,
        ingredientesById,
        ingredientesByNombreNorm,
        composicionByMixId,
        bunkerLinksByIngId,
        recetasByUpper,
        upRelByKiloUpper,
        skusProduccionUpSet,
        skusPremezclaConsumidosPorUpSet
    };
}

/**
 * Crea un acumulador interno para resolver hojas alimenticias y metadatos estructurales de la cadena.
 * Nota: los pesos relativos acumulados se emplean únicamente para ordenar los ingredientes de mayor a menor
 * presencia real (estándar alimentario) y JAMÁS se exponen hacia afuera.
 */
function crearAcumulador() {
    return {
        pesosPorClave: new Map(), // claveDeduplicacion -> { nombreComercial, pesoRelativo, ordenAparicion }
        contadorAparicion: 0,
        usoComposicionMix: false,
        cruzoUpExterna: false,
        dobleEtapaUp: false
    };
}

function registrarHojaAlimenticia(acum, rawNombre, pesoRelativo = 1) {
    const nombreComercial = simplificarNombreComercialIngrediente(rawNombre);
    if (!nombreComercial) return;
    const clave = claveDeduplicacion(nombreComercial);
    if (!clave) return;

    const peso = Math.max(0.000001, Number(pesoRelativo) || 0.000001);
    const actual = acum.pesosPorClave.get(clave);
    if (actual) {
        actual.pesoRelativo += peso;
    } else {
        acum.contadorAparicion += 1;
        acum.pesosPorClave.set(clave, {
            nombreComercial,
            pesoRelativo: peso,
            ordenAparicion: acum.contadorAparicion
        });
    }
}

function fusionarSubAcumulador(destino, origen, adoptarFlagsUp = true) {
    for (const [clave, item] of origen.pesosPorClave.entries()) {
        const existente = destino.pesosPorClave.get(clave);
        if (existente) {
            existente.pesoRelativo += item.pesoRelativo;
        } else {
            destino.contadorAparicion += 1;
            destino.pesosPorClave.set(clave, {
                nombreComercial: item.nombreComercial,
                pesoRelativo: item.pesoRelativo,
                ordenAparicion: destino.contadorAparicion
            });
        }
    }
    if (origen.usoComposicionMix) destino.usoComposicionMix = true;
    if (adoptarFlagsUp) {
        if (origen.cruzoUpExterna) destino.cruzoUpExterna = true;
        if (origen.dobleEtapaUp) destino.dobleEtapaUp = true;
    }
}

function resolverDesdeIngrediente(grafo, ingObj, factorPeso, visitadosArt, visitadosIng, acum) {
    if (!ingObj) return;
    const ingId = Number(ingObj.id || 0);
    if (esIngredienteNoAlimenticio(ingObj, ingObj.nombre, ingObj.unidad_medida)) {
        return;
    }

    if (ingId > 0 && visitadosIng.has(ingId)) {
        registrarHojaAlimenticia(acum, ingObj.nombre, factorPeso);
        return;
    }

    const nextVisitadosIng = new Set(visitadosIng);
    if (ingId > 0) nextVisitadosIng.add(ingId);

    // 1. Si el ingrediente posee composición en `ingrediente_composicion` (Mix o Pre-Mezcla), expandir sus hijos
    const hijosMix = ingId > 0 ? (grafo.composicionByMixId.get(ingId) || []) : [];
    const hijosAlimenticios = hijosMix.filter((h) => {
        const subIng = grafo.ingredientesById.get(h.ingrediente_id);
        return subIng && !esIngredienteNoAlimenticio(subIng, subIng.nombre, subIng.unidad_medida);
    });

    if (hijosAlimenticios.length > 0) {
        acum.usoComposicionMix = true;
        const sumaCant = hijosAlimenticios.reduce((s, h) => s + (h.cantidad > 0 ? h.cantidad : 1), 0) || 1;
        for (const h of hijosAlimenticios) {
            const subIng = grafo.ingredientesById.get(h.ingrediente_id);
            const prop = (h.cantidad > 0 ? h.cantidad : 1) / sumaCant;
            resolverDesdeIngrediente(grafo, subIng, factorPeso * prop, visitadosArt, nextVisitadosIng, acum);
        }
        return;
    }

    // 2. Verificar si el ingrediente es un eslabón puente/intermedio vinculado a un artículo elaborado
    //    (ej. #149 Mix Con Pasas Simple -> MFSXK, #131 Grana Sol -> GSGNFX1, #141 Barrita -> BFX50G).
    //    Si el artículo vinculado es un simple bulto madre comprado (sin receta elaborada multi-ingrediente),
    //    se conserva el ingrediente actual como materia prima hoja.
    const candidatosCodigos = [];
    if (ingObj.articulo_vinculado_numero) {
        candidatosCodigos.push(String(ingObj.articulo_vinculado_numero).trim());
    }
    if (ingId > 0 && grafo.bunkerLinksByIngId.has(ingId)) {
        for (const c of grafo.bunkerLinksByIngId.get(ingId)) {
            if (!candidatosCodigos.some((x) => x.toUpperCase() === c.toUpperCase())) {
                candidatosCodigos.push(c);
            }
        }
    }

    for (const codCandidato of candidatosCodigos) {
        const codUpper = codCandidato.toUpperCase();
        if (!codUpper || visitadosArt.has(codUpper)) continue;

        const tieneRecetaOUp = grafo.recetasByUpper.has(codUpper) || grafo.upRelByKiloUpper.has(codUpper);
        if (!tieneRecetaOUp) continue;

        const subAcum = crearAcumulador();
        resolverDesdeArticulo(grafo, codCandidato, factorPeso, visitadosArt, nextVisitadosIng, subAcum);

        const expandioCompuesto =
            subAcum.usoComposicionMix ||
            subAcum.pesosPorClave.size >= 2;

        if (expandioCompuesto) {
            fusionarSubAcumulador(acum, subAcum, true);
            return;
        }
    }

    // 3. Materia prima alimenticia base (hoja)
    registrarHojaAlimenticia(acum, ingObj.nombre, factorPeso);
}

function resolverDesdeArticulo(grafo, codigoArticulo, factorPeso = 1, visitadosArt = new Set(), visitadosIng = new Set(), acum = crearAcumulador()) {
    const codUpper = String(codigoArticulo || '').trim().toUpperCase();
    if (!codUpper || /^TEST\d*$/i.test(codUpper) || visitadosArt.has(codUpper)) {
        return acum;
    }

    const nextVisitadosArt = new Set(visitadosArt);
    nextVisitadosArt.add(codUpper);

    const artRow = grafo.articulosByUpper.get(codUpper) || null;
    const receta = grafo.recetasByUpper.get(codUpper) || null;
    const upRel = grafo.upRelByKiloUpper.get(codUpper) || null;

    // A. Si el artículo es un Pack o apunta a un artículo hijo (ej. MFS10X300G -> MFSX300G, GDF5x1 -> GFGNFX1)
    const packHijo = artRow && artRow.pack_hijo_codigo ? String(artRow.pack_hijo_codigo).trim() : '';
    if (packHijo && packHijo.toUpperCase() !== codUpper && !nextVisitadosArt.has(packHijo.toUpperCase())) {
        const unidadesPack = Math.max(1, parseFloat(artRow.pack_unidades) || 1);
        resolverDesdeArticulo(grafo, packHijo, factorPeso * unidadesPack, nextVisitadosArt, visitadosIng, acum);
        if (acum.pesosPorClave.size > 0) {
            return acum;
        }
    }

    // B. Receta propia del artículo (ingredientes directos + sub-artículos de receta_articulos)
    let alimentoEnEtapaActual = false;
    if (receta) {
        if (receta.enlazado_externo) {
            acum.cruzoUpExterna = true;
        }

        const itemsAlimento = receta.ingredientes.filter((ri) => {
            const ing = ri.ingrediente_id
                ? grafo.ingredientesById.get(ri.ingrediente_id)
                : grafo.ingredientesByNombreNorm.get(quitarAcentos(ri.nombre_ingrediente).toLowerCase().trim());
            return !esIngredienteNoAlimenticio(ing, ri.nombre_ingrediente, ri.unidad_medida);
        });

        for (const ri of itemsAlimento) {
            alimentoEnEtapaActual = true;
            const ing = ri.ingrediente_id
                ? grafo.ingredientesById.get(ri.ingrediente_id)
                : grafo.ingredientesByNombreNorm.get(quitarAcentos(ri.nombre_ingrediente).toLowerCase().trim());
            const cant = ri.cantidad > 0 ? ri.cantidad : 1;

            if (ing) {
                resolverDesdeIngrediente(grafo, ing, factorPeso * cant, nextVisitadosArt, visitadosIng, acum);
            } else if (ri.nombre_ingrediente) {
                registrarHojaAlimenticia(acum, ri.nombre_ingrediente, factorPeso * cant);
            }
        }

        for (const ra of receta.articulos) {
            const subCod = String(ra.articulo_numero || '').trim();
            if (subCod && !nextVisitadosArt.has(subCod.toUpperCase())) {
                const cantArt = ra.cantidad > 0 ? ra.cantidad : 1;
                resolverDesdeArticulo(grafo, subCod, factorPeso * cantArt, nextVisitadosArt, visitadosIng, acum);
            }
        }

        // Respaldo por articulo_sugerido_numero si un eslabón intermedio aún no tenía composiciones resueltas
        if (acum.pesosPorClave.size <= 1 && receta.articulo_sugerido_numero) {
            const sugCod = receta.articulo_sugerido_numero;
            if (sugCod.toUpperCase() !== codUpper && !nextVisitadosArt.has(sugCod.toUpperCase())) {
                const subSug = crearAcumulador();
                resolverDesdeArticulo(grafo, sugCod, factorPeso, nextVisitadosArt, visitadosIng, subSug);
                if (subSug.pesosPorClave.size >= 2) {
                    acum.pesosPorClave.clear();
                    fusionarSubAcumulador(acum, subSug, true);
                }
            }
        }
    }

    // C. Encadenamiento de Unidad Productiva Externa (`articulos_produccion_externa_relacion`)
    //    Ej. GSGNFX1 -> GSGN (con multiplicador_ingredientes = 10) + MPGDSX7 -> Mezcla Grana de Sol
    if (upRel) {
        acum.cruzoUpExterna = true;

        // Si no había ingredientes en `receta_ingredientes` pero existen en `ingredientes_custom` JSONB, incorporarlos
        if (!alimentoEnEtapaActual && Array.isArray(upRel.ingredientes_custom) && upRel.ingredientes_custom.length > 0) {
            for (const ic of upRel.ingredientes_custom) {
                const ing = ic.ingrediente_id
                    ? grafo.ingredientesById.get(Number(ic.ingrediente_id))
                    : grafo.ingredientesByNombreNorm.get(quitarAcentos(ic.nombre_ingrediente || '').toLowerCase().trim());
                if (!esIngredienteNoAlimenticio(ing, ic.nombre_ingrediente, ic.unidad_medida)) {
                    alimentoEnEtapaActual = true;
                    const cant = Math.max(0.001, parseFloat(ic.cantidad) || 0.1);
                    if (ing) {
                        resolverDesdeIngrediente(grafo, ing, factorPeso * cant, nextVisitadosArt, visitadosIng, acum);
                    } else if (ic.nombre_ingrediente) {
                        registrarHojaAlimenticia(acum, ic.nombre_ingrediente, factorPeso * cant);
                    }
                }
            }
        }

        const subUpAcum = crearAcumulador();
        const factorLoteUp = factorPeso / (upRel.multiplicador_ingredientes || 1);
        resolverDesdeArticulo(
            grafo,
            upRel.articulo_produccion_codigo,
            factorLoteUp,
            nextVisitadosArt,
            visitadosIng,
            subUpAcum
        );

        if (alimentoEnEtapaActual && subUpAcum.pesosPorClave.size > 0) {
            acum.dobleEtapaUp = true;
        }
        fusionarSubAcumulador(acum, subUpAcum, true);
    }

    return acum;
}

function extraerListaOrdenadaLimpia(acum) {
    return Array.from(acum.pesosPorClave.values())
        .sort((a, b) => {
            if (Math.abs(b.pesoRelativo - a.pesoRelativo) > 1e-6) {
                return b.pesoRelativo - a.pesoRelativo;
            }
            return a.ordenAparicion - b.ordenAparicion;
        })
        .map((it) => it.nombreComercial);
}

function esSkuIntermedioInterno(grafo, codUpper, artRow) {
    if (!artRow) return false;
    const famNorm = quitarAcentos(artRow.familia_nombre || '').toLowerCase().trim();
    const descNorm = quitarAcentos(artRow.descripcion_display || '').toLowerCase().trim();

    if (famNorm === 'produccion') return true;
    if (/^prod\s+(ap|up)\b/.test(descNorm)) return true;
    if (grafo.skusProduccionUpSet.has(codUpper)) return true;
    if (grafo.skusPremezclaConsumidosPorUpSet.has(codUpper)) return true;

    return false;
}

function clasificarLineaNegocioElaborada(acum) {
    if (acum.cruzoUpExterna && acum.dobleEtapaUp) {
        return { linea_negocio: 6, linea_etiqueta: 'Granola' };
    }
    if (acum.cruzoUpExterna) {
        return { linea_negocio: 5, linea_etiqueta: 'Elaborado UP' };
    }
    if (acum.usoComposicionMix) {
        return { linea_negocio: 3, linea_etiqueta: 'Mix' };
    }
    return { linea_negocio: 3, linea_etiqueta: 'Elaborado' };
}

/**
 * Construye el catálogo completo de artículos elaborados con su listado comercial limpio de ingredientes
 * (sin cantidades, sin porcentajes, sin mermas y sin costos).
 */
async function construirCatalogoIngredientesComerciales(runner = null, opciones = {}) {
    const usarCache = !runner && opciones.forzarRecalculo !== true;
    const ahora = Date.now();
    if (usarCache && _cacheCatalogo && (ahora - _cacheTimestampMs) < CACHE_TTL_MS) {
        return _cacheCatalogo;
    }

    const grafo = await cargarGrafoRecetario(runner);
    const items = {};
    const itemsPorIngredienteId = {};

    for (const [codUpper, artRow] of grafo.articulosByUpper.entries()) {
        if (artRow.no_producido_por_lambda === true) continue;
        if (esSkuIntermedioInterno(grafo, codUpper, artRow)) continue;

        const acum = resolverDesdeArticulo(grafo, artRow.articulo_id, 1, new Set(), new Set(), crearAcumulador());
        if (acum.pesosPorClave.size < 2) continue;

        const ingredientesLimpios = extraerListaOrdenadaLimpia(acum);
        if (ingredientesLimpios.length < 2) continue;

        const { linea_negocio, linea_etiqueta } = clasificarLineaNegocioElaborada(acum);
        const skuExacto = String(artRow.articulo_id).trim();

        items[skuExacto] = {
            codigo: skuExacto,
            linea_negocio,
            linea_etiqueta,
            ingredientes: ingredientesLimpios
        };
    }

    // También indexar por ingrediente_id compuesto/puente para resolución directa en Nodos Barriales
    // (incluso cuando una fracción vecinal apunte a `ingrediente_origen_id` sin SKU propio o nuevo).
    for (const [ingId, ingRow] of grafo.ingredientesById.entries()) {
        if (esIngredienteNoAlimenticio(ingRow, ingRow.nombre, ingRow.unidad_medida)) continue;
        const acumIng = crearAcumulador();
        resolverDesdeIngrediente(grafo, ingRow, 1, new Set(), new Set(), acumIng);
        if (acumIng.pesosPorClave.size < 2) continue;

        const ingredientesLimpios = extraerListaOrdenadaLimpia(acumIng);
        if (ingredientesLimpios.length < 2) continue;

        const { linea_negocio, linea_etiqueta } = clasificarLineaNegocioElaborada(acumIng);
        itemsPorIngredienteId[ingId] = {
            ingrediente_id: ingId,
            linea_negocio,
            linea_etiqueta,
            ingredientes: ingredientesLimpios
        };
    }

    const resultado = {
        updated_at: new Date().toISOString(),
        total_articulos: Object.keys(items).length,
        items,
        por_ingrediente_id: itemsPorIngredienteId
    };

    if (!runner) {
        _cacheCatalogo = resultado;
        _cacheTimestampMs = Date.now();
    }

    return resultado;
}

/**
 * Resuelve el desglose comercial limpio para un artículo específico (por código SKU y/o ingrediente_origen_id),
 * tolerando diferencias de mayúsculas/minúsculas.
 */
async function obtenerDesgloseIngredientesParaItem(params = {}, catalogoPrecalculado = null, runner = null) {
    const cat = catalogoPrecalculado || await construirCatalogoIngredientesComerciales(runner);
    const itemsObj = cat.items || {};
    const porIngObj = cat.por_ingrediente_id || {};

    const candidatosSku = [
        params.articulo_codigo,
        params.sku_nodo,
        params.articulo_bunker_origen_codigo
    ]
        .map((s) => String(s || '').trim())
        .filter(Boolean);

    for (const sku of candidatosSku) {
        if (itemsObj[sku]) return itemsObj[sku];
        const skuUpper = sku.toUpperCase();
        const matchKey = Object.keys(itemsObj).find((k) => k.toUpperCase() === skuUpper);
        if (matchKey) return itemsObj[matchKey];
    }

    const ingId = Number(params.ingrediente_id || params.ingrediente_origen_id || 0);
    if (ingId > 0 && porIngObj[ingId]) {
        return porIngObj[ingId];
    }

    return null;
}

/**
 * Publica `ingredientes_comerciales.json` en Supabase Storage (`b2b_lotes_fotos`) únicamente en Producción Titular.
 * En Modo Laboratorio corta inmediatamente sin contactar jamás a Supabase.
 */
async function sincronizarManifestIngredientesB2B(runner = null) {
    invalidarCacheIngredientesComerciales();

    if (esModoLaboratorioOSinCredencialesSupabase()) {
        return { ok: true, skipped_lab: true };
    }

    const supaUrl = String(process.env.SUPABASE_B2B_URL || '').trim().replace(/\/+$/, '');
    const supaKey = String(process.env.SUPABASE_B2B_SERVICE_KEY || '').trim();
    if (!supaUrl || !supaKey) {
        return { ok: false, skipped: true };
    }

    try {
        const catalogo = await construirCatalogoIngredientesComerciales(runner, { forzarRecalculo: true });
        // Publicar solo las líneas comerciales del Portal B2B ( sin exponer IDs internos de ingredientes )
        const payloadPublico = {
            updated_at: catalogo.updated_at,
            total_articulos: catalogo.total_articulos,
            items: catalogo.items
        };

        const targetUrl = `${supaUrl}/storage/v1/object/${BUCKET_B2B_PUBLIC}/${MANIFEST_FILENAME}`;
        const resp = await fetch(targetUrl, {
            method: 'POST',
            headers: {
                apikey: supaKey,
                Authorization: `Bearer ${supaKey}`,
                'Content-Type': 'application/json',
                'x-upsert': 'true',
                'Cache-Control': 'no-cache, no-store, must-revalidate'
            },
            body: JSON.stringify(payloadPublico)
        });

        if (!resp.ok) {
            const errTxt = await resp.text().catch(() => '');
            console.warn(`⚠️ [INGREDIENTES-B2B] Respuesta HTTP ${resp.status} al subir ${MANIFEST_FILENAME}: ${errTxt}`);
            return { ok: false, status: resp.status };
        }

        console.log(`🥣 [INGREDIENTES-B2B] Manifest comercial sincronizado en tiempo real (${catalogo.total_articulos} artículos compuestos).`);
        return { ok: true, total_articulos: catalogo.total_articulos };
    } catch (err) {
        console.warn('⚠️ [INGREDIENTES-B2B] Error al sincronizar manifest en Supabase Storage:', err.message);
        return { ok: false, error: err.message };
    }
}

/**
 * Construye en tiempo real desde la base local `etiquetas_pruebas` el catálogo de precios
 * y jerarquía de 5 niveles del Portal B2B exclusivamente para vista directa en Modo Laboratorio (localhost),
 * sin requerir login externo ni tocar sesiones/dispositivos de clientes en Supabase productivo.
 */
async function construirCatalogoPreviewB2BLaboratorio(runner = null) {
    const queryRunner = runner || dbDefault;
    const catIng = await construirCatalogoIngredientesComerciales(queryRunner);
    const mapaIngredientesUpper = new Map();
    for (const [skuKey, info] of Object.entries(catIng.items || {})) {
        mapaIngredientesUpper.set(String(skuKey).trim().toUpperCase(), info);
    }

    let jerarquiaMap = new Map();
    try {
        const jerRes = await queryRunner.query(`
            SELECT familia_id, articulo_principal, eje_nivel_3, reglas_nivel_4, reglas_nivel_5
            FROM public.bunker_portal_b2b_jerarquia
            WHERE eje_nivel_3 IS NOT NULL AND TRIM(eje_nivel_3) <> ''
        `);
        for (const jRow of jerRes.rows) {
            const famId = jRow.familia_id !== null && jRow.familia_id !== undefined ? jRow.familia_id : 0;
            const artP = String(jRow.articulo_principal || '').trim().toLowerCase();
            const rawEjeN3 = jRow.eje_nivel_3 ? String(jRow.eje_nivel_3).trim().toLowerCase() : '';
            const ejesN3 = rawEjeN3 ? rawEjeN3.split(',').map(s => s.trim()).filter(Boolean) : [];
            jerarquiaMap.set(`${famId}___${artP}`, {
                eje_nivel_3: rawEjeN3,
                ejes_nivel_3: ejesN3,
                reglas_nivel_4: jRow.reglas_nivel_4 && typeof jRow.reglas_nivel_4 === 'object' ? jRow.reglas_nivel_4 : {},
                reglas_nivel_5: jRow.reglas_nivel_5 && typeof jRow.reglas_nivel_5 === 'object' ? jRow.reglas_nivel_5 : {}
            });
        }
    } catch (_) {
        jerarquiaMap = new Map();
    }

    const resLocal = await queryRunner.query(`
        SELECT
            la.lista_id,
            COALESCE(bl.es_patron, false) AS es_lista_patron,
            la.articulo_numero AS producto_codigo,
            COALESCE(ba.descripcion_generada, ba.descripcion, sc.descripcion, la.articulo_numero) AS producto_descripcion,
            la.precio_final,
            la.iva AS lista_iva_porcentaje,
            ba.porcentaje_iva AS real_iva_porcentaje,
            COALESCE(sc.stock_consolidado, 0) AS stock_disponible,
            COALESCE(ba.kilos_unidad, sc.kilos_unidad, 1.0) AS kilos_unidad,
            ba.familia_id,
            ba.rubro,
            ba.sub_rubro,
            bf.nombre AS familia_nombre,
            ba.propiedades_dinamicas
        FROM public.bunker_lista_articulos la
        LEFT JOIN public.bunker_listas_precios bl ON bl.id = la.lista_id
        LEFT JOIN public.bunker_articulos ba ON ba.articulo_id = la.articulo_numero
        LEFT JOIN public.bunker_familias bf ON bf.id = ba.familia_id
        LEFT JOIN public.stock_real_consolidado sc ON sc.articulo_numero = la.articulo_numero
        WHERE la.disponible = true AND la.precio_final > 0
        ORDER BY COALESCE(bl.es_patron, false) DESC, la.lista_id ASC, producto_descripcion ASC
    `).catch(async () => {
        return queryRunner.query(`
            SELECT
                la.lista_id,
                false AS es_lista_patron,
                la.articulo_numero AS producto_codigo,
                COALESCE(ba.descripcion_generada, ba.descripcion, sc.descripcion, la.articulo_numero) AS producto_descripcion,
                la.precio_final,
                la.iva AS lista_iva_porcentaje,
                ba.porcentaje_iva AS real_iva_porcentaje,
                COALESCE(sc.stock_consolidado, 0) AS stock_disponible,
                COALESCE(ba.kilos_unidad, sc.kilos_unidad, 1.0) AS kilos_unidad,
                ba.familia_id,
                ba.rubro,
                ba.sub_rubro,
                bf.nombre AS familia_nombre,
                ba.propiedades_dinamicas
            FROM public.bunker_lista_articulos la
            LEFT JOIN public.bunker_articulos ba ON ba.articulo_id = la.articulo_numero
            LEFT JOIN public.bunker_familias bf ON bf.id = ba.familia_id
            LEFT JOIN public.stock_real_consolidado sc ON sc.articulo_numero = la.articulo_numero
            WHERE la.disponible = true AND la.precio_final > 0
            ORDER BY la.lista_id ASC, producto_descripcion ASC
        `);
    });

    const mapUnicos = new Map();
    const listasSet = new Set();

    for (const row of resLocal.rows) {
        const codigo = String(row.producto_codigo || '').trim();
        if (!codigo) continue;
        if (esSkuPremezclaInterna(row)) continue;
        listasSet.add(Number(row.lista_id));
        if (mapUnicos.has(codigo)) continue;

        let props = row.propiedades_dinamicas;
        if (props && typeof props === 'string') {
            try { props = JSON.parse(props); } catch (_) { props = null; }
        }

        let familia = row.familia_nombre ? String(row.familia_nombre).trim() : (row.rubro ? String(row.rubro).trim() : 'General');
        if (!familia) familia = 'General';

        let articuloPrincipal = null;
        if (props && props.articulo_principal) {
            const rawArtPrinc = props.articulo_principal;
            articuloPrincipal = (typeof rawArtPrinc === 'object' && rawArtPrinc.valor)
                ? String(rawArtPrinc.valor).trim()
                : String(rawArtPrinc).trim();
        }
        if (!articuloPrincipal && row.sub_rubro) articuloPrincipal = String(row.sub_rubro).trim();
        if (!articuloPrincipal && row.producto_descripcion) articuloPrincipal = String(row.producto_descripcion).trim();
        if (!articuloPrincipal) articuloPrincipal = 'General';

        let subCategoria = null;
        let subSubCategoria = null;
        let subSubSubCategoria = null;
        const famId = row.familia_id || 0;
        const confRule = jerarquiaMap.get(`${famId}___${articuloPrincipal.toLowerCase()}`) || null;

        if (confRule && props && typeof props === 'object') {
            const posObj = props.posiciones || props;
            const targetEjesN3 = Array.isArray(confRule.ejes_nivel_3) && confRule.ejes_nivel_3.length > 0
                ? confRule.ejes_nivel_3
                : (confRule.eje_nivel_3 ? [confRule.eje_nivel_3] : []);
            for (const targetEjeN3 of targetEjesN3) {
                for (const k of Object.keys(posObj)) {
                    const p = posObj[k];
                    if (p && typeof p === 'object' && p.eje && String(p.eje).trim().toLowerCase() === targetEjeN3 && p.valor) {
                        subCategoria = String(p.valor).trim();
                        break;
                    }
                }
                if (subCategoria) break;
            }
            if (subCategoria && confRule.reglas_nivel_4 && confRule.reglas_nivel_4[subCategoria]) {
                const rawE4 = confRule.reglas_nivel_4[subCategoria];
                const ejes4 = Array.isArray(rawE4) ? rawE4 : String(rawE4).split(',');
                for (const ej of ejes4.map(s => String(s).trim().toLowerCase()).filter(Boolean)) {
                    for (const k of Object.keys(posObj)) {
                        const p = posObj[k];
                        if (p && typeof p === 'object' && p.eje && String(p.eje).trim().toLowerCase() === ej && p.valor) {
                            subSubCategoria = String(p.valor).trim();
                            break;
                        }
                    }
                    if (subSubCategoria) break;
                }
            }
            if (subCategoria && subSubCategoria && confRule.reglas_nivel_5) {
                const rawE5 = confRule.reglas_nivel_5[`${subCategoria}___${subSubCategoria}`];
                if (rawE5) {
                    const ejes5 = Array.isArray(rawE5) ? rawE5 : String(rawE5).split(',');
                    for (const ej of ejes5.map(s => String(s).trim().toLowerCase()).filter(Boolean)) {
                        for (const k of Object.keys(posObj)) {
                            const p = posObj[k];
                            if (p && typeof p === 'object' && p.eje && String(p.eje).trim().toLowerCase() === ej && p.valor) {
                                subSubSubCategoria = String(p.valor).trim();
                                break;
                            }
                        }
                        if (subSubSubCategoria) break;
                    }
                }
            }
        }

        const parts = [codigo, String(row.producto_descripcion || '').trim(), familia, articuloPrincipal];
        if (subCategoria) parts.push(subCategoria);
        if (subSubCategoria) parts.push(subSubCategoria);
        if (subSubSubCategoria) parts.push(subSubSubCategoria);
        if (row.rubro) parts.push(String(row.rubro).trim());
        if (row.sub_rubro) parts.push(String(row.sub_rubro).trim());

        const infoIng = mapaIngredientesUpper.get(codigo.toUpperCase()) || null;
        if (infoIng && Array.isArray(infoIng.ingredientes) && infoIng.ingredientes.length >= 2) {
            parts.push(infoIng.ingredientes.join(' '));
            if ([3, 5, 6].includes(Number(infoIng.linea_negocio))) {
                parts.push(`__ING_L${infoIng.linea_negocio}:${infoIng.ingredientes.join('|')}__`);
            }
        }

        const listaIva = parseFloat(row.lista_iva_porcentaje || 0);
        const realIva = row.real_iva_porcentaje !== null && row.real_iva_porcentaje !== undefined
            ? parseFloat(row.real_iva_porcentaje)
            : 21.0;
        let precioFinal = parseFloat(row.precio_final || 0);
        if (listaIva > 0 && Math.abs(listaIva - realIva) > 0.01) {
            precioFinal = Math.round(((precioFinal / (1 + listaIva / 100)) * (1 + realIva / 100)) * 100) / 100;
        }
        const kilosUnidad = parseFloat(row.kilos_unidad) > 0 ? parseFloat(row.kilos_unidad) : 1.0;
        const precioKilo = Math.round((precioFinal / kilosUnidad) * 100) / 100;
        const ivaPorcentaje = realIva > 0 ? realIva : 21.0;
        const precioNeto = Math.round((precioFinal / (1 + ivaPorcentaje / 100)) * 100) / 100;
        const precioKiloNeto = Math.round((precioKilo / (1 + ivaPorcentaje / 100)) * 100) / 100;
        const stockFisico = normalizarStockComercial(row.stock_disponible || 0);

        mapUnicos.set(codigo, {
            lista_id: Number(row.lista_id),
            producto_codigo: codigo,
            producto_descripcion: String(row.producto_descripcion || codigo).trim(),
            precio_final: precioFinal,
            kilos_unidad: kilosUnidad,
            precio_kilo: precioKilo,
            iva_porcentaje: ivaPorcentaje,
            precio_neto: precioNeto,
            precio_kilo_neto: precioKiloNeto,
            stock_disponible: stockFisico > 0 ? stockFisico : 12,
            stock_estado: 'disponible',
            familia,
            articulo_principal: articuloPrincipal,
            sub_categoria: subCategoria,
            sub_sub_categoria: subSubCategoria,
            sub_sub_sub_categoria: subSubSubCategoria,
            rubro: row.rubro ? String(row.rubro).trim() : null,
            sub_rubro: row.sub_rubro ? String(row.sub_rubro).trim() : null,
            busqueda_metadata: parts.filter(Boolean).join(' ').replace(/\s+/g, ' ').trim()
        });
    }

    return {
        ok: true,
        updated_at: catIng.updated_at,
        listas_ids: Array.from(listasSet),
        total_catalogo: mapUnicos.size,
        catalogo: Array.from(mapUnicos.values()),
        ingredientes_items: catIng.items
    };
}

module.exports = {
    simplificarNombreComercialIngrediente,
    construirCatalogoIngredientesComerciales,
    construirCatalogoPreviewB2BLaboratorio,
    obtenerDesgloseIngredientesParaItem,
    sincronizarManifestIngredientesB2B,
    invalidarCacheIngredientesComerciales
};
