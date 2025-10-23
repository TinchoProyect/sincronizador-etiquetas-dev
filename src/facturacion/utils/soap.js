/**
 * Utilidades para manejo de SOAP (XML)
 * Construcción y parseo de mensajes SOAP para AFIP
 */

const xml2js = require('xml2js');

console.log('🔍 [FACTURACION-SOAP] Cargando utilidades SOAP...');

/**
 * Construir envelope SOAP básico
 * @param {string} body - Contenido del body
 * @param {string} namespace - Namespace del servicio
 * @returns {string} XML SOAP completo
 */
const construirEnvelope = (body, namespace = '') => {
    const nsAttr = namespace ? ` xmlns="${namespace}"` : '';
    
    return `<?xml version="1.0" encoding="UTF-8"?>
<soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/"${nsAttr}>
    <soap:Body>
        ${body}
    </soap:Body>
</soap:Envelope>`;
};

/**
 * Construir LoginTicketRequest para WSAA
 * @param {string} servicio - Servicio a autenticar (ej: 'wsfe')
 * @param {string} cuit - CUIT del emisor
 * @returns {string} XML del LoginTicketRequest
 */
const construirLoginTicketRequest = (servicio, cuit) => {
    console.log('🔍 [FACTURACION-SOAP] Construyendo LoginTicketRequest para servicio:', servicio);
    
    const now = new Date();
    const generationTime = now.toISOString();
    const expirationTime = new Date(now.getTime() + 12 * 60 * 60 * 1000).toISOString(); // +12 horas
    const uniqueId = Math.floor(Math.random() * 1000000000);
    
    return `<?xml version="1.0" encoding="UTF-8"?>
<loginTicketRequest version="1.0">
    <header>
        <uniqueId>${uniqueId}</uniqueId>
        <generationTime>${generationTime}</generationTime>
        <expirationTime>${expirationTime}</expirationTime>
    </header>
    <service>${servicio}</service>
</loginTicketRequest>`;
};

/**
 * Construir request SOAP para FECAESolicitar
 * @param {Object} params - Parámetros del request
 * @returns {string} XML SOAP
 */
const construirFECAESolicitar = (params) => {
    console.log('🔍 [FACTURACION-SOAP] Construyendo FECAESolicitar');
    
    const { auth, feCAEReq } = params;
    
    // Construir array de IVA
    let ivaXML = '';
    if (feCAEReq.iva && feCAEReq.iva.length > 0) {
        const ivaItems = feCAEReq.iva.map(iva => `
            <AlicIva>
                <Id>${iva.Id}</Id>
                <BaseImp>${iva.BaseImp}</BaseImp>
                <Importe>${iva.Importe}</Importe>
            </AlicIva>
        `).join('');
        
        ivaXML = `<Iva>${ivaItems}</Iva>`;
    }
    
    // Construir array de tributos (si hay)
    let tributosXML = '';
    if (feCAEReq.tributos && feCAEReq.tributos.length > 0) {
        const tribItems = feCAEReq.tributos.map(trib => `
            <Tributo>
                <Id>${trib.Id}</Id>
                <Desc>${trib.Desc}</Desc>
                <BaseImp>${trib.BaseImp}</BaseImp>
                <Alic>${trib.Alic}</Alic>
                <Importe>${trib.Importe}</Importe>
            </Tributo>
        `).join('');
        
        tributosXML = `<Tributos>${tribItems}</Tributos>`;
    }
    
    const body = `
<FECAESolicitar xmlns="http://ar.gov.afip.dif.FEV1/">
    <Auth>
        <Token>${auth.Token}</Token>
        <Sign>${auth.Sign}</Sign>
        <Cuit>${auth.Cuit}</Cuit>
    </Auth>
    <FeCAEReq>
        <FeCabReq>
            <CantReg>${feCAEReq.FeCabReq.CantReg}</CantReg>
            <PtoVta>${feCAEReq.FeCabReq.PtoVta}</PtoVta>
            <CbteTipo>${feCAEReq.FeCabReq.CbteTipo}</CbteTipo>
        </FeCabReq>
        <FeDetReq>
            <FECAEDetRequest>
                <Concepto>${feCAEReq.Concepto}</Concepto>
                <DocTipo>${feCAEReq.DocTipo}</DocTipo>
                <DocNro>${feCAEReq.DocNro}</DocNro>
                <CbteDesde>${feCAEReq.CbteDesde}</CbteDesde>
                <CbteHasta>${feCAEReq.CbteHasta}</CbteHasta>
                <CbteFch>${feCAEReq.CbteFch}</CbteFch>
                <ImpTotal>${feCAEReq.ImpTotal}</ImpTotal>
                <ImpTotConc>${feCAEReq.ImpTotConc}</ImpTotConc>
                <ImpNeto>${feCAEReq.ImpNeto}</ImpNeto>
                <ImpOpEx>${feCAEReq.ImpOpEx}</ImpOpEx>
                <ImpTrib>${feCAEReq.ImpTrib}</ImpTrib>
                <ImpIVA>${feCAEReq.ImpIVA}</ImpIVA>
                <MonId>${feCAEReq.MonId}</MonId>
                <MonCotiz>${feCAEReq.MonCotiz}</MonCotiz>
                ${ivaXML}
                ${tributosXML}
            </FECAEDetRequest>
        </FeDetReq>
    </FeCAEReq>
</FECAESolicitar>`;
    
    return construirEnvelope(body, 'http://ar.gov.afip.dif.FEV1/');
};

