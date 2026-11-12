/**
 * Helpers compartidos para App Móvil LAMDA (PresupuestosWizard & CotizadorPreciosMovil):
 * - Búsqueda Universal LAMDA por grupos de caracteres separados por espacios (AND)
 *   sobre corpus limpio (incluyendo propiedades_dinamicas, rubro, sub_rubro, jerarquías e ingredientes).
 * - Saneamiento de stock IEEE-754.
 * - Títulos limpios no redundantes y presentaciones compactas sin perder descripción completa en carrito/pedido/cotización.
 */
(function (global) {
    'use strict';

    const EPSILON_CERO = 1e-4;
    const EPSILON_ENTERO = 1e-3;
    const CONECTORES_MINUSCULA = new Set(['de', 'del', 'la', 'las', 'el', 'los', 'para', 'con', 'sin', 'y', 'o', 'en', 'a']);
    const ACRONIMOS_MAYUSCULA = new Set(['NP', 'HF', 'IDP', 'MM', 'MIC', 'W4', 'W5', 'P3', 'BBQ']);

    function normalizarTextoBusqueda(texto) {
        return String(texto || '')
            .toLowerCase()
            .normalize('NFD')
            .replace(/[\u0300-\u036f]/g, '')
            .replace(/\s+/g, ' ')
            .trim();
    }

    function escapeHtml(texto) {
        return String(texto || '')
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
    }

    function normalizarStockComercial(val) {
        const n = Number(val || 0);
        if (!Number.isFinite(n)) return 0;
        if (Math.abs(n) < EPSILON_CERO) return 0;

        const rounded = Math.round(n);
        if (Math.abs(n - rounded) < EPSILON_ENTERO) {
            return rounded === 0 ? 0 : rounded;
        }

        const dosDec = Math.round(n * 100) / 100;
        return Math.abs(dosDec) < EPSILON_CERO ? 0 : dosDec;
    }

    function formatearStockComercial(val) {
        return String(normalizarStockComercial(val));
    }

    function extraerValoresPropiedadesDinamicas(props) {
        let obj = props;
        if (!obj) return [];
        if (typeof obj === 'string') {
            try { obj = JSON.parse(obj); } catch (_) { return [obj]; }
        }
        if (typeof obj !== 'object') return [];

        const valores = [];
        if (obj.familia_nombre) valores.push(String(obj.familia_nombre));

        const artPrinc = obj.articulo_principal;
        if (artPrinc) {
            valores.push(typeof artPrinc === 'object' && artPrinc.valor ? String(artPrinc.valor) : String(artPrinc));
        }

        const posObj = obj.posiciones && typeof obj.posiciones === 'object' ? obj.posiciones : obj;
        for (const k of Object.keys(posObj)) {
            const entry = posObj[k];
            if (entry && typeof entry === 'object') {
                if (entry.valor) valores.push(String(entry.valor));
            } else if (typeof entry === 'string' && !['articulo_principal', 'familia_nombre', 'abreviatura_familia', 'modo_display_familia', 'modo_display_principal', 'posicion_familia', 'sufijo_wip'].includes(k)) {
                valores.push(entry);
            }
        }
        return valores;
    }

    /**
     * Construye la bolsa de búsqueda unificada LAMDA (Fase 49) sin claves sintácticas JSON.
     */
    function construirCorpusBusquedaArticulo(art, infoIngredientes = null) {
        if (!art) return '';
        const parts = [
            art.articulo_numero || art.producto_codigo || art.codigo || '',
            art.codigo_barras || '',
            art.descripcion || art.producto_descripcion || '',
            art.nomenclatura || '',
            art.familia_nombre || art.familia || '',
            art.articulo_principal || '',
            art.sub_categoria || '',
            art.sub_sub_categoria || '',
            art.sub_sub_sub_categoria || '',
            art.rubro || '',
            art.sub_rubro || '',
            art.presentacion_str || '',
            art.busqueda_metadata || '',
            ...extraerValoresPropiedadesDinamicas(art.propiedades_dinamicas)
        ];

        if (infoIngredientes && Array.isArray(infoIngredientes.ingredientes) && infoIngredientes.ingredientes.length > 0) {
            parts.push(infoIngredientes.ingredientes.join(' '));
        }

        return normalizarTextoBusqueda(parts.filter(Boolean).join(' '));
    }

    /**
     * Aplica coincidencia acumulativa AND por todos los grupos de caracteres separados por espacios.
     */
    function coincideBusquedaAcumulativa(corpusNormalizado, query) {
        const cleanQuery = normalizarTextoBusqueda(query);
        if (!cleanQuery) return true;
        const terms = cleanQuery.split(' ').filter(Boolean);
        return terms.every(t => corpusNormalizado.includes(t));
    }

    function normalizarUnidadTexto(rawUnit) {
        const u = String(rawUnit || '').toLowerCase().replace(/\.$/, '');
        if (u === 'k' || u === 'kg' || u === 'kgs' || u === 'kilo' || u === 'kilos') return 'kg';
        if (u === 'gr' || u === 'g' || u === 'grs') return 'g';
        if (u === 'u' || u === 'un' || u === 'unid' || u === 'unidad' || u === 'unidades') return 'u.';
        return u;
    }

    function extraerBaseYPresentacion(descripcion, item = null) {
        const raw = String(descripcion || '').replace(/\s+/g, ' ').trim();
        if (!raw) return { stem: '', presentation: '', isPack: false };

        const rePack = /^(.*?)\s+(?:(?:pack|caja)\s*(?:de\s*)?[xX×]?\s*|[xX×]\s*)?(\d+)\s*[xX×]\s*([\d.,]+)\s*(kg|k|kgs|kilo|kilos|gr|grs|g|u|un|unid|unidad|unidades)\.?\s*$/i;
        const mPack = raw.match(rePack);
        if (mPack && mPack[1].trim().length >= 3) {
            return {
                stem: mPack[1].trim(),
                presentation: `Pack ${mPack[2]} x ${String(mPack[3]).trim().replace(/,0+(?=$)/, '')} ${normalizarUnidadTexto(mPack[4])}`,
                isPack: true
            };
        }

        const reSimple = /^(.*?)\s+[xX×]\s*([\d.,]+)\s*(kg|k|kgs|kilo|kilos|gr|grs|g|u|un|unid|unidad|unidades)\.?\s*$/i;
        const mSimple = raw.match(reSimple);
        if (mSimple && mSimple[1].trim().length >= 3) {
            return {
                stem: mSimple[1].trim(),
                presentation: `x ${String(mSimple[2]).trim()} ${normalizarUnidadTexto(mSimple[3])}`,
                isPack: false
            };
        }

        if (item && item.presentacion_str && String(item.presentacion_str).trim()) {
            return {
                stem: raw,
                presentation: String(item.presentacion_str).trim(),
                isPack: false
            };
        }

        const kilos = Number(item?.kilos_unidad || 0);
        if (kilos > 0) {
            const unitLabel = kilos < 1
                ? `${Math.round(kilos * 1000)} g`
                : `${Number.isInteger(kilos) ? kilos : Number(kilos.toFixed(2))} kg`;
            return { stem: raw, presentation: `x ${unitLabel}`, isPack: false };
        }

        return { stem: raw, presentation: raw, isPack: false };
    }

    function embellecerTituloComercial(rawStem) {
        let s = String(rawStem || '').replace(/\s+/g, ' ').trim();
        if (!s) return '';

        s = s
            .replace(/\bGRANA\s+(?:de\s+)?(Flor|Sol)\b/gi, (_, v) => `Granola de ${v.charAt(0).toUpperCase() + v.slice(1).toLowerCase()}`)
            .replace(/\bGrana\s+(?:de\s+)?(Flor|Sol)\b/gi, (_, v) => `Granola de ${v.charAt(0).toUpperCase() + v.slice(1).toLowerCase()}`)
            .replace(/\bF\/SCOS\b/gi, 'Frutos Secos')
            .replace(/\bERRDA\b/gi, 'Escurrida')
            .replace(/\bTOST\/SAL\b/gi, 'Tostado y Salado')
            .replace(/\bS\/CAZO\b/gi, 'Sin Carozo')
            .replace(/\bC\/ZO\b/gi, 'Con Carozo')
            .replace(/\bS\/PIEL\b/gi, 'Sin Piel')
            .replace(/\bC\/PIEL\b/gi, 'Con Piel')
            .replace(/\bTOTDO\b/gi, 'Tostado')
            .replace(/\bMDIO\b/gi, 'Mediano')
            .replace(/\bIGRAL\b/gi, 'Integral');

        const tokens = s.split(' ').filter(Boolean);
        const formatted = [];
        for (let i = 0; i < tokens.length; i++) {
            let tok = tokens[i];
            const upper = tok.toUpperCase();
            const lower = tok.toLowerCase();

            if (ACRONIMOS_MAYUSCULA.has(upper)) {
                tok = upper;
            } else if (i > 0 && CONECTORES_MINUSCULA.has(lower)) {
                tok = lower;
            } else if (tok === upper && tok.length >= 3 && /^[A-ZÁÉÍÓÚÑ]+$/.test(tok)) {
                tok = tok.charAt(0).toUpperCase() + tok.slice(1).toLowerCase();
            } else if (i === 0) {
                tok = tok.charAt(0).toUpperCase() + tok.slice(1);
            }

            if (formatted.length > 0 && normalizarTextoBusqueda(formatted[formatted.length - 1]) === normalizarTextoBusqueda(tok)) {
                continue;
            }
            formatted.push(tok);
        }
        return formatted.join(' ').trim();
    }

    function obtenerCodigoItemMovil(item) {
        return String(item?.articulo_numero || item?.codigo_barras || item?.producto_codigo || item?.codigo || item?.descripcion || '').trim();
    }

    function calcularPresentacionGrupo(items, fallbackNombre = '') {
        const list = Array.isArray(items) ? items : [];
        const cleanFallback = embellecerTituloComercial(fallbackNombre) || String(fallbackNombre || '').trim();
        const etiquetasPorCodigo = new Map();

        if (list.length === 0) {
            return { titulo: cleanFallback, etiquetasPorCodigo, tieneTituloComun: false };
        }

        const parsed = list.map((item) => {
            const desc = item.nomenclatura || item.descripcion || '';
            const ext = extraerBaseYPresentacion(desc, item);
            const emb = embellecerTituloComercial(ext.stem);
            const tokensLit = emb.split(/\s+/).filter(Boolean);
            const tokensNorm = tokensLit.map(normalizarTextoBusqueda);
            const tokensCmp = tokensNorm.filter(t => t && !['de', 'del'].includes(t));
            return { item, desc, ext, emb, tokensLit, tokensNorm, tokensCmp };
        });

        const firstCmpKey = parsed[0].tokensCmp.join(' ');
        const todosMismoStem = firstCmpKey.length > 0 && parsed.every(p => p.tokensCmp.join(' ') === firstCmpKey);

        if (todosMismoStem) {
            const mejorVersion = parsed.reduce((acc, p) => (p.emb.length >= acc.length ? p.emb : acc), parsed[0].emb);
            for (const p of parsed) {
                etiquetasPorCodigo.set(obtenerCodigoItemMovil(p.item), p.ext.presentation || p.desc);
            }
            return {
                titulo: mejorVersion || cleanFallback,
                etiquetasPorCodigo,
                tieneTituloComun: true
            };
        }

        let prefijoLen = parsed[0].tokensNorm.length;
        for (let i = 1; i < parsed.length; i++) {
            let k = 0;
            const maxK = Math.min(prefijoLen, parsed[i].tokensNorm.length);
            while (k < maxK && parsed[0].tokensNorm[k] === parsed[i].tokensNorm[k]) k++;
            prefijoLen = k;
        }
        while (prefijoLen > 1 && CONECTORES_MINUSCULA.has(parsed[0].tokensNorm[prefijoLen - 1])) {
            prefijoLen--;
        }

        if (prefijoLen >= 2) {
            const tituloPrefijo = parsed[0].tokensLit.slice(0, prefijoLen).join(' ');
            for (const p of parsed) {
                const resto = p.tokensLit.slice(prefijoLen).join(' ').trim();
                const pres = p.ext.presentation || '';
                const compacta = resto
                    ? (pres ? `${resto} · ${pres}` : resto)
                    : (pres || p.desc);
                etiquetasPorCodigo.set(obtenerCodigoItemMovil(p.item), compacta);
            }
            return {
                titulo: tituloPrefijo || cleanFallback,
                etiquetasPorCodigo,
                tieneTituloComun: true
            };
        }

        for (const p of parsed) {
            etiquetasPorCodigo.set(obtenerCodigoItemMovil(p.item), p.desc);
        }
        return {
            titulo: cleanFallback,
            etiquetasPorCodigo,
            tieneTituloComun: false
        };
    }

    function resolverIngredientesItem(art, mapaIngredientesUpper) {
        if (!art || !mapaIngredientesUpper) return null;
        const candidatos = [
            art.articulo_numero,
            art.producto_codigo,
            art.codigo_articulo,
            art.codigo,
            art.codigo_barras,
            art.articulo_id
        ].map(k => String(k || '').trim().toUpperCase()).filter(Boolean);

        for (const sku of candidatos) {
            const info = mapaIngredientesUpper[sku];
            if (info && [3, 5, 6].includes(Number(info.linea_negocio)) && Array.isArray(info.ingredientes) && info.ingredientes.length >= 2) {
                return info;
            }
        }
        return null;
    }

    function evaluarIngredientesGrupo(items, mapaIngredientesUpper) {
        const list = Array.isArray(items) ? items : [];
        if (list.length === 0 || !mapaIngredientesUpper) {
            return { shared: false, info: null, representative: null };
        }
        let baseInfo = null;
        let baseFirma = null;
        for (const item of list) {
            const info = resolverIngredientesItem(item, mapaIngredientesUpper);
            if (!info) return { shared: false, info: null, representative: null };
            const firma = `${Number(info.linea_negocio)}::${info.ingredientes.map(normalizarTextoBusqueda).join('|')}`;
            if (!baseInfo) {
                baseInfo = info;
                baseFirma = firma;
            } else if (firma !== baseFirma) {
                return { shared: false, info: null, representative: null };
            }
        }
        return { shared: true, info: baseInfo, representative: list[0] };
    }

    function mostrarModalIngredientesMovil(titulo, info) {
        if (!info || !Array.isArray(info.ingredientes)) return;
        const linea = Number(info.linea_negocio);
        const esGranola = linea === 6;
        const esBarrita = linea === 5;
        const etiqueta = esGranola ? 'Granola Elaborada' : (esBarrita ? 'Barrita / Elaborado UP' : 'Mix Elaborado');
        const accentColor = esGranola ? '#fbbf24' : (esBarrita ? '#34d399' : '#c084fc');

        const itemsHtml = info.ingredientes
            .map((ing, idx) => `<li style="display:flex;align-items:center;gap:0.55rem;padding:0.42rem 0.65rem;border-radius:8px;background:rgba(15,23,42,0.55);border:1px solid rgba(255,255,255,0.08);font-size:0.86rem;color:#f1f5f9;">
                <span style="min-width:1.45rem;height:1.45rem;display:inline-flex;align-items:center;justify-content:center;border-radius:999px;background:rgba(255,255,255,0.08);font-size:0.72rem;font-weight:800;color:${accentColor};">${idx + 1}</span>
                <span style="font-weight:600;text-align:left;">${escapeHtml(ing)}</span>
            </li>`)
            .join('');

        Swal.fire({
            title: `🥣 ${escapeHtml(titulo)}`,
            html: `
                <div style="text-align:left;">
                    <div style="display:flex;align-items:center;gap:0.5rem;margin-bottom:0.75rem;">
                        <span style="padding:0.2rem 0.6rem;border-radius:999px;font-size:0.74rem;font-weight:800;border:1px solid ${accentColor};color:${accentColor};">${escapeHtml(etiqueta)}</span>
                        <span style="font-size:0.75rem;color:#94a3b8;">Ordenados de mayor a menor proporción</span>
                    </div>
                    <ul style="list-style:none;margin:0;padding:0;display:flex;flex-direction:column;gap:0.35rem;max-height:50vh;overflow-y:auto;">
                        ${itemsHtml}
                    </ul>
                </div>
            `,
            background: '#0f172a',
            color: '#f8fafc',
            confirmButtonText: 'Cerrar',
            confirmButtonColor: '#334155'
        });
    }

    global.LamdaCatalogoHelpers = {
        normalizarTextoBusqueda,
        escapeHtml,
        normalizarStockComercial,
        formatearStockComercial,
        construirCorpusBusquedaArticulo,
        coincideBusquedaAcumulativa,
        extraerBaseYPresentacion,
        embellecerTituloComercial,
        calcularPresentacionGrupo,
        resolverIngredientesItem,
        evaluarIngredientesGrupo,
        mostrarModalIngredientesMovil
    };
})(window);
