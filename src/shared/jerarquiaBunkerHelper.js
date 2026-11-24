'use strict';

const crypto = require('crypto');

const CACHE_TTL_MS = 60 * 1000;
let _cacheJerarquia = {
    mapa: null,
    fetchedAt: 0
};

function normalizarClaveTexto(txt) {
    return String(txt || '')
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .toLowerCase()
        .replace(/\s+/g, ' ')
        .trim();
}

function normalizarSlugSafe(txt, fallback = 'item') {
    const clean = normalizarClaveTexto(txt)
        .replace(/[^a-z0-9]+/g, '_')
        .replace(/^_+|_+$/g, '');
    return clean || fallback;
}

function parsearListaEjes(raw) {
    if (!raw) return [];
    if (Array.isArray(raw)) {
        return raw.map(s => String(s || '').trim().toLowerCase()).filter(Boolean);
    }
    return String(raw)
        .split(',')
        .map(s => s.trim().toLowerCase())
        .filter(Boolean);
}

function parsearPropiedadesDinamicas(rawProps) {
    if (!rawProps) return {};
    if (typeof rawProps === 'string') {
        try {
            const parsed = JSON.parse(rawProps);
            return (parsed && typeof parsed === 'object') ? parsed : {};
        } catch (_) {
            return {};
        }
    }
    return (typeof rawProps === 'object') ? rawProps : {};
}

function extraerMapaPosiciones(rawProps) {
    const props = parsearPropiedadesDinamicas(rawProps);
    const posObj = (props.posiciones && typeof props.posiciones === 'object' && !Array.isArray(props.posiciones))
        ? props.posiciones
        : props;
    const ejeValores = new Map();
    const listaCanonica = [];

    for (const key of Object.keys(posObj)) {
        if (!key) continue;
        if (
            key.startsWith('asistente_') ||
            key.startsWith('rendimiento_') ||
            key.startsWith('tostadero_') ||
            key.startsWith('_meta') ||
            key === 'articulo_principal' ||
            key === 'familia_nombre' ||
            key === 'codigo_barras_local' ||
            key === 'presentacion_etiqueta_nodo'
        ) {
            continue;
        }
        const entry = posObj[key];
        if (!entry || typeof entry !== 'object') continue;
        const eje = String(entry.eje || '').trim().toLowerCase();
        const valor = entry.valor !== undefined && entry.valor !== null ? String(entry.valor).trim() : '';
        if (!eje || !valor) continue;
        if (!ejeValores.has(eje)) {
            ejeValores.set(eje, valor);
        }
    }

    for (const eje of Array.from(ejeValores.keys()).sort()) {
        listaCanonica.push([eje, normalizarClaveTexto(ejeValores.get(eje))]);
    }

    return { props, ejeValores, listaCanonica };
}

function buscarValorEnReglaObjeto(reglaObj, keyBuscada) {
    if (!reglaObj || typeof reglaObj !== 'object' || !keyBuscada) return null;
    if (Object.prototype.hasOwnProperty.call(reglaObj, keyBuscada) && reglaObj[keyBuscada]) {
        return reglaObj[keyBuscada];
    }
    const targetNorm = normalizarClaveTexto(keyBuscada);
    for (const k of Object.keys(reglaObj)) {
        if (normalizarClaveTexto(k) === targetNorm && reglaObj[k]) {
            return reglaObj[k];
        }
    }
    return null;
}

function invalidarCacheJerarquiaB2B() {
    _cacheJerarquia.mapa = null;
    _cacheJerarquia.fetchedAt = 0;
}

async function cargarMapaJerarquiaB2B(db, { forceRefresh = false } = {}) {
    const ahora = Date.now();
    if (!forceRefresh && _cacheJerarquia.mapa && (ahora - _cacheJerarquia.fetchedAt) < CACHE_TTL_MS) {
        return _cacheJerarquia.mapa;
    }

    const res = await db.query(`
        SELECT id, familia_id, articulo_principal, eje_nivel_3, reglas_nivel_4, reglas_nivel_5
        FROM public.bunker_portal_b2b_jerarquia
    `);

    const mapa = new Map();
    for (const row of res.rows) {
        const famId = Number(row.familia_id || 0);
        const artP = normalizarClaveTexto(row.articulo_principal);
        if (!artP) continue;
        const ejesN3 = parsearListaEjes(row.eje_nivel_3);
        const reglasN4 = (row.reglas_nivel_4 && typeof row.reglas_nivel_4 === 'object') ? row.reglas_nivel_4 : {};
        const reglasN5 = (row.reglas_nivel_5 && typeof row.reglas_nivel_5 === 'object') ? row.reglas_nivel_5 : {};
        const payload = {
            id: Number(row.id),
            familia_id: famId,
            articulo_principal: String(row.articulo_principal || '').trim(),
            eje_nivel_3: String(row.eje_nivel_3 || '').trim().toLowerCase(),
            ejes_nivel_3: ejesN3,
            reglas_nivel_4: reglasN4,
            reglas_nivel_5: reglasN5
        };
        mapa.set(`${famId}::${artP}`, payload);
        mapa.set(`0::${artP}`, mapa.get(`0::${artP}`) || payload);
    }

    _cacheJerarquia.mapa = mapa;
    _cacheJerarquia.fetchedAt = ahora;
    return mapa;
}

