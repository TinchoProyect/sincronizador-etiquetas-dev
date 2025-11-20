/**
 * Utilidades de validación para facturación
 */

const { TIPOS_COMPROBANTE, TIPOS_DOCUMENTO, CONDICIONES_IVA, ALICUOTAS_IVA } = require('../config/afip');
const { esNumeroValido, esPositivo } = require('./decimales');

console.log('🔍 [FACTURACION-VALIDACIONES] Cargando utilidades de validación...');

/**
 * Validar CUIT/CUIL
 * @param {string} cuit - CUIT a validar (sin guiones)
 * @returns {Object} Resultado de validación
 */
const validarCUIT = (cuit) => {
    console.log('🔍 [FACTURACION-VALIDACIONES] Validando CUIT:', cuit);
    
    if (!cuit) {
        return { valido: false, error: 'CUIT no proporcionado' };
    }
    
    // Remover guiones y espacios
    const cuitLimpio = String(cuit).replace(/[-\s]/g, '');
    
    // Verificar longitud
    if (cuitLimpio.length !== 11) {
        return { valido: false, error: 'CUIT debe tener 11 dígitos' };
    }
    
    // Verificar que sean solo números
    if (!/^\d+$/.test(cuitLimpio)) {
        return { valido: false, error: 'CUIT debe contener solo números' };
    }
    
    // Validar dígito verificador
    const multiplicadores = [5, 4, 3, 2, 7, 6, 5, 4, 3, 2];
    let suma = 0;
    
    for (let i = 0; i < 10; i++) {
        suma += parseInt(cuitLimpio[i]) * multiplicadores[i];
    }
    
    const resto = suma % 11;
    const digitoVerificador = resto === 0 ? 0 : resto === 1 ? 9 : 11 - resto;
    
    if (parseInt(cuitLimpio[10]) !== digitoVerificador) {
        return { valido: false, error: 'Dígito verificador inválido' };
    }
    
    console.log('✅ [FACTURACION-VALIDACIONES] CUIT válido');
    return { valido: true };
};

/**
 * Validar DNI
 * @param {string} dni - DNI a validar
 * @returns {Object} Resultado de validación
 */
const validarDNI = (dni) => {
    console.log('🔍 [FACTURACION-VALIDACIONES] Validando DNI:', dni);
    
    if (!dni) {
        return { valido: false, error: 'DNI no proporcionado' };
    }
    
    const dniLimpio = String(dni).replace(/[.\s]/g, '');
    
    if (!/^\d{7,8}$/.test(dniLimpio)) {
        return { valido: false, error: 'DNI debe tener 7 u 8 dígitos' };
    }
    
    console.log('✅ [FACTURACION-VALIDACIONES] DNI válido');
    return { valido: true };
};

/**
 * Validar documento según tipo
 * @param {number} tipoDoc - Tipo de documento
 * @param {string} nroDoc - Número de documento
 * @returns {Object} Resultado de validación
 */
const validarDocumento = (tipoDoc, nroDoc) => {
    console.log('🔍 [FACTURACION-VALIDACIONES] Validando documento tipo:', tipoDoc, 'nro:', nroDoc);
    
    // Consumidor Final puede no tener documento
    if (tipoDoc === 99 && (!nroDoc || nroDoc === '0')) {
        return { valido: true };
    }
    
    // CUIT
    if (tipoDoc === 80 || tipoDoc === 86) {
        return validarCUIT(nroDoc);
    }
    
    // DNI
    if (tipoDoc === 96) {
        return validarDNI(nroDoc);
    }
    
    // Otros tipos: validar que no esté vacío
    if (!nroDoc || nroDoc.trim() === '') {
        return { valido: false, error: 'Número de documento requerido' };
    }
    
    console.log('✅ [FACTURACION-VALIDACIONES] Documento válido');
    return { valido: true };
};

/**
 * Validar tipo de comprobante
 * @param {number} tipoCbte - Tipo de comprobante
 * @returns {Object} Resultado de validación
 */
const validarTipoComprobante = (tipoCbte) => {
    console.log('🔍 [FACTURACION-VALIDACIONES] Validando tipo de comprobante:', tipoCbte);
    
    if (!tipoCbte) {
        return { valido: false, error: 'Tipo de comprobante no proporcionado' };
    }
    
    if (!TIPOS_COMPROBANTE[tipoCbte]) {
        return { 
            valido: false, 
            error: `Tipo de comprobante ${tipoCbte} no válido`,
            tiposValidos: Object.keys(TIPOS_COMPROBANTE)
        };
    }
    
    console.log('✅ [FACTURACION-VALIDACIONES] Tipo de comprobante válido:', TIPOS_COMPROBANTE[tipoCbte]);
    return { valido: true, descripcion: TIPOS_COMPROBANTE[tipoCbte] };
};

/**
 * Validar punto de venta
 * @param {number} ptoVta - Punto de venta
 * @returns {Object} Resultado de validación
 */
