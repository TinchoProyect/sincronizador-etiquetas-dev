const moment = require('moment-timezone');

console.log('🔍 [FACTURACION-TZ] Configurando zona horaria...');

/**
 * Configuración de zona horaria para Argentina
 * Todas las fechas y timestamps del módulo usan esta zona horaria
 */

// Zona horaria de Argentina
const TIMEZONE = process.env.TIMEZONE || 'America/Argentina/Buenos_Aires';

// Configurar moment con la zona horaria por defecto
moment.tz.setDefault(TIMEZONE);

console.log(`🌍 [FACTURACION-TZ] Zona horaria configurada: ${TIMEZONE}`);
console.log(`🕒 [FACTURACION-TZ] Hora actual: ${moment().format('YYYY-MM-DD HH:mm:ss')}`);

/**
 * Obtener fecha/hora actual en zona horaria de Argentina
 * @returns {moment.Moment} Momento actual en Argentina
 */
const ahora = () => {
    return moment().tz(TIMEZONE);
};

/**
 * Obtener fecha actual en formato YYYY-MM-DD
 * @returns {string} Fecha en formato ISO
 */
const fechaActual = () => {
    return ahora().format('YYYY-MM-DD');
};

/**
 * Obtener timestamp actual en formato ISO con zona horaria
 * @returns {string} Timestamp ISO con TZ
 */
const timestampActual = () => {
    return ahora().toISOString();
};

/**
 * Convertir fecha a formato AFIP (YYYYMMDD)
 * @param {string|Date|moment.Moment} fecha - Fecha a convertir
 * @returns {string} Fecha en formato AFIP
 */
const formatoAFIP = (fecha) => {
    if (!fecha) {
        return ahora().format('YYYYMMDD');
    }
    return moment(fecha).tz(TIMEZONE).format('YYYYMMDD');
};

/**
 * Convertir fecha de formato AFIP (YYYYMMDD) a formato ISO (YYYY-MM-DD)
 * @param {string} fechaAFIP - Fecha en formato AFIP
 * @returns {string} Fecha en formato ISO
 */
const desdeFormatoAFIP = (fechaAFIP) => {
    if (!fechaAFIP || fechaAFIP.length !== 8) {
        console.warn('⚠️ [FACTURACION-TZ] Fecha AFIP inválida:', fechaAFIP);
        return null;
    }
    
    const year = fechaAFIP.substring(0, 4);
    const month = fechaAFIP.substring(4, 6);
    const day = fechaAFIP.substring(6, 8);
    
    return `${year}-${month}-${day}`;
};

/**
 * Parsear fecha en zona horaria de Argentina
 * @param {string|Date} fecha - Fecha a parsear
 * @returns {moment.Moment} Momento en Argentina
 */
const parsearFecha = (fecha) => {
    return moment(fecha).tz(TIMEZONE);
};

/**
 * Formatear fecha para display (DD/MM/YYYY)
 * @param {string|Date|moment.Moment} fecha - Fecha a formatear
 * @returns {string} Fecha formateada
 */
const formatearFecha = (fecha) => {
    if (!fecha) {
        return '';
    }
    return moment(fecha).tz(TIMEZONE).format('DD/MM/YYYY');
};

/**
 * Formatear timestamp para display (DD/MM/YYYY HH:mm:ss)
 * @param {string|Date|moment.Moment} timestamp - Timestamp a formatear
 * @returns {string} Timestamp formateado
 */
const formatearTimestamp = (timestamp) => {
    if (!timestamp) {
        return '';
    }
    return moment(timestamp).tz(TIMEZONE).format('DD/MM/YYYY HH:mm:ss');
};

/**
 * Validar si una fecha es válida
 * @param {string|Date} fecha - Fecha a validar
 * @returns {boolean} True si es válida
 */
const esFechaValida = (fecha) => {
    return moment(fecha).isValid();
};

