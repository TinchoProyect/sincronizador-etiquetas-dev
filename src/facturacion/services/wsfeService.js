/**
 * Servicio WSFE (Web Service de Facturación Electrónica)
 * Gestiona la emisión de comprobantes electrónicos con AFIP
 */

const { pool } = require('../config/database');
const { obtenerConfiguracion } = require('../config/afip');
const { formatoAFIP } = require('../config/timezone');
const { getTA } = require('./wsaaService');

console.log('🔍 [FACTURACION-WSFE] Cargando servicio WSFE...');

/**
 * Obtener último comprobante autorizado por AFIP
 * @param {number} ptoVta - Punto de venta
 * @param {number} tipoCbte - Tipo de comprobante
 * @param {string} entorno - 'HOMO' o 'PROD'
 * @returns {Promise<number>} Último número autorizado
 */
const ultimoAutorizado = async (ptoVta, tipoCbte, entorno = 'HOMO') => {
    console.log(`🔍 [FACTURACION-WSFE] Consultando último autorizado PV:${ptoVta} Tipo:${tipoCbte}`);
    
    try {
        // STUB: Implementación simplificada
        console.log(`⚠️ [FACTURACION-WSFE] STUB: Simulando consulta a AFIP`);
        
        // 1. Obtener TA
        const ta = await getTA(entorno);
        console.log(`✅ [FACTURACION-WSFE] TA obtenido`);
        
        // 2. Consultar en BD local primero
        const ultimoLocal = await obtenerUltimoLocalAfip(ptoVta, tipoCbte);
        console.log(`📊 [FACTURACION-WSFE] Último local: ${ultimoLocal}`);
        
        // STUB: En producción, hacer request SOAP a AFIP
        // const ultimoAfip = await consultarAfipUltimoAutorizado(ptoVta, tipoCbte, ta);
        
        // Por ahora, devolver el último local
        return ultimoLocal;
        
    } catch (error) {
        console.error('❌ [FACTURACION-WSFE] Error consultando último autorizado:', error.message);
        throw error;
    }
};

/**
 * Solicitar CAE (Código de Autorización Electrónico)
 * @param {number} facturaId - ID de la factura
 * @param {string} entorno - 'HOMO' o 'PROD'
 * @returns {Promise<Object>} Resultado con CAE
 */
const solicitarCAE = async (facturaId, entorno = 'HOMO') => {
    console.log(`📄 [FACTURACION-WSFE] Solicitando CAE para factura ID: ${facturaId}`);
    
    try {
        // STUB: Implementación simplificada
        console.log(`⚠️ [FACTURACION-WSFE] STUB: Simulando solicitud de CAE`);
        
        // 1. Obtener datos de la factura
        const factura = await obtenerFacturaParaCAE(facturaId);
        console.log(`✅ [FACTURACION-WSFE] Factura obtenida`);
        
        // 2. Obtener TA
        const ta = await getTA(entorno);
        console.log(`✅ [FACTURACION-WSFE] TA obtenido`);
        
        // 3. Construir request SOAP (STUB)
        console.log(`📝 [FACTURACION-WSFE] Construyendo request FECAESolicitar...`);
        
        // STUB: En producción, hacer request SOAP real a AFIP
        // const response = await enviarFECAESolicitar(factura, ta);
        
        // Simular respuesta exitosa
        const mockCAE = {
            cae: `74${Date.now().toString().slice(-10)}`,
            cae_vto: formatoAFIP(new Date(Date.now() + 10 * 24 * 60 * 60 * 1000)), // +10 días
            resultado: 'A',
            observaciones: []
        };
        
        console.log(`✅ [FACTURACION-WSFE] CAE obtenido: ${mockCAE.cae}`);
        console.log(`📅 [FACTURACION-WSFE] Vencimiento: ${mockCAE.cae_vto}`);
        
        // 4. Guardar log en BD
        await guardarLogWSFE(facturaId, 'FECAESolicitar', null, null, mockCAE);
        
        return mockCAE;
        
    } catch (error) {
        console.error('❌ [FACTURACION-WSFE] Error solicitando CAE:', error.message);
        
        // Guardar log de error
        await guardarLogWSFE(facturaId, 'FECAESolicitar', null, null, {
            resultado: 'R',
            observaciones: [error.message]
        });
        
        throw error;
    }
};

/**
 * Consultar comprobante en AFIP
 * @param {number} ptoVta - Punto de venta
 * @param {number} tipoCbte - Tipo de comprobante
 * @param {number} cbteNro - Número de comprobante
 * @param {string} entorno - 'HOMO' o 'PROD'
 * @returns {Promise<Object>} Datos del comprobante
 */