const validarPuntoVenta = (ptoVta) => {
    console.log('🔍 [FACTURACION-VALIDACIONES] Validando punto de venta:', ptoVta);
    
    if (!ptoVta) {
        return { valido: false, error: 'Punto de venta no proporcionado' };
    }
    
    const ptoVtaNum = parseInt(ptoVta);
    
    if (isNaN(ptoVtaNum) || ptoVtaNum < 1 || ptoVtaNum > 9999) {
        return { valido: false, error: 'Punto de venta debe estar entre 1 y 9999' };
    }
    
    console.log('✅ [FACTURACION-VALIDACIONES] Punto de venta válido');
    return { valido: true };
};

/**
 * Validar concepto
 * @param {number} concepto - Concepto (1: Productos, 2: Servicios, 3: Ambos)
 * @returns {Object} Resultado de validación
 */
const validarConcepto = (concepto) => {
    console.log('🔍 [FACTURACION-VALIDACIONES] Validando concepto:', concepto);
    
    if (!concepto) {
        return { valido: false, error: 'Concepto no proporcionado' };
    }
    
    if (![1, 2, 3].includes(parseInt(concepto))) {
        return { valido: false, error: 'Concepto debe ser 1 (Productos), 2 (Servicios) o 3 (Ambos)' };
    }
    
    console.log('✅ [FACTURACION-VALIDACIONES] Concepto válido');
    return { valido: true };
};

/**
 * Validar alícuota de IVA
 * @param {number} alicIvaId - ID de alícuota de IVA
 * @returns {Object} Resultado de validación
 */
const validarAlicuotaIVA = (alicIvaId) => {
    console.log('🔍 [FACTURACION-VALIDACIONES] Validando alícuota IVA:', alicIvaId);
    
    if (!alicIvaId) {
        return { valido: false, error: 'Alícuota de IVA no proporcionada' };
    }
    
    if (!ALICUOTAS_IVA[alicIvaId]) {
        return { 
            valido: false, 
            error: `Alícuota de IVA ${alicIvaId} no válida`,
            alicuotasValidas: Object.keys(ALICUOTAS_IVA)
        };
    }
    
    console.log('✅ [FACTURACION-VALIDACIONES] Alícuota IVA válida:', ALICUOTAS_IVA[alicIvaId].descripcion);
    return { valido: true, alicuota: ALICUOTAS_IVA[alicIvaId] };
};

/**
 * Validar condición de IVA
 * @param {number} condicionIvaId - ID de condición de IVA
 * @returns {Object} Resultado de validación
 */
const validarCondicionIVA = (condicionIvaId) => {
    console.log('🔍 [FACTURACION-VALIDACIONES] Validando condición IVA:', condicionIvaId);
    
    if (!condicionIvaId) {
        return { valido: false, error: 'Condición de IVA no proporcionada' };
    }
    
    if (!CONDICIONES_IVA[condicionIvaId]) {
        return { 
            valido: false, 
            error: `Condición de IVA ${condicionIvaId} no válida`,
            condicionesValidas: Object.keys(CONDICIONES_IVA)
        };
    }
    
    console.log('✅ [FACTURACION-VALIDACIONES] Condición IVA válida:', CONDICIONES_IVA[condicionIvaId]);
    return { valido: true, descripcion: CONDICIONES_IVA[condicionIvaId] };
};

/**
 * Validar item de factura
 * @param {Object} item - Item a validar
 * @returns {Object} Resultado de validación
 */
const validarItem = (item) => {
    console.log('🔍 [FACTURACION-VALIDACIONES] Validando item:', item?.descripcion);
    
    const errores = [];
    
    // Descripción
    if (!item.descripcion || item.descripcion.trim() === '') {
        errores.push('Descripción requerida');
    }
    
    // Cantidad
    if (!esNumeroValido(item.qty)) {
        errores.push('Cantidad inválida');
    } else if (!esPositivo(item.qty)) {
        errores.push('Cantidad debe ser positiva');
    }
    
    // Precio unitario
    if (!esNumeroValido(item.p_unit)) {
        errores.push('Precio unitario inválido');
    } else if (!esPositivo(item.p_unit)) {
        errores.push('Precio unitario debe ser positivo');
    }
    
    // Alícuota IVA
    const validacionIVA = validarAlicuotaIVA(item.alic_iva_id);
    if (!validacionIVA.valido) {
        errores.push(validacionIVA.error);
    }
    
    if (errores.length > 0) {
        console.error('❌ [FACTURACION-VALIDACIONES] Item inválido:', errores);
        return { valido: false, errores };
    }
    
    console.log('✅ [FACTURACION-VALIDACIONES] Item válido');
    return { valido: true };
};

/**
 * Validar cabecera de factura
 * @param {Object} factura - Factura a validar
 * @returns {Object} Resultado de validación
 */
