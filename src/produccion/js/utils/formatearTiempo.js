/**
 * Formatea milisegundos a formato MM:SS
 * @param {number} ms - Milisegundos
 * @returns {string} Tiempo formateado (MM:SS)
 */
export function formatearTiempo(ms) {
    const s = Math.floor(ms / 1000);
    const mm = String(Math.floor(s / 60)).padStart(2, '0');
    const ss = String(s % 60).padStart(2, '0');
    return `${mm}:${ss}`;
}