function resolverJerarquiaArticuloBunker(art = {}, mapaJerarquia = null) {
    const { props, ejeValores, listaCanonica } = extraerMapaPosiciones(
        art.bunker_propiedades_dinamicas ?? art.propiedades_dinamicas
    );

    const famId = Number(art.bunker_familia_id ?? art.familia_bunker_id ?? art.familia_id ?? 0) || 0;
    const rawFamNombre = String(
        art.familia_nombre ??
        art.bunker_familia_nombre ??
        art.categoria_oficial_lamda ??
        art.familia_bunker_nombre ??
        art.categoria_familiar ??
        art.bunker_rubro ??
        'Almacén'
    ).trim() || 'Almacén';

    const artPrincipal = String(
        props.articulo_principal ||
        art.articulo_principal_bunker ||
        art.articulo_principal ||
        art.bunker_descripcion ||
        art.descripcion ||
        ''
    ).trim();

    let subCategoria = null;
    let subSubCategoria = null;
    let subSubSubCategoria = null;

    if (mapaJerarquia && artPrincipal) {
        const artKey = normalizarClaveTexto(artPrincipal);
        const rule = mapaJerarquia.get(`${famId}::${artKey}`) || mapaJerarquia.get(`0::${artKey}`) || null;

        if (rule) {
            const ejesN3 = Array.isArray(rule.ejes_nivel_3) ? rule.ejes_nivel_3 : parsearListaEjes(rule.eje_nivel_3);
            for (const ejeN3 of ejesN3) {
                const v = ejeValores.get(ejeN3);
                if (v) {
                    subCategoria = v;
                    break;
                }
            }

            if (subCategoria && rule.reglas_nivel_4) {
                const rawEjeN4 = buscarValorEnReglaObjeto(rule.reglas_nivel_4, subCategoria);
                const ejesN4 = parsearListaEjes(rawEjeN4);
                for (const ejeN4 of ejesN4) {
                    const v = ejeValores.get(ejeN4);
                    if (v) {
                        subSubCategoria = v;
                        break;
                    }
                }
            }

            if (subCategoria && subSubCategoria && rule.reglas_nivel_5) {
                const rawEjeN5 = buscarValorEnReglaObjeto(rule.reglas_nivel_5, `${subCategoria}___${subSubCategoria}`);
                const ejesN5 = parsearListaEjes(rawEjeN5);
                for (const ejeN5 of ejesN5) {
                    const v = ejeValores.get(ejeN5);
                    if (v) {
                        subSubSubCategoria = v;
                        break;
                    }
                }
            }
        }
    }

    const nivelesBrutos = [
        rawFamNombre,
        artPrincipal || null,
        subCategoria,
        subSubCategoria,
        subSubSubCategoria
    ].filter(v => v && String(v).trim() !== '');

    // Compactar niveles homónimos consecutivos (ej: Cereales > Granolas > Granolas > Sol => Cereales > Granolas > Sol)
    const rutaCompacta = [];
    for (const lvl of nivelesBrutos) {
        const clean = String(lvl).trim();
        const norm = normalizarClaveTexto(clean);
        if (rutaCompacta.length === 0 || normalizarClaveTexto(rutaCompacta[rutaCompacta.length - 1]) !== norm) {
            rutaCompacta.push(clean);
        }
    }

    return {
        familia_id: famId,
        familia_nombre: rawFamNombre,
        articulo_principal: artPrincipal || null,
        sub_categoria: subCategoria,
        sub_sub_categoria: subSubCategoria,
        sub_sub_sub_categoria: subSubSubCategoria,
        ruta_jerarquica: nivelesBrutos,
        ruta_compacta: rutaCompacta,
        eje_valores: Object.fromEntries(ejeValores),
        firma_atributos: listaCanonica
    };
}