/**
 * Construir request SOAP para FECompUltimoAutorizado
 * @param {Object} params - Parámetros del request
 * @returns {string} XML SOAP
 */
const construirFECompUltimoAutorizado = (params) => {
    console.log('🔍 [FACTURACION-SOAP] Construyendo FECompUltimoAutorizado');
    
    const { auth, ptoVta, cbteTipo } = params;
    
    const body = `
<FECompUltimoAutorizado xmlns="http://ar.gov.afip.dif.FEV1/">
    <Auth>
        <Token>${auth.Token}</Token>
        <Sign>${auth.Sign}</Sign>
        <Cuit>${auth.Cuit}</Cuit>
    </Auth>
    <PtoVta>${ptoVta}</PtoVta>
    <CbteTipo>${cbteTipo}</CbteTipo>
</FECompUltimoAutorizado>`;
    
    return construirEnvelope(body, 'http://ar.gov.afip.dif.FEV1/');
};

/**
 * Construir request SOAP para FECompConsultar
 * @param {Object} params - Parámetros del request
 * @returns {string} XML SOAP
 */
const construirFECompConsultar = (params) => {
    console.log('🔍 [FACTURACION-SOAP] Construyendo FECompConsultar');
    
    const { auth, feCompConsReq } = params;
    
    const body = `
<FECompConsultar xmlns="http://ar.gov.afip.dif.FEV1/">
    <Auth>
        <Token>${auth.Token}</Token>
        <Sign>${auth.Sign}</Sign>
        <Cuit>${auth.Cuit}</Cuit>
    </Auth>
    <FeCompConsReq>
        <CbteTipo>${feCompConsReq.CbteTipo}</CbteTipo>
        <CbteNro>${feCompConsReq.CbteNro}</CbteNro>
        <PtoVta>${feCompConsReq.PtoVta}</PtoVta>
    </FeCompConsReq>
</FECompConsultar>`;
    
    return construirEnvelope(body, 'http://ar.gov.afip.dif.FEV1/');
};

/**
 * Parsear respuesta XML a objeto JavaScript
 * @param {string} xml - XML a parsear
 * @returns {Promise<Object>} Objeto parseado
 */
const parsearXML = async (xml) => {
    console.log('🔍 [FACTURACION-SOAP] Parseando XML...');
    
    try {
        const parser = new xml2js.Parser({
            explicitArray: false,
            ignoreAttrs: false,
            tagNameProcessors: [xml2js.processors.stripPrefix]
        });
        
        const resultado = await parser.parseStringPromise(xml);
        console.log('✅ [FACTURACION-SOAP] XML parseado exitosamente');
        
        return resultado;
    } catch (error) {
        console.error('❌ [FACTURACION-SOAP] Error parseando XML:', error.message);
        throw error;
    }
};

/**
 * Extraer body de respuesta SOAP
 * @param {Object} soapResponse - Respuesta SOAP parseada
 * @returns {Object} Body de la respuesta
 */
const extraerBody = (soapResponse) => {
    console.log('🔍 [FACTURACION-SOAP] Extrayendo body de respuesta SOAP');
    
    try {
        if (!soapResponse || !soapResponse.Envelope || !soapResponse.Envelope.Body) {
            throw new Error('Estructura SOAP inválida');
        }
        
        const body = soapResponse.Envelope.Body;
        console.log('✅ [FACTURACION-SOAP] Body extraído exitosamente');
        
        return body;
    } catch (error) {
        console.error('❌ [FACTURACION-SOAP] Error extrayendo body:', error.message);
        throw error;
    }
};

