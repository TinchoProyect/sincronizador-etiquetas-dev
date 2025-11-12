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

/**
 * Formatea milisegundos a formato HH:MM:SS
 * @param {number} ms - Milisegundos
 * @returns {string} Tiempo formateado (HH:MM:SS)
 */
export function formatearTiempoCompleto(ms) {
    const totalSeconds = Math.floor(ms / 1000);
    const hh = String(Math.floor(totalSeconds / 3600)).padStart(2, '0');
    const mm = String(Math.floor((totalSeconds % 3600) / 60)).padStart(2, '0');
    const ss = String(totalSeconds % 60).padStart(2, '0');
    return `${hh}:${mm}:${ss}`;
}
