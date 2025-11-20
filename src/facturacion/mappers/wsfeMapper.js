/**
 * Mapper para construir payloads de WSFE
 * Transforma datos de factura a formato AFIP
 */

const { ALICUOTAS_IVA } = require('../config/afip');
const { formatoAFIP } = require('../config/timezone');
const { formatoAFIP: formatoDecimalAFIP } = require('../utils/decimales');

console.log('🔍 [FACTURACION-MAPPER] Cargando mapper WSFE...');

/**
 * Construir payload para FECAESolicitar
 * @param {Object} factura - Datos de la factura
 * @param {Object} auth - Credenciales de autenticación
 * @returns {Object} Payload para WSFE
 */
const construirFECAESolicitar = (factura, auth) => {
    console.log('🔍 [FACTURACION-MAPPER] Construyendo payload FECAESolicitar...');
    
    try {
        // Construir cabecera
        const feCabReq = {
            CantReg: 1,
            PtoVta: factura.pto_vta,
            CbteTipo: factura.tipo_cbte
        };
        
        // Construir detalle
        const docTipo = factura.doc_tipo;
        const docNro = factura.doc_nro;

        // LOG DE DEPURACIÓN: Mostrar DocTipo elegido y motivo
        let motivoDocTipo = 'Desconocido';
        if (docTipo === 80) motivoDocTipo = 'CUIT válido';
        else if (docTipo === 86) motivoDocTipo = 'CUIL válido';
        else if (docTipo === 96) motivoDocTipo = 'DNI válido';
        else if (docTipo === 99) motivoDocTipo = 'Consumidor Final (sin documento)';
        else motivoDocTipo = `Tipo ${docTipo} no reconocido`;

        console.log('[WSFE] DocTipo seleccionado:', docTipo, 'DocNro:', docNro, 'motivo:', motivoDocTipo);

        // VALIDACIÓN: No permitir 99 si hay documento válido
        if (docTipo === 99 && docNro && docNro !== '0' && docNro !== '') {
            console.warn('[WSFE] ALERTA: DocTipo=99 pero DocNro no está vacío:', docNro);
        }

        // Calcular totales correctos separando gravados y exentos
        const totales = calcularTotalesWSFE(factura.items);
        
        console.log('[WSFE] Totales calculados:', {
            ImpNeto: totales.impNeto,
            ImpOpEx: totales.impOpEx,
            ImpIVA: totales.impIVA,
            ImpTotal: totales.impTotal
        });

        const feDetReq = {
            Concepto: factura.concepto,
            DocTipo: docTipo,
            DocNro: docNro,
            CbteDesde: factura.cbte_nro,
            CbteHasta: factura.cbte_nro,
            CbteFch: formatoAFIP(factura.fecha_emision),
            ImpTotal: formatoDecimalAFIP(totales.impTotal),
            ImpTotConc: formatoDecimalAFIP(0), // Conceptos no gravados
            ImpNeto: formatoDecimalAFIP(totales.impNeto), // Solo bases gravadas
            ImpOpEx: formatoDecimalAFIP(totales.impOpEx), // Solo bases exentas
            ImpTrib: formatoDecimalAFIP(factura.imp_trib || 0),
            ImpIVA: formatoDecimalAFIP(totales.impIVA),
            MonId: factura.moneda || 'PES',
            MonCotiz: formatoDecimalAFIP(factura.mon_cotiz || 1)
        };
        
        // CRÍTICO: Agregar CondicionIVAReceptorId (obligatorio para CF y otros)
        // Si no está en la factura, inferir desde doc_tipo
        if (factura.condicion_iva_id) {
            feDetReq.CondicionIVAReceptorId = factura.condicion_iva_id;
            console.log(`✅ [FACTURACION-MAPPER] CondicionIVAReceptorId: ${factura.condicion_iva_id}`);
        } else if (factura.doc_tipo === 99) {
            // Consumidor Final
            feDetReq.CondicionIVAReceptorId = 5;
            console.log(`✅ [FACTURACION-MAPPER] CondicionIVAReceptorId inferido: 5 (CF)`);
        } else {
            console.warn(`⚠️ [FACTURACION-MAPPER] CondicionIVAReceptorId no especificado`);
        }
        
        // Construir array de IVA
        const iva = construirArrayIVA(factura.items);
        
        const payload = {
            auth: {
                Token: auth.token,
                Sign: auth.sign,
                Cuit: auth.cuit
            },
            feCAEReq: {
                FeCabReq: feCabReq,
                ...feDetReq,
                iva
            }
        };
        
        console.log('✅ [FACTURACION-MAPPER] Payload construido');
        
        return payload;
        
    } catch (error) {
        console.error('❌ [FACTURACION-MAPPER] Error construyendo payload:', error.message);
        throw error;
    }
};

/**
 * Calcular totales correctos para WSFE separando gravados y exentos
 * @param {Array} items - Items de la factura
 * @returns {Object} Totales calculados
 */
