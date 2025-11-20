/**
 * Utilidades para manejo de números decimales
 * Conversión entre formato UI (coma) y formato Backend/AFIP (punto)
 */

console.log('🔍 [FACTURACION-DECIMALES] Cargando utilidades de decimales...');

/**
 * Convertir número de formato UI (coma) a formato Backend (punto)
 * Ejemplos:
 *   "1.234,56" -> 1234.56
 *   "1234,56" -> 1234.56
 *   "1234.56" -> 1234.56 (ya está en formato correcto)
 * 
 * @param {string|number} valor - Valor a convertir
 * @returns {number} Número en formato decimal
 */
const comaAPunto = (valor) => {
    if (valor === null || valor === undefined || valor === '') {
        return 0;
    }
    
    // Si ya es un número, devolverlo
    if (typeof valor === 'number') {
        return valor;
    }
    
    // Convertir a string y limpiar espacios
    let valorStr = String(valor).trim();
    
    // Detectar formato: si tiene coma, es formato argentino
    if (valorStr.includes(',')) {
        // Remover puntos (separadores de miles)
        valorStr = valorStr.replace(/\./g, '');
        // Reemplazar coma por punto (separador decimal)
        valorStr = valorStr.replace(',', '.');
    }
    
    // Convertir a número
    const numero = parseFloat(valorStr);
    
    if (isNaN(numero)) {
        console.warn('⚠️ [FACTURACION-DECIMALES] Valor inválido:', valor);
        return 0;
    }
    
    return numero;
};

/**
 * Convertir número de formato Backend (punto) a formato UI (coma)
 * Ejemplos:
 *   1234.56 -> "1.234,56"
 *   1234567.89 -> "1.234.567,89"
 * 
 * @param {number} valor - Valor a convertir
 * @param {number} decimales - Cantidad de decimales (default: 2)
 * @returns {string} Número formateado con coma
 */
const puntoAComa = (valor, decimales = 2) => {
    if (valor === null || valor === undefined) {
        return '0,00';
    }
    
    // Convertir a número si es string
    const numero = typeof valor === 'string' ? parseFloat(valor) : valor;
    
    if (isNaN(numero)) {
        console.warn('⚠️ [FACTURACION-DECIMALES] Valor inválido:', valor);
        return '0,00';
    }
    
    // Formatear con decimales
    const partes = numero.toFixed(decimales).split('.');
    
    // Agregar separadores de miles
    partes[0] = partes[0].replace(/\B(?=(\d{3})+(?!\d))/g, '.');
    
    // Unir con coma como separador decimal
    return partes.join(',');
};

/**
 * Redondear número a cantidad específica de decimales
 * @param {number} valor - Valor a redondear
 * @param {number} decimales - Cantidad de decimales (default: 2)
 * @returns {number} Número redondeado
 */
const redondear = (valor, decimales = 2) => {
    if (valor === null || valor === undefined) {
        return 0;
    }
    
    const numero = typeof valor === 'string' ? comaAPunto(valor) : valor;
    const multiplicador = Math.pow(10, decimales);
    
    return Math.round(numero * multiplicador) / multiplicador;
};

/**
 * Formatear número para AFIP (siempre con punto, 2 decimales)
 * @param {number|string} valor - Valor a formatear
 * @returns {string} Número formateado para AFIP
 */
const formatoAFIP = (valor) => {
    const numero = typeof valor === 'string' ? comaAPunto(valor) : valor;
    return redondear(numero, 2).toFixed(2);
};

/**
 * Validar que un valor sea un número válido
 * @param {any} valor - Valor a validar
 * @returns {boolean} True si es válido
 */
const esNumeroValido = (valor) => {
    if (valor === null || valor === undefined || valor === '') {
        return false;
    }
    
    const numero = typeof valor === 'string' ? comaAPunto(valor) : valor;
    return !isNaN(numero) && isFinite(numero);
};

/**
 * Validar que un valor sea positivo
 * @param {any} valor - Valor a validar
 * @returns {boolean} True si es positivo
 */
const esPositivo = (valor) => {
    if (!esNumeroValido(valor)) {
        return false;
    }
    
    const numero = typeof valor === 'string' ? comaAPunto(valor) : valor;
    return numero > 0;
};