/**
 * Extraer errores de respuesta SOAP
 * @param {Object} soapResponse - Respuesta SOAP parseada
 * @returns {Array} Array de errores
 */
const extraerErrores = (soapResponse) => {
    console.log('🔍 [FACTURACION-SOAP] Extrayendo errores de respuesta');
    
    const errores = [];
    
    try {
        const body = extraerBody(soapResponse);
        
        // Buscar Fault
        if (body.Fault) {
            errores.push({
                codigo: body.Fault.faultcode || 'SOAP_FAULT',
                mensaje: body.Fault.faultstring || 'Error SOAP desconocido'
            });
        }
        
        // Buscar errores en respuesta de AFIP
        const responseKeys = Object.keys(body);
        for (const key of responseKeys) {
            const response = body[key];
            
            if (response.Errors && response.Errors.Err) {
                const errs = Array.isArray(response.Errors.Err) 
                    ? response.Errors.Err 
                    : [response.Errors.Err];
                
                errs.forEach(err => {
                    errores.push({
                        codigo: err.Code || 'UNKNOWN',
                        mensaje: err.Msg || 'Error desconocido'
                    });
                });
            }
        }
        
        if (errores.length > 0) {
            console.warn('⚠️ [FACTURACION-SOAP] Errores encontrados:', errores.length);
        } else {
            console.log('✅ [FACTURACION-SOAP] No se encontraron errores');
        }
        
    } catch (error) {
        console.error('❌ [FACTURACION-SOAP] Error extrayendo errores:', error.message);
    }
    
    return errores;
};

/**
 * Formatear XML para logging (con indentación)
 * @param {string} xml - XML a formatear
 * @returns {string} XML formateado
 */
const formatearXML = (xml) => {
    try {
        // Remover espacios en blanco extra
        let formatted = xml.replace(/>\s+</g, '><');
        
        // Agregar saltos de línea e indentación
        let indent = 0;
        formatted = formatted.replace(/(<\/?[^>]+>)/g, (match) => {
            if (match.startsWith('</')) {
                indent--;
            }
            const indentation = '  '.repeat(Math.max(0, indent));
            if (!match.startsWith('</') && !match.endsWith('/>')) {
                indent++;
            }
            return '\n' + indentation + match;
        });
        
        return formatted.trim();
    } catch (error) {
        return xml;
    }
};

/**
 * Limpiar XML para logging (remover datos sensibles)
 * @param {string} xml - XML a limpiar
 * @returns {string} XML limpio
 */
const limpiarXMLParaLog = (xml) => {
    let limpio = xml;
    
    // Ocultar token
    limpio = limpio.replace(/(<Token>)(.+?)(<\/Token>)/g, '$1***TOKEN***$3');
    
    // Ocultar sign
    limpio = limpio.replace(/(<Sign>)(.+?)(<\/Sign>)/g, '$1***SIGN***$3');
    
    return limpio;
};

/**
 * Validar estructura de respuesta WSAA
 * @param {Object} response - Respuesta parseada
 * @returns {boolean} True si es válida
 */
const esRespuestaWSAAValida = (response) => {
    try {
        return !!(
            response &&
            response.loginTicketResponse &&
            response.loginTicketResponse.credentials &&
            response.loginTicketResponse.credentials.token &&
            response.loginTicketResponse.credentials.sign
        );
    } catch (error) {
        return false;
    }
};

/**
 * Validar estructura de respuesta WSFE
 * @param {Object} response - Respuesta parseada
 * @returns {boolean} True si es válida
 */
const esRespuestaWSFEValida = (response) => {
    try {
        const body = extraerBody(response);
        const responseKeys = Object.keys(body);
        
        // Debe tener al menos una respuesta
        return responseKeys.length > 0 && !body.Fault;
    } catch (error) {
        return false;
    }
};

console.log('✅ [FACTURACION-SOAP] Utilidades SOAP cargadas');

module.exports = {
    construirEnvelope,
    construirLoginTicketRequest,
    construirFECAESolicitar,
    construirFECompUltimoAutorizado,
    construirFECompConsultar,
    parsearXML,
    extraerBody,
    extraerErrores,
    formatearXML,
    limpiarXMLParaLog,
    esRespuestaWSAAValida,
    esRespuestaWSFEValida
};