const validarCabecera = (factura) => {
    console.log('🔍 [FACTURACION-VALIDACIONES] Validando cabecera de factura');
    
    const errores = [];
    
    // Tipo de comprobante
    const validacionTipo = validarTipoComprobante(factura.tipo_cbte);
    if (!validacionTipo.valido) {
        errores.push(validacionTipo.error);
    }
    
    // Punto de venta
    const validacionPtoVta = validarPuntoVenta(factura.pto_vta);
    if (!validacionPtoVta.valido) {
        errores.push(validacionPtoVta.error);
    }
    
    // Concepto
    const validacionConcepto = validarConcepto(factura.concepto);
    if (!validacionConcepto.valido) {
        errores.push(validacionConcepto.error);
    }
    
    // Documento
    if (factura.doc_tipo && factura.doc_nro) {
        const validacionDoc = validarDocumento(factura.doc_tipo, factura.doc_nro);
        if (!validacionDoc.valido) {
            errores.push(validacionDoc.error);
        }
    }
    
    // Condición IVA
    if (factura.condicion_iva_id) {
        const validacionCondIVA = validarCondicionIVA(factura.condicion_iva_id);
        if (!validacionCondIVA.valido) {
            errores.push(validacionCondIVA.error);
        }
    }
    
    // Serie interna (si no requiere AFIP)
    if (factura.requiere_afip === false && !factura.serie_interna) {
        errores.push('Serie interna requerida para factura sin AFIP');
    }
    
    if (errores.length > 0) {
        console.error('❌ [FACTURACION-VALIDACIONES] Cabecera inválida:', errores);
        return { valido: false, errores };
    }
    
    console.log('✅ [FACTURACION-VALIDACIONES] Cabecera válida');
    return { valido: true };
};

/**
 * Validar factura completa (cabecera + items)
 * @param {Object} factura - Factura a validar
 * @returns {Object} Resultado de validación
 */
const validarFacturaCompleta = (factura) => {
    console.log('🔍 [FACTURACION-VALIDACIONES] Validando factura completa');
    
    const errores = [];
    
    // Validar cabecera
    const validacionCabecera = validarCabecera(factura);
    if (!validacionCabecera.valido) {
        errores.push(...validacionCabecera.errores);
    }
    
    // Validar items
    if (!factura.items || !Array.isArray(factura.items) || factura.items.length === 0) {
        errores.push('Debe incluir al menos un item');
    } else {
        factura.items.forEach((item, index) => {
            const validacionItem = validarItem(item);
            if (!validacionItem.valido) {
                errores.push(`Item ${index + 1}: ${validacionItem.errores.join(', ')}`);
            }
        });
    }
    
    if (errores.length > 0) {
        console.error('❌ [FACTURACION-VALIDACIONES] Factura inválida:', errores);
        return { valido: false, errores };
    }
    
    console.log('✅ [FACTURACION-VALIDACIONES] Factura completa válida');
    return { valido: true };
};

/**
 * Validar estado de factura
 * @param {string} estado - Estado a validar
 * @returns {Object} Resultado de validación
 */
const validarEstado = (estado) => {
    const estadosValidos = ['BORRADOR', 'APROBADA', 'RECHAZADA', 'APROBADA_LOCAL', 'ANULADA'];
    
    if (!estado) {
        return { valido: false, error: 'Estado no proporcionado' };
    }
    
    if (!estadosValidos.includes(estado)) {
        return { 
            valido: false, 
            error: `Estado ${estado} no válido`,
            estadosValidos
        };
    }
    
    return { valido: true };
};

/**
 * Validar que una factura pueda ser emitida
 * @param {Object} factura - Factura a validar
 * @returns {Object} Resultado de validación
 */
const puedeEmitirse = (factura) => {
    console.log('🔍 [FACTURACION-VALIDACIONES] Validando si puede emitirse factura ID:', factura.id);
    
    const errores = [];
    
    // Se pueden emitir borradores y reprocesar rechazadas
    if (factura.estado !== 'BORRADOR' && factura.estado !== 'RECHAZADA') {
        errores.push(`Factura en estado ${factura.estado}, solo se pueden emitir borradores o reprocesar rechazadas`);
    }
    
    // Si es RECHAZADA, permitir reprocesar (limpiar CAE y número anterior)
    if (factura.estado === 'RECHAZADA') {
        console.log('⚠️ [FACTURACION-VALIDACIONES] Factura RECHAZADA - permitiendo reprocesar');
        // No validar CAE ni cbte_nro para rechazadas, se limpiarán al reprocesar
        return { valido: true, esReproceso: true };
    }
    
    // Para BORRADOR, validar que no tenga CAE ni número
    if (factura.cae) {
        errores.push('Factura ya tiene CAE asignado');
    }
    
    if (factura.cbte_nro) {
        errores.push('Factura ya tiene número de comprobante asignado');
    }
    
    if (errores.length > 0) {
        console.error('❌ [FACTURACION-VALIDACIONES] No puede emitirse:', errores);
        return { valido: false, errores };
    }
    
    console.log('✅ [FACTURACION-VALIDACIONES] Puede emitirse');
    return { valido: true, esReproceso: false };
};

console.log('✅ [FACTURACION-VALIDACIONES] Utilidades de validación cargadas');

module.exports = {
    validarCUIT,
    validarDNI,
    validarDocumento,
    validarTipoComprobante,
    validarPuntoVenta,
    validarConcepto,
    validarAlicuotaIVA,
    validarCondicionIVA,
    validarItem,
    validarCabecera,
    validarFacturaCompleta,
    validarEstado,
    puedeEmitirse
};
