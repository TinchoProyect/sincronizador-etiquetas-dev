'use strict';

/**
 * Servicio de Geocodificación Argentina (GeoRef AR Oficial + OpenStreetMap Nominatim)
 * - Cero dependencia de API Keys pagas en el frontend público.
 * - Normalización optimizada para calles numeradas y diagonales de La Plata / GBA / Interior.
 */

const GEO_CACHE_MAX_ENTRIES = 400;
const GEO_CACHE_TTL_MS = 15 * 60 * 1000;
const _geoCacheBusquedaAr = new Map();
const _geoCacheInversaAr = new Map();
let _ultimoHitNominatimMs = 0;

function setGeoCacheLimitado(cacheMap, clave, valor) {
    if (cacheMap.size >= GEO_CACHE_MAX_ENTRIES) {
        const firstKey = cacheMap.keys().next().value;
        if (firstKey !== undefined) cacheMap.delete(firstKey);
    }
    cacheMap.set(clave, { ts: Date.now(), data: valor });
}

function getGeoCacheVigente(cacheMap, clave) {
    const entry = cacheMap.get(clave);
    if (!entry) return null;
    if ((Date.now() - entry.ts) > GEO_CACHE_TTL_MS) {
        cacheMap.delete(clave);
        return null;
    }
    return entry.data;
}

function normalizarTokenTextoGeo(txt = '') {
    return String(txt || '')
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .toLowerCase()
        .replace(/[^a-z0-9\s]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
}

function normalizarQueryGeocoderAr(rawQuery = '') {
    let q = String(rawQuery || '').replace(/\s+/g, ' ').trim();
    if (!q) return '';

    // Remover cláusulas de "entre calles" para que no rompan GeoRef / Nominatim
    q = q
        .replace(/\(\s*e\/\s*[^)]+\)/gi, ' ')
        .replace(/\be\/\s*[^,]+(?=,|$)/gi, ' ')
        .replace(/\bentre\s+(?:calles?\s+)?[^,]+(?=,|$)/gi, ' ');

    // La Plata / diagonales / abreviaturas habituales
    q = q
        .replace(/\b(?:diag|dg)\.?\s*/gi, 'Diagonal ')
        .replace(/\bav\.?\s+/gi, 'Avenida ')
        .replace(/\bbv\.?\s+/gi, 'Boulevard ')
        .replace(/\bpje\.?\s+/gi, 'Pasaje ')
        .replace(/\bcalle\s+(\d)/gi, '$1')
        .replace(/\b(?:n[°ºo]|nro\.?)\s*(\d+)/gi, '$1')
        .replace(/\s+,/g, ',')
        .replace(/,\s*/g, ', ')
        .replace(/\s+/g, ' ')
        .trim();
    return q;
}

async function fetchJsonConTimeout(url, opciones = {}, timeoutMs = 4800) {
    const resp = await fetch(url, {
        ...opciones,
        signal: AbortSignal.timeout(timeoutMs)
    });
    if (!resp.ok) {
        throw new Error(`HTTP ${resp.status}`);
    }
    return resp.json();
}

async function consultarNominatim(queryStr) {
    const ahora = Date.now();
    const espera = _ultimoHitNominatimMs ? Math.max(0, 1050 - (ahora - _ultimoHitNominatimMs)) : 0;
    if (espera > 0 && espera <= 1100) {
        await new Promise(r => setTimeout(r, espera));
    }
    _ultimoHitNominatimMs = Date.now();

    const urlNom = new URL('https://nominatim.openstreetmap.org/search');
    urlNom.searchParams.set('format', 'jsonv2');
    urlNom.searchParams.set('countrycodes', 'ar');
    urlNom.searchParams.set('limit', '8');
    urlNom.searchParams.set('addressdetails', '1');
    urlNom.searchParams.set('q', queryStr);

    return fetchJsonConTimeout(urlNom.toString(), {
        headers: {
            'User-Agent': 'LAMDA-Domicilios/1.0 (logistica@lamdaser.com)',
            'Accept-Language': 'es-AR,es;q=0.9'
        }
    }, 4800);
}