function formatearKilosCorto(kilosVal) {
    const kg = Number(kilosVal || 0);
    if (!Number.isFinite(kg) || kg <= 0) return '';
    const g = Math.round(kg * 1000);
    if (g >= 1000 && g % 1000 === 0) return `${g / 1000} kg`;
    if (g >= 1000) return `${Number(kg.toFixed(2)).toString().replace('.', ',')} kg`;
    return `${g} g`;
}

function extraerNombreBaseYPresentacion(art = {}) {
    const nombreOficial = String(
        art.nombre_oficial_lamda ||
        art.descripcion_generada ||
        art.nomenclatura_bunker ||
        art.nombre_publico ||
        art.sku_nodo ||
        art.articulo_id ||
        ''
    ).trim();

    let nombreBase = nombreOficial
        // Ej: "GRANA Sol 10 x 200g" o "Mix F/SCOS Premiun 10 x 300g"
        .replace(/\s+\d+\s*[xX×]\s*\d+(?:[.,]\d+)?\s*(?:kg|k|gr?s?|g|ml|cc|lt?s?|u|un|unidades)?\s*$/i, '')
        // Ej: "GRANA Sol x 500g" o "ALMENDRA Peladas Non Pareil Tostado y Salado x 150g" o "Mix Salado x 2kg"
        .replace(/\s+(?:[xX×]\s*)?\d+(?:[.,]\d+)?\s*(?:kg|k|gr?s?|g|ml|cc|lt?s?|u|un|unidades)\s*$/i, '')
        .replace(/[\s·\-_/]+$/, '')
        .trim();

    if (!nombreBase) nombreBase = nombreOficial;

    const esPack = Boolean(art.es_pack || art.bunker_es_pack);
    const packUnidades = Number(art.pack_unidades || art.bunker_pack_unidades || 1);
    const kilos = Number(art.kilos_unidad || 0);
    const ingId = Number(art.ingrediente_origen_id || art.ing_id || 0);

    let presentacionCorta = '';
    if (esPack && packUnidades > 1) {
        const pesoUnitarioKg = kilos > 0 ? (kilos / packUnidades) : 0;
        const pesoUnitarioTxt = formatearKilosCorto(pesoUnitarioKg);
        presentacionCorta = pesoUnitarioTxt
            ? `Pack ${packUnidades} × ${pesoUnitarioTxt}`
            : `Pack ${packUnidades} u.`;
    } else if (ingId === 141 && kilos > 0 && kilos <= 1.5 && Math.round((kilos * 1000) / 50) > 1) {
        const u = Math.round((kilos * 1000) / 50);
        presentacionCorta = `Pack ${u} × 50 g`;
    } else if (kilos > 0) {
        presentacionCorta = formatearKilosCorto(kilos);
    } else {
        presentacionCorta = String(art.presentacion_etiqueta || 'Unidad').trim();
    }

    return {
        nombre_base_oficial: nombreBase,
        presentacion_corta: presentacionCorta
    };
}

function construirClaveProductoBase(art = {}, jerarquia = null) {
    const sku = String(art.sku_nodo || art.articulo_id || art.codigo_articulo || '').trim();
    if (Boolean(art.es_combo)) {
        const catId = Number(art.articulo_catalogo_id || art.catalogo_id || art.id || 0);
        return catId > 0 ? `combo_${catId}` : `combo_${normalizarSlugSafe(sku, 'item')}`;
    }

    const ingId = Number(art.ingrediente_origen_id || art.ing_id || 0);
    if (Number.isInteger(ingId) && ingId > 0) {
        return `ing_${ingId}`;
    }

    const jer = jerarquia || resolverJerarquiaArticuloBunker(art, null);
    const famId = Number(jer.familia_id || art.familia_id || 0) || 0;
    const artP = normalizarClaveTexto(jer.articulo_principal || art.descripcion || '');
    const attrSeed = (jer.firma_atributos || [])
        .map(([e, v]) => `${e}=${v}`)
        .join('|');
    const esPack = Boolean(art.es_pack || art.bunker_es_pack);
    const seed = attrSeed
        ? `${famId}|${artP}|${attrSeed}|${esPack ? 'pack' : 'unit'}`
        : `${famId}|${artP}|${normalizarClaveTexto(extraerNombreBaseYPresentacion(art).nombre_base_oficial)}`;
    const hash = crypto.createHash('sha1').update(seed).digest('hex').slice(0, 12);
    return `tax_${famId}_${hash}`;
}

