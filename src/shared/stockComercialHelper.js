/**
 * Helper compartido para saneamiento de stock comercial (eliminación de ruido IEEE-754)
 * y detección determinista de artículos de premezcla/producción interna (WIP).
 */

const EPSILON_CERO = 1e-4;
const EPSILON_ENTERO = 1e-3;

/**
 * Normaliza un valor numérico de stock eliminando residuos binarios IEEE-754
 * (ej: `2.999999999999986` -> `3`, `3.55e-15` -> `0`, `1.9999999999999973` -> `2`).
 * Conserva decimales reales hasta 2 dígitos cuando no están cerca de un entero.
 *
 * @param {number|string|null|undefined} val
 * @returns {number}
 */
function normalizarStockComercial(val) {
    const n = Number(val || 0);
    if (!Number.isFinite(n)) return 0;
    if (Math.abs(n) < EPSILON_CERO) return 0;

    const redondeado = Math.round(n);
    if (Math.abs(n - redondeado) < EPSILON_ENTERO) {
        return redondeado === 0 ? 0 : redondeado;
    }

    const dosDec = Math.round(n * 100) / 100;
    return Math.abs(dosDec) < EPSILON_CERO ? 0 : dosDec;
}

/**
 * Formatea un valor de stock limpio sin ceros flotantes ni decimales redundantes.
 *
 * @param {number|string|null|undefined} val
 * @returns {string}
 */
function formatearStockComercial(val) {
    return String(normalizarStockComercial(val));
}

/**
 * Determina de forma determinista si un artículo del Búnker es una premezcla o
 * semielaborado interno de producción (ej. `MPB`, `MPGDF*`, `MPGDS*`, `Articulo Puente`,
 * `Unidad Productiva`) que no debe publicarse como producto comercial B2B.
 *
 * @param {object|null|undefined} row
 * @returns {boolean}
 */
function esSkuPremezclaInterna(row) {
    if (!row || typeof row !== 'object') return false;

    const rubro = String(row.rubro || '').trim().toUpperCase();
    if (rubro === 'PRODUCCION' || rubro.startsWith('PRODUCCION')) {
        return true;
    }

    let props = row.propiedades_dinamicas;
    if (props && typeof props === 'string') {
        try { props = JSON.parse(props); } catch (_) { props = null; }
    }

    if (props && typeof props === 'object') {
        const rawArtPrinc = props.articulo_principal && typeof props.articulo_principal === 'object'
            ? props.articulo_principal.valor
            : props.articulo_principal;
        const artPrincNorm = String(rawArtPrinc || '').trim().toUpperCase();
        if (artPrincNorm === 'ARTICULO PUENTE' || artPrincNorm === 'UNIDAD PRODUCTIVA') {
            return true;
        }

        const posObj = props.posiciones || props;
        if (posObj && typeof posObj === 'object') {
            for (const k of Object.keys(posObj)) {
                const pos = posObj[k];
                if (!pos || typeof pos !== 'object') continue;
                const eje = String(pos.eje || '').trim().toLowerCase();
                const val = String(pos.valor || '').trim().toLowerCase();
                if (eje === 'tratamiento' && val === 'mezcla') {
                    return true;
                }
            }
        }
    }

    return false;
}

module.exports = {
    normalizarStockComercial,
    formatearStockComercial,
    esSkuPremezclaInterna
};