async function geocodificarDireccionArgentina(query, opciones = {}) {
    const qOrig = String(query || '').trim();
    if (qOrig.length < 3) {
        return { resultados: [], query_normalizada: qOrig, fuente_principal: 'vacio' };
    }

    const qNorm = normalizarQueryGeocoderAr(qOrig);
    const cacheKey = `${normalizarTokenTextoGeo(qNorm)}|${String(opciones.partido_hint || '').toLowerCase()}`;
    const cached = getGeoCacheVigente(_geoCacheBusquedaAr, cacheKey);
    if (cached) {
        return cached;
    }

    const partes = qNorm.split(',').map(p => p.trim()).filter(Boolean);
    const partePrincipal = partes[0] || qNorm;
    const partesResto = partes.slice(1);
    const partePrincipalNorm = normalizarTokenTextoGeo(partePrincipal);
    const esEsquinaNumerada = /^\d{1,3}\s+y\s+\d{1,3}$/i.test(partePrincipalNorm);
    const esCalleNumeradaConAltura = /^(?:diagonal\s+|avenida\s+|boulevard\s+)?\d{1,3}\s+\d{2,5}$/i.test(partePrincipalNorm);
    const tieneAltura = /\b\d{1,5}\b/.test(partePrincipal) && !/^(diagonal\s+)?\d{1,3}$/i.test(partePrincipal) && !esEsquinaNumerada;
    const empiezaConTipoVia = /^(calle|av\.?|avenida|diagonal|diag\.?|boulevard|bv\.?|pasaje|pje\.?|ruta|camino|autopista)\s+/i.test(partePrincipal);
    const priorizaLocalidadSobreCalle = !tieneAltura && !empiezaConTipoVia && !esEsquinaNumerada;

    const tokensResto = partesResto
        .join(' ')
        .split(/\s+/)
        .map(normalizarTokenTextoGeo)
        .filter(t => t.length >= 3 && !['argentina', 'bs', 'as', 'prov', 'provincia'].includes(t));
    const zonaEspecificaRaw = normalizarTokenTextoGeo(partesResto[0] || '');
    const tokensZona = (zonaEspecificaRaw && zonaEspecificaRaw !== 'buenos aires')
        ? zonaEspecificaRaw.split(/\s+/).filter(t => t.length >= 3 && !['del', 'las', 'los', 'prov', 'provincia', 'ciudad', 'argentina'].includes(t))
        : [];
    const evaluarMatchZona = (blobNorm = '') => tokensZona.length === 0 || tokensZona.every(tok => blobNorm.includes(tok));

    const candidatos = [];

    const registrarCandidato = (item) => {
        const lat = Number(item.lat);
        const lng = Number(item.lng);
        if (!Number.isFinite(lat) || !Number.isFinite(lng) || lat === 0 || lng === 0) return;
        const nuevoScore = Number(item.score || 0);
        const idxDuplicado = candidatos.findIndex(c =>
            Math.abs(c.lat - lat) < 0.0012 && Math.abs(c.lng - lng) < 0.0012
        );
        if (idxDuplicado === -1) {
            candidatos.push({
                display_name: String(item.display_name || '').trim(),
                lat: Number(lat.toFixed(7)),
                lng: Number(lng.toFixed(7)),
                calle: String(item.calle || '').trim(),
                altura: item.altura ? String(item.altura).trim() : '',
                localidad: String(item.localidad || '').trim(),
                partido: String(item.partido || '').trim(),
                provincia: String(item.provincia || '').trim(),
                fuente: item.fuente || 'georef',
                score: nuevoScore
            });
        } else if (nuevoScore > candidatos[idxDuplicado].score) {
            candidatos[idxDuplicado].score = nuevoScore;
        }
    };

    const promesasGeoref = [];

    if (tieneAltura) {
        const urlDir = new URL('https://apis.datos.gob.ar/georef/api/direcciones');
        urlDir.searchParams.set('direccion', partePrincipal);
        urlDir.searchParams.set('max', '8');
        urlDir.searchParams.set('campos', 'estandar');
        if (partesResto.length >= 2) {
            urlDir.searchParams.set('provincia', partesResto[partesResto.length - 1]);
        }
        if (partesResto.length >= 1 && /la plata/i.test(partesResto.join(' '))) {
            urlDir.searchParams.set('departamento', 'La Plata');
        } else if (esCalleNumeradaConAltura && partesResto.length === 0) {
            // Calle numerada pura sin localidad explícita: pedir también sesgo La Plata además del global
            const urlDirLp = new URL('https://apis.datos.gob.ar/georef/api/direcciones');
            urlDirLp.searchParams.set('direccion', partePrincipal);
            urlDirLp.searchParams.set('departamento', 'La Plata');
            urlDirLp.searchParams.set('provincia', 'Buenos Aires');
            urlDirLp.searchParams.set('max', '5');
            urlDirLp.searchParams.set('campos', 'estandar');
            promesasGeoref.push(
                fetchJsonConTimeout(urlDirLp.toString(), {}, 4500).then(data => ({ tipo: 'direcciones', data }))
            );
        }
        promesasGeoref.push(
            fetchJsonConTimeout(urlDir.toString(), {}, 4500).then(data => ({ tipo: 'direcciones', data }))
        );
    }

    const urlLoc = new URL('https://apis.datos.gob.ar/georef/api/localidades');
    urlLoc.searchParams.set('nombre', partePrincipal);
    urlLoc.searchParams.set('max', '8');
    urlLoc.searchParams.set('campos', 'estandar');
    if (partesResto.length === 1 && !/la plata|san isidro|vicente lopez/i.test(partesResto[0])) {
        urlLoc.searchParams.set('provincia', partesResto[0]);
    } else if (partesResto.length >= 2) {
        urlLoc.searchParams.set('provincia', partesResto[partesResto.length - 1]);
    }
    promesasGeoref.push(
        fetchJsonConTimeout(urlLoc.toString(), {}, 4500).then(data => ({ tipo: 'localidades', data }))
    );

    const georefSettled = await Promise.allSettled(promesasGeoref);

    for (const resItem of georefSettled) {
        if (resItem.status !== 'fulfilled') continue;
        const { tipo, data } = resItem.value || {};
        if (tipo === 'direcciones' && Array.isArray(data?.direcciones)) {
            for (const d of data.direcciones) {
                const lat = d?.ubicacion?.lat;
                const lon = d?.ubicacion?.lon;
                if (!Number.isFinite(Number(lat)) || !Number.isFinite(Number(lon))) continue;
                const calle = d?.calle?.nombre || '';
                const altura = d?.altura?.valor ? String(d.altura.valor) : '';
                const loc = d?.localidad_censal?.nombre || '';
                const dep = d?.departamento?.nombre || '';
                const prov = d?.provincia?.nombre || '';
                const etiqueta = [
                    [calle, altura].filter(Boolean).join(' '),
                    loc || dep,
                    dep && dep !== loc ? dep : '',
                    prov
                ].filter(Boolean).join(', ');
                const blobNorm = normalizarTokenTextoGeo(etiqueta);
                let coincidencias = 0;
                for (const tok of tokensResto) {
                    if (blobNorm.includes(tok)) coincidencias += 1;
                }
                const coincideZona = evaluarMatchZona(blobNorm);
                if (tokensZona.length > 0 && !coincideZona) {
                    registrarCandidato({
                        display_name: etiqueta,
                        lat,
                        lng: lon,
                        calle,
                        altura,
                        localidad: loc,
                        partido: dep,
                        provincia: prov,
                        fuente: 'georef_direcciones',
                        score: 25 + coincidencias * 5
                    });
                } else if (tokensResto.length > 0 && coincidencias === 0 && !blobNorm.includes(normalizarTokenTextoGeo(partesResto.join(' ')))) {
                    registrarCandidato({
                        display_name: etiqueta,
                        lat,
                        lng: lon,
                        calle,
                        altura,
                        localidad: loc,
                        partido: dep,
                        provincia: prov,
                        fuente: 'georef_direcciones',
                        score: 20
                    });
                } else {
                    registrarCandidato({
                        display_name: etiqueta,
                        lat,
                        lng: lon,
                        calle,
                        altura,
                        localidad: loc,
                        partido: dep,
                        provincia: prov,
                        fuente: 'georef_direcciones',
                        score: 110 + coincidencias * 25 + (tokensZona.length > 0 && coincideZona ? 35 : 0)
                    });
                }
            }
        }
        if (tipo === 'localidades' && Array.isArray(data?.localidades)) {
            for (const l of data.localidades) {
                const lat = l?.centroide?.lat;
                const lon = l?.centroide?.lon;
                if (!Number.isFinite(Number(lat)) || !Number.isFinite(Number(lon))) continue;
                const loc = l?.nombre || '';
                const dep = l?.departamento?.nombre || l?.municipio?.nombre || '';
                const prov = l?.provincia?.nombre || '';
                const etiqueta = [loc, dep && dep !== loc ? dep : '', prov].filter(Boolean).join(', ');
                const blobNorm = normalizarTokenTextoGeo(etiqueta);
                let coincidencias = 0;
                for (const tok of tokensResto) {
                    if (blobNorm.includes(tok)) coincidencias += 1;
                }
                const esExactoLoc = normalizarTokenTextoGeo(loc) === partePrincipalNorm;
                const coincideZonaLoc = evaluarMatchZona(blobNorm);
                const baseLoc = priorizaLocalidadSobreCalle ? (esExactoLoc ? 200 : 155) : (tieneAltura ? 40 : 90);
                const penalizaZonaLoc = (tokensZona.length > 0 && !coincideZonaLoc) ? -75 : 0;
                registrarCandidato({
                    display_name: etiqueta,
                    lat,
                    lng: lon,
                    calle: '',
                    altura: '',
                    localidad: loc,
                    partido: dep,
                    provincia: prov,
                    fuente: 'georef_localidades',
                    score: baseLoc + coincidencias * 20 + (tokensZona.length > 0 && coincideZonaLoc ? 30 : 0) + penalizaZonaLoc
                });
            }
        }
    }

    const tieneMatchFuerteGeoref = candidatos.some(c =>
        c.score >= (tokensResto.length > 0 ? 110 : 85) &&
        evaluarMatchZona(normalizarTokenTextoGeo(c.display_name || ''))
    );

    if (!tieneMatchFuerteGeoref || (candidatos.length < 2 && !priorizaLocalidadSobreCalle) || esEsquinaNumerada || /\by\b/i.test(partePrincipal)) {
        try {
            let nomQuery = qNorm;
            if ((esCalleNumeradaConAltura || esEsquinaNumerada) && partesResto.length === 0) {
                nomQuery = `${qNorm}, La Plata, Buenos Aires`;
            }
            let nomRows = await consultarNominatim(nomQuery);
            if ((!Array.isArray(nomRows) || nomRows.length === 0) && partesResto.length === 0 && nomQuery !== `${qNorm}, La Plata, Buenos Aires`) {
                nomRows = await consultarNominatim(`${qNorm}, La Plata, Buenos Aires`);
            }

            if (Array.isArray(nomRows)) {
                for (const n of nomRows) {
                    const addr = n.address || {};
                    const calle = addr.road || addr.pedestrian || addr.footway || '';
                    const altura = addr.house_number || '';
                    const loc = addr.suburb || addr.town || addr.city || addr.village || addr.neighbourhood || '';
                    const dep = addr.state_district || addr.county || '';
                    const prov = addr.state || '';
                    const nomClass = String(n.class || n.category || '').toLowerCase();
                    const esLugarNominatim = !calle || ['place', 'boundary'].includes(nomClass);
                    const etiquetaLimpia = [
                        esLugarNominatim ? '' : [calle, altura].filter(Boolean).join(' '),
                        loc,
                        dep && dep !== loc ? dep : '',
                        prov
                    ].filter(Boolean).join(', ') || n.display_name;
                    const blobNorm = normalizarTokenTextoGeo(`${etiquetaLimpia} ${n.display_name || ''}`);
                    let coincidencias = 0;
                    for (const tok of tokensResto) {
                        if (blobNorm.includes(tok)) coincidencias += 1;
                    }
                    const coincideZonaNom = evaluarMatchZona(blobNorm);
                    let scoreNom;
                    if (tokensZona.length > 0 && !coincideZonaNom) {
                        scoreNom = 35 + coincidencias * 8;
                    } else if (priorizaLocalidadSobreCalle) {
                        if (esLugarNominatim) {
                            const esExactoNomLoc = normalizarTokenTextoGeo(loc || '') === partePrincipalNorm ||
                                normalizarTokenTextoGeo((n.name || '')) === partePrincipalNorm;
                            scoreNom = (esExactoNomLoc ? 185 : 145) + coincidencias * 22 + (tokensZona.length > 0 && coincideZonaNom ? 40 : 0);
                        } else {
                            scoreNom = 55 + coincidencias * 12 + (tokensZona.length > 0 && coincideZonaNom ? 25 : 0);
                        }
                    } else {
                        scoreNom = 85 + coincidencias * 25 + (tokensZona.length > 0 && coincideZonaNom ? 45 : 0);
                    }
                    registrarCandidato({
                        display_name: etiquetaLimpia,
                        lat: n.lat,
                        lng: n.lon,
                        calle: esLugarNominatim ? '' : calle,
                        altura: esLugarNominatim ? '' : altura,
                        localidad: loc,
                        partido: dep,
                        provincia: prov,
                        fuente: 'nominatim',
                        score: scoreNom
                    });
                }
            }
        } catch (nomErr) {
            console.warn('⚠️ [GeocoderAR] Fallback Nominatim omitido:', nomErr.message);
        }
    }

    candidatos.sort((a, b) => b.score - a.score);
    const topResultados = candidatos.slice(0, 8).map(({ score, ...rest }) => rest);
    const salida = {
        resultados: topResultados,
        query_normalizada: qNorm,
        fuente_principal: topResultados[0]?.fuente || 'sin_resultados'
    };
    if (topResultados.length > 0) {
        setGeoCacheLimitado(_geoCacheBusquedaAr, cacheKey, salida);
    }
    return salida;
}