const calcularTotalesWSFE = (items) => {
    console.log('🧮 [FACTURACION-MAPPER] Calculando totales WSFE...');
    
    let impNeto = 0;   // Solo bases gravadas (21% + 10.5%)
    let impOpEx = 0;   // Solo bases exentas (0%)
    let impIVA = 0;    // Suma de IVA (21% + 10.5%)
    
    items.forEach(item => {
        const alicId = parseInt(item.alic_iva_id);
        const baseImp = parseFloat(item.imp_neto) || 0;
        const impIva = parseFloat(item.imp_iva) || 0;
        
        // Código 3 = Exento (0%)
        if (alicId === 3) {
            impOpEx += baseImp;
        } else {
            // Códigos 4 (10.5%), 5 (21%), 6 (27%), etc. = Gravados
            impNeto += baseImp;
            impIVA += impIva;
        }
    });
    
    const impTotal = impNeto + impOpEx + impIVA;
    
    console.log('📊 [FACTURACION-MAPPER] Totales:', {
        ImpNeto: impNeto.toFixed(2),
        ImpOpEx: impOpEx.toFixed(2),
        ImpIVA: impIVA.toFixed(2),
        ImpTotal: impTotal.toFixed(2)
    });
    
    return {
        impNeto: Math.round(impNeto * 100) / 100,
        impOpEx: Math.round(impOpEx * 100) / 100,
        impIVA: Math.round(impIVA * 100) / 100,
        impTotal: Math.round(impTotal * 100) / 100
    };
};

/**
 * Construir array de IVA agrupado por alícuota
 * @param {Array} items - Items de la factura
 * @returns {Array} Array de IVA para AFIP
 */
const construirArrayIVA = (items) => {
    console.log('🔍 [FACTURACION-MAPPER] Construyendo array de IVA...');
    
    // Agrupar por alícuota
    const ivaAgrupado = {};
    
    items.forEach(item => {
        const alicId = parseInt(item.alic_iva_id);
        const baseImp = parseFloat(item.imp_neto) || 0;
        const impIva = parseFloat(item.imp_iva) || 0;
        
        if (!ivaAgrupado[alicId]) {
            ivaAgrupado[alicId] = {
                Id: alicId,
                BaseImp: 0,
                Importe: 0
            };
        }
        
        ivaAgrupado[alicId].BaseImp += baseImp;
        ivaAgrupado[alicId].Importe += impIva;
    });
    
    // Convertir a array, formatear y ordenar por código
    const ivaArray = Object.values(ivaAgrupado)
        .map(iva => ({
            Id: iva.Id,
            BaseImp: formatoDecimalAFIP(iva.BaseImp),
            Importe: formatoDecimalAFIP(iva.Importe)
        }))
        .sort((a, b) => a.Id - b.Id); // Ordenar por código
    
    console.log(`✅ [FACTURACION-MAPPER] ${ivaArray.length} alícuotas agrupadas:`, 
        ivaArray.map(a => `Código ${a.Id}: Base=${a.BaseImp}, IVA=${a.Importe}`));
    
    return ivaArray;
};

/**
 * Construir payload para FECompUltimoAutorizado
 * @param {number} ptoVta - Punto de venta
 * @param {number} cbteTipo - Tipo de comprobante
 * @param {Object} auth - Credenciales de autenticación
 * @returns {Object} Payload para WSFE
 */
const construirFECompUltimoAutorizado = (ptoVta, cbteTipo, auth) => {
    console.log('🔍 [FACTURACION-MAPPER] Construyendo payload FECompUltimoAutorizado...');
    
    return {
        auth: {
            Token: auth.token,
            Sign: auth.sign,
            Cuit: auth.cuit
        },
        ptoVta,
        cbteTipo
    };
};

/**
 * Construir payload para FECompConsultar
 * @param {number} ptoVta - Punto de venta
 * @param {number} cbteTipo - Tipo de comprobante
 * @param {number} cbteNro - Número de comprobante
 * @param {Object} auth - Credenciales de autenticación
 * @returns {Object} Payload para WSFE
 */
const construirFECompConsultar = (ptoVta, cbteTipo, cbteNro, auth) => {
    console.log('🔍 [FACTURACION-MAPPER] Construyendo payload FECompConsultar...');
    
    return {
        auth: {
            Token: auth.token,
            Sign: auth.sign,
            Cuit: auth.cuit
        },
        feCompConsReq: {
            PtoVta: ptoVta,
            CbteTipo: cbteTipo,
            CbteNro: cbteNro
        }
    };
};

/**
 * Parsear respuesta de FECAESolicitar
 * @param {Object} response - Respuesta de AFIP
 * @returns {Object} Datos parseados
 */
const parsearRespuestaCAE = (response) => {
    console.log('🔍 [FACTURACION-MAPPER] Parseando respuesta CAE...');
    
    try {
        // STUB: Implementación simplificada
        // En producción, parsear XML/SOAP real
        
        const resultado = {
            cae: response.CAE || response.cae,
            cae_vto: response.CAEFchVto || response.cae_vto,
            resultado: response.Resultado || response.resultado || 'A',
            observaciones: response.Observaciones || response.observaciones || []
        };
        
        console.log('✅ [FACTURACION-MAPPER] Respuesta parseada');
        
        return resultado;
        
    } catch (error) {
        console.error('❌ [FACTURACION-MAPPER] Error parseando respuesta:', error.message);
        throw error;
    }
};

console.log('✅ [FACTURACION-MAPPER] Mapper WSFE cargado');

module.exports = {
    construirFECAESolicitar,
    construirFECompUltimoAutorizado,
    construirFECompConsultar,
    calcularTotalesWSFE,
    construirArrayIVA,
    parsearRespuestaCAE
};
