// utilsEtapasMedicion.js - Utilidades para manejo de etapas de medición

/**
 * Establece la etapa actual de un carro en localStorage
 * @param {number} carroId - ID del carro
 * @param {number} etapa - Número de etapa (1, 2 o 3)
 */
export function setEtapaCarro(carroId, etapa) {
    try {
        const key = `carro:${carroId}:etapa`;
        localStorage.setItem(key, String(etapa));
        console.log(`📌 Etapa ${etapa} establecida para carro ${carroId}`);
    } catch (error) {
        console.error('Error estableciendo etapa:', error);
    }
}

/**
 * Obtiene la etapa actual de un carro desde localStorage
 * @param {number} carroId - ID del carro
 * @returns {number} Número de etapa (1, 2 o 3), por defecto 1
 */
export function getEtapaCarro(carroId) {
    try {
        const key = `carro:${carroId}:etapa`;
        const etapa = localStorage.getItem(key);
        return etapa ? Number(etapa) : 1;
    } catch (error) {
        console.error('Error obteniendo etapa:', error);
        return 1;
    }
}

/**
 * Verifica si un carro está en Etapa 1
 * @param {number} carroId - ID del carro
 * @returns {boolean} true si está en Etapa 1
 */
export function esEtapa1(carroId) {
    return getEtapaCarro(carroId) === 1;
}

/**
 * Verifica si un carro está en Etapa 2
 * @param {number} carroId - ID del carro
 * @returns {boolean} true si está en Etapa 2
 */
export function esEtapa2(carroId) {
    return getEtapaCarro(carroId) === 2;
}

/**
 * Verifica si un carro está en Etapa 3
 * @param {number} carroId - ID del carro
 * @returns {boolean} true si está en Etapa 3
 */
export function esEtapa3(carroId) {
    return getEtapaCarro(carroId) === 3;
}

/**
 * Limpia la etapa de un carro (al eliminar o deseleccionar)
 * @param {number} carroId - ID del carro
 */
export function limpiarEtapaCarro(carroId) {
    try {
        const key = `carro:${carroId}:etapa`;
        localStorage.removeItem(key);
        console.log(`🧹 Etapa limpiada para carro ${carroId}`);
    } catch (error) {
        console.error('Error limpiando etapa:', error);
    }
}