const consultarComprobante = async (ptoVta, tipoCbte, cbteNro, entorno = 'HOMO') => {
    console.log(`🔍 [FACTURACION-WSFE] Consultando comprobante PV:${ptoVta} Tipo:${tipoCbte} Nro:${cbteNro}`);
    
    try {
        // STUB: Implementación simplificada
        console.log(`⚠️ [FACTURACION-WSFE] STUB: Simulando consulta de comprobante`);
        
        // 1. Obtener TA
        const ta = await getTA(entorno);
        console.log(`✅ [FACTURACION-WSFE] TA obtenido`);
        
        // STUB: En producción, hacer request SOAP a AFIP
        // const comprobante = await consultarAfipComprobante(ptoVta, tipoCbte, cbteNro, ta);
        
        // Simular respuesta
        const mockComprobante = {
            encontrado: true,
            ptoVta,
            tipoCbte,
            cbteNro,
            cae: `74${Date.now().toString().slice(-10)}`,
            estado: 'APROBADA'
        };
        
        console.log(`✅ [FACTURACION-WSFE] Comprobante consultado`);
        
        return mockComprobante;
        
    } catch (error) {
        console.error('❌ [FACTURACION-WSFE] Error consultando comprobante:', error.message);
        throw error;
    }
};

/**
 * Obtener último número local de AFIP
 * @param {number} ptoVta - Punto de venta
 * @param {number} tipoCbte - Tipo de comprobante
 * @returns {Promise<number>} Último número
 */
const obtenerUltimoLocalAfip = async (ptoVta, tipoCbte) => {
    console.log(`🔍 [FACTURACION-WSFE] Obteniendo último local AFIP PV:${ptoVta} Tipo:${tipoCbte}`);
    
    try {
        const query = `
            SELECT ultimo_cbte_afip
            FROM factura_numeracion_afip
            WHERE pto_vta = $1 AND tipo_cbte = $2
        `;
        
        const resultado = await pool.query(query, [ptoVta, tipoCbte]);
        
        if (resultado.rows.length > 0) {
            const ultimo = resultado.rows[0].ultimo_cbte_afip;
            console.log(`✅ [FACTURACION-WSFE] Último local: ${ultimo}`);
            return ultimo;
        }
        
        console.log(`📝 [FACTURACION-WSFE] No hay registro, iniciando en 0`);
        return 0;
        
    } catch (error) {
        console.error('❌ [FACTURACION-WSFE] Error obteniendo último local:', error.message);
        throw error;
    }
};

/**
 * Obtener factura para solicitar CAE
 * @param {number} facturaId - ID de la factura
 * @returns {Promise<Object>} Datos de la factura
 */
const obtenerFacturaParaCAE = async (facturaId) => {
    console.log(`🔍 [FACTURACION-WSFE] Obteniendo factura ID: ${facturaId}`);
    
    try {
        const query = `
            SELECT 
                f.*,
                json_agg(
                    json_build_object(
                        'descripcion', i.descripcion,
                        'qty', i.qty,
                        'p_unit', i.p_unit,
                        'alic_iva_id', i.alic_iva_id,
                        'imp_neto', i.imp_neto,
                        'imp_iva', i.imp_iva
                    ) ORDER BY i.orden
                ) as items
            FROM factura_facturas f
            LEFT JOIN factura_factura_items i ON f.id = i.factura_id
            WHERE f.id = $1
            GROUP BY f.id
        `;
        
        const resultado = await pool.query(query, [facturaId]);
        
        if (resultado.rows.length === 0) {
            throw new Error(`Factura ${facturaId} no encontrada`);
        }
        
        console.log(`✅ [FACTURACION-WSFE] Factura obtenida`);
        return resultado.rows[0];
        
    } catch (error) {
        console.error('❌ [FACTURACION-WSFE] Error obteniendo factura:', error.message);
        throw error;
    }
};

/**
 * Guardar log de operación WSFE
 * @param {number} facturaId - ID de la factura
 * @param {string} metodo - Método WSFE llamado
 * @param {string} requestXml - XML del request
 * @param {string} responseXml - XML de la respuesta
 * @param {Object} resultado - Resultado parseado
 * @returns {Promise<void>}
 */
const guardarLogWSFE = async (facturaId, metodo, requestXml, responseXml, resultado) => {
    console.log(`💾 [FACTURACION-WSFE] Guardando log para factura ID: ${facturaId}`);
    
    try {
        const query = `
            INSERT INTO factura_afip_wsfe_logs 
            (factura_id, metodo, request_xml, response_xml, observaciones, resultado, creado_en)
            VALUES ($1, $2, $3, $4, $5, $6, NOW())
        `;
        
        const observaciones = resultado.observaciones 
            ? JSON.stringify(resultado.observaciones) 
            : null;
        
        await pool.query(query, [
            facturaId,
            metodo,
            requestXml,
            responseXml,
            observaciones,
            resultado.resultado
        ]);
        
        console.log(`✅ [FACTURACION-WSFE] Log guardado`);
        
    } catch (error) {
        console.error('❌ [FACTURACION-WSFE] Error guardando log:', error.message);
        // No lanzar error, solo logear
    }
};

console.log('✅ [FACTURACION-WSFE] Servicio WSFE cargado');

module.exports = {
    ultimoAutorizado,
    solicitarCAE,
    consultarComprobante
};