/**
 * Validar que un valor esté en un rango
 * @param {any} valor - Valor a validar
 * @param {number} min - Valor mínimo
 * @param {number} max - Valor máximo
 * @returns {boolean} True si está en rango
 */
const estaEnRango = (valor, min, max) => {
    if (!esNumeroValido(valor)) {
        return false;
    }
    
    const numero = typeof valor === 'string' ? comaAPunto(valor) : valor;
    return numero >= min && numero <= max;
};

/**
 * Sumar array de números con precisión
 * @param {Array<number|string>} valores - Array de valores
 * @returns {number} Suma total
 */
const sumar = (valores) => {
    if (!Array.isArray(valores) || valores.length === 0) {
        return 0;
    }
    
    const suma = valores.reduce((acc, val) => {
        const numero = typeof val === 'string' ? comaAPunto(val) : val;
        return acc + (esNumeroValido(numero) ? numero : 0);
    }, 0);
    
    return redondear(suma, 2);
};

/**
 * Calcular porcentaje
 * @param {number|string} valor - Valor base
 * @param {number} porcentaje - Porcentaje a calcular
 * @returns {number} Resultado del cálculo
 */
const calcularPorcentaje = (valor, porcentaje) => {
    const numero = typeof valor === 'string' ? comaAPunto(valor) : valor;
    
    if (!esNumeroValido(numero) || !esNumeroValido(porcentaje)) {
        return 0;
    }
    
    return redondear((numero * porcentaje) / 100, 2);
};

/**
 * Calcular IVA sobre un monto neto
 * @param {number|string} neto - Monto neto
 * @param {number} alicuota - Alícuota de IVA (ej: 21 para 21%)
 * @returns {number} Monto de IVA
 */
const calcularIVA = (neto, alicuota) => {
    return calcularPorcentaje(neto, alicuota);
};

/**
 * Calcular neto desde un total con IVA
 * @param {number|string} total - Monto total con IVA
 * @param {number} alicuota - Alícuota de IVA (ej: 21 para 21%)
 * @returns {number} Monto neto
 */
const calcularNetoDesdeTotal = (total, alicuota) => {
    const totalNum = typeof total === 'string' ? comaAPunto(total) : total;
    
    if (!esNumeroValido(totalNum) || !esNumeroValido(alicuota)) {
        return 0;
    }
    
    return redondear(totalNum / (1 + alicuota / 100), 2);
};

/**
 * Formatear moneda argentina (con símbolo $)
 * @param {number|string} valor - Valor a formatear
 * @returns {string} Valor formateado con símbolo
 */
const formatearMoneda = (valor) => {
    return `$ ${puntoAComa(valor)}`;
};

/**
 * Parsear array de valores desde UI
 * @param {Array<string>} valores - Array de valores en formato UI
 * @returns {Array<number>} Array de números
 */
const parsearArray = (valores) => {
    if (!Array.isArray(valores)) {
        return [];
    }
    
    return valores.map(val => comaAPunto(val));
};

/**
 * Formatear array de valores para UI
 * @param {Array<number>} valores - Array de números
 * @param {number} decimales - Cantidad de decimales
 * @returns {Array<string>} Array de valores formateados
 */
const formatearArray = (valores, decimales = 2) => {
    if (!Array.isArray(valores)) {
        return [];
    }
    
    return valores.map(val => puntoAComa(val, decimales));
};

/**
 * Comparar dos números con tolerancia para errores de punto flotante
 * @param {number} a - Primer número
 * @param {number} b - Segundo número
 * @param {number} tolerancia - Tolerancia (default: 0.01)
 * @returns {boolean} True si son iguales dentro de la tolerancia
 */
const sonIguales = (a, b, tolerancia = 0.01) => {
    return Math.abs(a - b) < tolerancia;
};

console.log('✅ [FACTURACION-DECIMALES] Utilidades de decimales cargadas');

module.exports = {
    comaAPunto,
    puntoAComa,
    redondear,
    formatoAFIP,
    esNumeroValido,
    esPositivo,
    estaEnRango,
    sumar,
    calcularPorcentaje,
    calcularIVA,
    calcularNetoDesdeTotal,
    formatearMoneda,
    parsearArray,
    formatearArray,
    sonIguales
};