/**
 * Calcular diferencia en días entre dos fechas
 * @param {string|Date} fecha1 - Primera fecha
 * @param {string|Date} fecha2 - Segunda fecha
 * @returns {number} Diferencia en días
 */
const diferenciaEnDias = (fecha1, fecha2) => {
    const m1 = moment(fecha1).tz(TIMEZONE);
    const m2 = moment(fecha2).tz(TIMEZONE);
    return m1.diff(m2, 'days');
};

/**
 * Agregar días a una fecha
 * @param {string|Date} fecha - Fecha base
 * @param {number} dias - Días a agregar
 * @returns {moment.Moment} Nueva fecha
 */
const agregarDias = (fecha, dias) => {
    return moment(fecha).tz(TIMEZONE).add(dias, 'days');
};

/**
 * Verificar si una fecha está en el pasado
 * @param {string|Date} fecha - Fecha a verificar
 * @returns {boolean} True si está en el pasado
 */
const esDelPasado = (fecha) => {
    return moment(fecha).tz(TIMEZONE).isBefore(ahora());
};

/**
 * Verificar si una fecha está en el futuro
 * @param {string|Date} fecha - Fecha a verificar
 * @returns {boolean} True si está en el futuro
 */
const esDelFuturo = (fecha) => {
    return moment(fecha).tz(TIMEZONE).isAfter(ahora());
};

/**
 * Obtener inicio del día
 * @param {string|Date} fecha - Fecha (opcional, por defecto hoy)
 * @returns {moment.Moment} Inicio del día
 */
const inicioDia = (fecha = null) => {
    if (fecha) {
        return moment(fecha).tz(TIMEZONE).startOf('day');
    }
    return ahora().startOf('day');
};

/**
 * Obtener fin del día
 * @param {string|Date} fecha - Fecha (opcional, por defecto hoy)
 * @returns {moment.Moment} Fin del día
 */
const finDia = (fecha = null) => {
    if (fecha) {
        return moment(fecha).tz(TIMEZONE).endOf('day');
    }
    return ahora().endOf('day');
};

/**
 * Convertir timestamp de BD (TIMESTAMPTZ) a formato local
 * @param {string} timestampBD - Timestamp de la BD
 * @returns {moment.Moment} Momento en zona horaria local
 */
const desdeBD = (timestampBD) => {
    return moment(timestampBD).tz(TIMEZONE);
};

/**
 * Preparar fecha para insertar en BD (TIMESTAMPTZ)
 * @param {string|Date|moment.Moment} fecha - Fecha a preparar
 * @returns {string} Timestamp en formato ISO
 */
const paraBD = (fecha = null) => {
    if (!fecha) {
        return ahora().toISOString();
    }
    return moment(fecha).tz(TIMEZONE).toISOString();
};

/**
 * Obtener información de zona horaria
 * @returns {Object} Información de TZ
 */
const infoTimezone = () => {
    const now = ahora();
    return {
        timezone: TIMEZONE,
        offset: now.format('Z'),
        offsetMinutes: now.utcOffset(),
        isDST: now.isDST(),
        timestamp: now.toISOString(),
        formatted: now.format('YYYY-MM-DD HH:mm:ss Z')
    };
};

// Log de información inicial
console.log('📋 [FACTURACION-TZ] Información de zona horaria:');
const info = infoTimezone();
console.log(`   - Timezone: ${info.timezone}`);
console.log(`   - Offset: ${info.offset}`);
console.log(`   - Timestamp: ${info.formatted}`);

module.exports = {
    TIMEZONE,
    ahora,
    fechaActual,
    timestampActual,
    formatoAFIP,
    desdeFormatoAFIP,
    parsearFecha,
    formatearFecha,
    formatearTimestamp,
    esFechaValida,
    diferenciaEnDias,
    agregarDias,
    esDelPasado,
    esDelFuturo,
    inicioDia,
    finDia,
    desdeBD,
    paraBD,
    infoTimezone
};