async function geocodificarInversoArgentina(latRaw, lngRaw) {
    const lat = Number(latRaw);
    const lng = Number(lngRaw);
    if (!Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) {
        const err = new Error('Coordenadas geográficas inválidas.');
        err.statusCode = 400;
        throw err;
    }

    const cacheKey = `${lat.toFixed(5)},${lng.toFixed(5)}`;
    const cached = getGeoCacheVigente(_geoCacheInversaAr, cacheKey);
    if (cached) {
        return cached;
    }

    let calle = '';
    let altura = '';
    let localidad = '';
    let partido = '';
    let provincia = '';
    let codigo_postal = '';
    let fuente = 'coordenadas';

    const [georefRes, nomRes] = await Promise.allSettled([
        fetchJsonConTimeout(`https://apis.datos.gob.ar/georef/api/ubicacion?lat=${lat}&lon=${lng}`, {}, 4000),
        (async () => {
            const ahora = Date.now();
            if (_ultimoHitNominatimMs && (ahora - _ultimoHitNominatimMs) < 1050) {
                await new Promise(r => setTimeout(r, 1050 - (ahora - _ultimoHitNominatimMs)));
            }
            _ultimoHitNominatimMs = Date.now();
            return fetchJsonConTimeout(
                `https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=${lat}&lon=${lng}&addressdetails=1`,
                {
                    headers: {
                        'User-Agent': 'LAMDA-Domicilios/1.0 (logistica@lamdaser.com)',
                        'Accept-Language': 'es-AR,es;q=0.9'
                    }
                },
                4500
            );
        })()
    ]);

    if (georefRes.status === 'fulfilled' && georefRes.value?.ubicacion) {
        const u = georefRes.value.ubicacion;
        partido = u.municipio?.nombre || u.departamento?.nombre || '';
        provincia = u.provincia?.nombre || '';
        fuente = 'georef_ubicacion';
    }

    if (nomRes.status === 'fulfilled' && nomRes.value) {
        const addr = nomRes.value.address || {};
        calle = addr.road || addr.pedestrian || addr.footway || '';
        altura = addr.house_number || '';
        localidad = addr.suburb || addr.town || addr.city || addr.village || addr.neighbourhood || localidad;
        partido = partido || addr.state_district || addr.county || '';
        provincia = provincia || addr.state || '';
        codigo_postal = addr.postcode || '';
        fuente = calle ? 'nominatim+georef' : fuente;
    }

    const display_name = [
        [calle, altura].filter(Boolean).join(' '),
        localidad,
        partido && partido !== localidad ? partido : '',
        provincia
    ].filter(Boolean).join(', ') || `${lat.toFixed(5)}, ${lng.toFixed(5)}`;

    const salida = {
        lat: Number(lat.toFixed(7)),
        lng: Number(lng.toFixed(7)),
        display_name,
        calle,
        altura,
        localidad,
        partido,
        provincia,
        codigo_postal,
        fuente
    };
    setGeoCacheLimitado(_geoCacheInversaAr, cacheKey, salida);
    return salida;
}

module.exports = {
    normalizarQueryGeocoderAr,
    geocodificarDireccionArgentina,
    geocodificarInversoArgentina
};