function compactarNodosRamaUnicoHijo(ramaNode) {
    if (!ramaNode || !Array.isArray(ramaNode.subramas)) return ramaNode;
    ramaNode.subramas = ramaNode.subramas.map(compactarNodosRamaUnicoHijo);

    // Si este nivel intermedio tiene exactamente 1 sub-rama hija y ningún grupo directo, absorber el hijo para evitar clics redundantes
    while (ramaNode.grupos.length === 0 && ramaNode.subramas.length === 1) {
        const unica = ramaNode.subramas[0];
        // Conservar etiqueta más específica solo si ambos nombres son informativos; si son homónimos, quedar con uno
        const pNorm = normalizarClaveTexto(ramaNode.label);
        const hNorm = normalizarClaveTexto(unica.label);
        ramaNode.label = (pNorm === hNorm || hNorm.includes(pNorm)) ? unica.label : `${ramaNode.label} › ${unica.label}`;
        ramaNode.grupos = unica.grupos;
        ramaNode.subramas = unica.subramas;
    }
    return ramaNode;
}

/**
 * Construye el organigrama determinista Familia -> (Sub-ramas B2B cuando >=2) -> Producto Base -> Presentaciones
 */
function construirArbolOrganigramaDeterminista(items = [], { compactarRamasUnicoHijo = true } = {}) {
    const familiasMap = new Map();
    const gruposPorClave = new Map();

    for (const item of items) {
        const jer = item.jerarquia_b2b || resolverJerarquiaArticuloBunker(item, null);
        const claveBase = item.clave_producto_base || construirClaveProductoBase(item, jer);
        const famNombre = String(jer.familia_nombre || item.categoria_oficial_lamda || item.categoria_familiar || 'Almacén').trim();
        const famKey = `fam_${Number(jer.familia_id || 0)}_${normalizarSlugSafe(famNombre)}`;

        if (!familiasMap.has(famKey)) {
            familiasMap.set(famKey, {
                familia_key: famKey,
                familia_id: Number(jer.familia_id || 0),
                familia_nombre: famNombre,
                subramasMap: new Map(),
                gruposDirectosMap: new Map(),
                total_presentaciones: 0,
                total_activas: 0
            });
        }
        const famObj = familiasMap.get(famKey);

        // Sub-niveles B2B después de Familia: ej. [articulo_principal, sub_categoria, sub_sub_categoria, sub_sub_sub_categoria]
        // Quitamos niveles que sean iguales a famNombre o iguales al propio nombre_base del producto si es de 1 solo miembro
        const subNivelesRaw = (jer.ruta_compacta || []).slice(1);
        const groupKey = `${famKey}::${claveBase}`;

        let groupObj = gruposPorClave.get(groupKey);
        if (!groupObj) {
            const { nombre_base_oficial } = extraerNombreBaseYPresentacion(item);
            groupObj = {
                clave_producto_base: claveBase,
                familia_key: famKey,
                familia_id: Number(jer.familia_id || 0),
                familia_nombre: famNombre,
                sub_niveles: subNivelesRaw,
                ruta_b2b_corta: subNivelesRaw.join(' › '),
                nombre_base_oficial: item.nombre_base_oficial || nombre_base_oficial,
                nombre_base_vidriera: item.nombre_base_vidriera || item.nombre_base_oficial || nombre_base_oficial,
                es_combo: Boolean(item.es_combo),
                ingrediente_origen_id: Number(item.ingrediente_origen_id || 0) || null,
                items: []
            };
            gruposPorClave.set(groupKey, groupObj);
        }
        groupObj.items.push(item);
        famObj.total_presentaciones += 1;
        if (item.publicado_tienda) famObj.total_activas += 1;
    }

    // Ordenar items dentro de cada Producto Base (menor a mayor peso, luego precio)
    for (const g of gruposPorClave.values()) {
        g.items.sort((a, b) => {
            const ka = Number(a.kilos_unidad || 0);
            const kb = Number(b.kilos_unidad || 0);
            if (ka !== kb) return ka - kb;
            const pa = Number(a.precio_venta_vecino || a.precio_base_nodo_final || 0);
            const pb = Number(b.precio_venta_vecino || b.precio_base_nodo_final || 0);
            if (pa !== pb) return pa - pb;
            return String(a.sku_nodo || '').localeCompare(String(b.sku_nodo || ''));
        });
    }

    // Ubicar cada grupo en su árbol de sub-ramas dentro de la Familia
    for (const g of gruposPorClave.values()) {
        const famObj = familiasMap.get(g.familia_key);
        const pathParts = (g.sub_niveles || []).filter(p => {
            const normP = normalizarClaveTexto(p);
            const normBase = normalizarClaveTexto(g.nombre_base_oficial);
            return normP && normP !== normBase;
        });

        if (pathParts.length === 0) {
            famObj.gruposDirectosMap.set(g.clave_producto_base, g);
            continue;
        }

        let currentChildrenMap = famObj.subramasMap;
        let currentNode = null;
        for (let i = 0; i < pathParts.length; i++) {
            const lbl = pathParts[i];
            const nodeKey = `${g.familia_key}::${pathParts.slice(0, i + 1).map(normalizarSlugSafe).join('/')}`;
            if (!currentChildrenMap.has(nodeKey)) {
                currentChildrenMap.set(nodeKey, {
                    rama_key: nodeKey,
                    label: lbl,
                    subramasMap: new Map(),
                    grupos: [],
                    subramas: []
                });
            }
            currentNode = currentChildrenMap.get(nodeKey);
            currentChildrenMap = currentNode.subramasMap;
        }
        if (currentNode) {
            currentNode.grupos.push(g);
        }
    }

    const materializarRama = (rama) => {
        const subramas = Array.from(rama.subramasMap.values())
            .map(materializarRama)
            .sort((a, b) => a.label.localeCompare(b.label, 'es-AR'));
        const grupos = rama.grupos
            .slice()
            .sort((a, b) => a.nombre_base_vidriera.localeCompare(b.nombre_base_vidriera, 'es-AR'));
        const nodo = {
            rama_key: rama.rama_key,
            label: rama.label,
            subramas,
            grupos
        };
        return compactarRamasUnicoHijo ? compactarNodosRamaUnicoHijo(nodo) : nodo;
    };

    const familias = Array.from(familiasMap.values())
        .map(fam => {
            let subramas = Array.from(fam.subramasMap.values())
                .map(materializarRama)
                .sort((a, b) => a.label.localeCompare(b.label, 'es-AR'));
            const gruposDirectos = Array.from(fam.gruposDirectosMap.values())
                .sort((a, b) => a.nombre_base_vidriera.localeCompare(b.nombre_base_vidriera, 'es-AR'));

            // Si compactarRamasUnicoHijo está activo y toda la Familia tiene un único sub-acordeón y 0 grupos directos, promover sus hijos al nivel de la Familia
            if (compactarRamasUnicoHijo && gruposDirectos.length === 0 && subramas.length === 1) {
                const unicaRama = subramas[0];
                subramas = unicaRama.subramas;
                gruposDirectos.push(...unicaRama.grupos);
                gruposDirectos.sort((a, b) => a.nombre_base_vidriera.localeCompare(b.nombre_base_vidriera, 'es-AR'));
            }

            const totalGrupos = gruposDirectos.length + contarGruposEnRamas(subramas);
            return {
                familia_key: fam.familia_key,
                familia_id: fam.familia_id,
                familia_nombre: fam.familia_nombre,
                total_grupos: totalGrupos,
                total_presentaciones: fam.total_presentaciones,
                total_activas: fam.total_activas,
                grupos_directos: gruposDirectos,
                subramas
            };
        })
        .sort((a, b) => a.familia_nombre.localeCompare(b.familia_nombre, 'es-AR'));

    return {
        familias,
        total_familias: familias.length,
        total_grupos: familias.reduce((acc, f) => acc + f.total_grupos, 0),
        total_presentaciones: familias.reduce((acc, f) => acc + f.total_presentaciones, 0)
    };
}

function contarGruposEnRamas(ramas = []) {
    let total = 0;
    for (const r of ramas) {
        total += (r.grupos?.length || 0) + contarGruposEnRamas(r.subramas || []);
    }
    return total;
}

module.exports = {
    normalizarClaveTexto,
    normalizarSlugSafe,
    parsearListaEjes,
    parsearPropiedadesDinamicas,
    extraerMapaPosiciones,
    cargarMapaJerarquiaB2B,
    invalidarCacheJerarquiaB2B,
    resolverJerarquiaArticuloBunker,
    formatearKilosCorto,
    extraerNombreBaseYPresentacion,
    construirClaveProductoBase,
    construirArbolOrganigramaDeterminista
};
