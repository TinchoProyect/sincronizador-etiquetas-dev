/**
 * Módulo Criptográfico y de Servicios Web ARCA (ex-AFIP)
 * Resuelve la autenticación ante el WSAA (firma digital de TRA usando OpenSSL)
 * y la consulta a la Constancia de Inscripción / Padrón de Alcance 5 (ws_sr_constancia_inscripcion)
 * para recuperar datos fiscales e impositivos en tiempo real.
 */

const fs = require('fs');
const path = require('path');
const { execFile } = require('child_process');
const { promisify } = require('util');
const execFileAsync = promisify(execFile);
const os = require('os');

// Inyectar el directorio de node_modules de facturación para poder usar axios y xml2js
module.paths.push(path.resolve(__dirname, '../../facturacion/node_modules'));

const axios = require('axios');
const xml2js = require('xml2js');
const { pool } = require('../config/database');

// Cargar variables de entorno principales
require('dotenv').config();

// Cargar variables de entorno del módulo de facturación si existe
const facturacionEnvPath = path.resolve(__dirname, '../../facturacion/.env');
if (fs.existsSync(facturacionEnvPath)) {
    require('dotenv').config({ path: facturacionEnvPath });
}

// Configuración de rutas y binarios (Auto-detección multiplataforma Windows / Linux Cloud)
const rawOpenSsl = process.env.OPENSSL_EXE || process.env.OPENSSL_BIN || '';
const OPENSSL_EXE = (process.platform !== 'win32' && (!rawOpenSsl || rawOpenSsl.includes(':\\')))
    ? 'openssl'
    : (rawOpenSsl || 'C:\\Program Files\\OpenSSL-Win64\\bin\\openssl.exe');

// El servicio ws_sr_constancia_inscripcion (Padrón A5) es 100% de solo lectura y los CUITs reales
// existen únicamente en el Padrón de Producción de ARCA (bajo el certificado dedicado CN=lamda_clientes).
const ENTORNO = process.env.AFIP_PADRON_ENV || 'PROD';

function resolverRutaExistente(candidatos, fallbackPath) {
    for (const c of candidatos) {
        if (c && typeof c === 'string' && fs.existsSync(c)) {
            return c;
        }
    }
    return fallbackPath;
}

// Rutas de certificados con prioridad para el certificado dedicado de Clientes Búnker (lamda_clientes.crt)
const CERT_FILE = resolverRutaExistente([
    process.env.AFIP_PADRON_CERT_PATH,
    path.resolve(__dirname, '../../facturacion/certs/lamda_clientes.crt'),
    process.env.AFIP_HOMO_CERT_PATH,
    path.resolve(__dirname, '../../facturacion/certs/prod-cert.pem'),
    path.resolve(__dirname, '../../facturacion/certs/certificado_homo.crt')
], path.resolve(__dirname, '../../facturacion/certs/lamda_clientes.crt'));

const KEY_FILE = resolverRutaExistente([
    process.env.AFIP_PADRON_KEY_PATH,
    path.resolve(__dirname, '../../facturacion/certs/lamda_clientes.key'),
    process.env.AFIP_HOMO_KEY_PATH,
    path.resolve(__dirname, '../../facturacion/certs/prod-key.pem'),
    path.resolve(__dirname, '../../facturacion/certs/privada_homo.key')
], path.resolve(__dirname, '../../facturacion/certs/lamda_clientes.key'));

const WSAA_URL = ENTORNO === 'PROD'
    ? 'https://wsaa.afip.gov.ar/ws/services/LoginCms'
    : 'https://wsaahomo.afip.gov.ar/ws/services/LoginCms';

// URL para Consulta a Padrón Constancia A5 (ws_sr_constancia_inscripcion)
const PADRON_URL = ENTORNO === 'PROD'
    ? 'https://aws.afip.gov.ar/sr-padron/webservices/personaServiceA5'
    : 'https://awshomo.afip.gov.ar/sr-padron/webservices/personaServiceA5';

const CUIT_REPRESENTADA = process.env.AFIP_CUIT || '23248921749';

// Caché en memoria de la aplicación para el Ticket de Acceso (TA)
let cacheTA = {
    token: null,
    sign: null,
    expira: null // Tipo Date
};

/**
 * Obtener un Ticket de Acceso (TA) válido.
 * Reutiliza el TA en memoria o de la base de datos si está vigente; de lo contrario, solicita uno nuevo.
 * @returns {Promise<{token: string, sign: string}>} Credenciales de acceso
 */
async function obtenerTA() {
    const ahora = new Date();
    
    // 1. Validar vigencia de la caché local en memoria (tiempo restante mayor a 5 minutos)
    if (cacheTA.token && cacheTA.sign && cacheTA.expira && cacheTA.expira > ahora) {
        const minRestantes = Math.floor((cacheTA.expira - ahora) / 60000);
        if (minRestantes > 5) {
            console.log(`ℹ️ [ARCA-SERVICE] Reutilizando TA de la caché en memoria (Vence en ${minRestantes} min)`);
            return { token: cacheTA.token, sign: cacheTA.sign };
        }
    }
    
    // 2. Intentar buscar en la base de datos (persistencia entre ejecuciones/procesos)
    try {
        console.log(`🔍 [ARCA-SERVICE] Buscando TA en base de datos para ${ENTORNO}/ws_sr_constancia_inscripcion...`);
        const query = `
            SELECT token, sign, expira_en
            FROM factura_afip_ta
            WHERE entorno = $1 AND servicio = $2
        `;
        const res = await pool.query(query, [ENTORNO, 'ws_sr_constancia_inscripcion']);
        if (res.rows.length > 0) {
            const ta = res.rows[0];
            const expira = new Date(ta.expira_en);
            const minRestantes = Math.floor((expira - ahora) / 60000);
            
            if (minRestantes > 5) {
                console.log(`✅ [ARCA-SERVICE] Reutilizando TA de la base de datos (Vence en ${minRestantes} min)`);
                // Actualizar la caché en memoria local
                cacheTA = {
                    token: ta.token,
                    sign: ta.sign,
                    expira
                };
                return { token: ta.token, sign: ta.sign };
            }
            console.log(`⚠️ [ARCA-SERVICE] TA en base de datos por expirar o expirado (Vence en ${minRestantes} min)`);
        } else {
            console.log('ℹ️ [ARCA-SERVICE] No se encontró TA en base de datos para Clientes Búnker');
        }
    } catch (dbErr) {
        console.warn('⚠️ [ARCA-SERVICE] Error al leer TA de la base de datos:', dbErr.message);
    }
    
    console.log('🔄 [ARCA-SERVICE] Caché inactiva o expirada. Solicitando nuevo TA al WSAA...');
    return await renovarTA();
}

/**
 * Genera y firma un TRA para el servicio ws_sr_constancia_inscripcion, y llama al WSAA.
 * @returns {Promise<{token: string, sign: string}>}
 */
async function renovarTA() {
    console.log(`🔐 [ARCA-SERVICE] Iniciando renovación de TA en entorno ${ENTORNO}...`);
    
    // Validar existencia de certificado y clave privada
    if (!fs.existsSync(CERT_FILE)) {
        throw new Error(`Certificado no encontrado en la ruta: ${CERT_FILE}`);
    }
    if (!fs.existsSync(KEY_FILE)) {
        throw new Error(`Clave privada no encontrada en la ruta: ${KEY_FILE}`);
    }

    const now = new Date();
    // APLICAR SESGO PREVENTIVO de 10 minutos para clock drift de la máquina del depósito local
    const generationTime = new Date(now.getTime() - 10 * 60 * 1000).toISOString().replace(/\.\d{3}Z$/, 'Z');
    // Margen de expiración de 11 horas solicitado
    const expirationTime = new Date(now.getTime() + 11 * 60 * 60 * 1000).toISOString().replace(/\.\d{3}Z$/, 'Z');
    const uniqueId = Math.floor(Math.random() * 1e9);

    const traXml = `<?xml version="1.0" encoding="UTF-8"?>
<loginTicketRequest version="1.0">
  <header>
    <uniqueId>${uniqueId}</uniqueId>
    <generationTime>${generationTime}</generationTime>
    <expirationTime>${expirationTime}</expirationTime>
  </header>
  <service>ws_sr_constancia_inscripcion</service>
</loginTicketRequest>`;

    const traFile = path.join(os.tmpdir(), `TRA_padron_${Date.now()}.xml`);
    const cmsFile = path.join(os.tmpdir(), `TRA_padron_${Date.now()}.cms`);

    try {
        // Guardar TRA en UTF-8 sin BOM
        fs.writeFileSync(traFile, Buffer.from(traXml, 'utf8'));

        // Firmar TRA usando OpenSSL (formato PKCS#7 / CMS, codificación DER binaria)
        const opensslArgs = [
            'smime', '-sign',
            '-in', traFile,
            '-out', cmsFile,
            '-outform', 'DER',
            '-signer', CERT_FILE,
            '-inkey', KEY_FILE,
            '-nodetach',
            '-binary'
        ];

        console.log(`🖥️ [ARCA-SERVICE] Ejecutando firma OpenSSL en ${OPENSSL_EXE}...`);
        await execFileAsync(OPENSSL_EXE, opensslArgs);
        console.log('✅ [ARCA-SERVICE] Firma digital PKCS#7 generada con éxito');

        // Leer CMS firmado y codificar a Base64 para el sobre SOAP
        const cmsBuffer = fs.readFileSync(cmsFile);
        const cmsBase64 = cmsBuffer.toString('base64');

        const soapRequest = `<?xml version="1.0" encoding="UTF-8"?>
<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" xmlns:wsaa="http://wsaa.view.sua.dvadac.desein.afip.gov">
  <soapenv:Header/>
  <soapenv:Body>
    <wsaa:loginCms>
      <wsaa:in0>${cmsBase64}</wsaa:in0>
    </wsaa:loginCms>
  </soapenv:Body>
</soapenv:Envelope>`;

        console.log(`📤 [ARCA-SERVICE] Enviando petición LoginCms al WSAA: ${WSAA_URL}`);
        let response;
        try {
            response = await axios.post(WSAA_URL, soapRequest, {
                headers: {
                    'Content-Type': 'text/xml; charset=utf-8',
                    'SOAPAction': ''
                },
                responseType: 'text',
                timeout: 30000
            });
        } catch (axiosError) {
            if (axiosError.response && axiosError.response.data) {
                console.error('❌ [ARCA-SERVICE] Respuesta de error del WSAA (AFIP/ARCA):');
                console.error(axiosError.response.data);
                
                try {
                    const xmlOpts = {
                        explicitArray: false,
                        tagNameProcessors: [xml2js.processors.stripPrefix]
                    };
                    const parsed = await xml2js.parseStringPromise(axiosError.response.data, xmlOpts);
                    const fault = parsed?.Envelope?.Body?.Fault;
                    if (fault) {
                        const faultCode = fault.faultcode;
                        const faultString = fault.faultstring;
                        throw new Error(`Fallo del Web Service ARCA: [${faultCode}] ${faultString}`);
                    }
                } catch (parseErr) {
                    if (parseErr.message.includes('Fallo del Web Service ARCA')) {
                        throw parseErr;
                    }
                }
            }
            throw axiosError;
        }

        // Parsear respuesta XML
        const xmlOpts = {
            explicitArray: false,
            tagNameProcessors: [xml2js.processors.stripPrefix]
        };
        const parsedSoap = await xml2js.parseStringPromise(response.data, xmlOpts);
        const loginCmsReturn = parsedSoap?.Envelope?.Body?.loginCmsResponse?.loginCmsReturn;

        if (!loginCmsReturn) {
            throw new Error('La respuesta del WSAA no contiene credenciales de LoginCmsReturn.');
        }

        const taParsed = await xml2js.parseStringPromise(loginCmsReturn, xmlOpts);
        const token = taParsed?.loginTicketResponse?.credentials?.token;
        const sign = taParsed?.loginTicketResponse?.credentials?.sign;
        const expirationStr = taParsed?.loginTicketResponse?.header?.expirationTime;

        if (!token || !sign) {
            throw new Error('El Ticket de Acceso devuelto está incompleto (falta token o sign).');
        }

        // Configurar la caché en memoria limitándola a un máximo de 11 horas
        const afipExpira = expirationStr ? new Date(expirationStr) : new Date(Date.now() + 11 * 60 * 60 * 1000);
        const maxCacheTime = new Date(Date.now() + 11 * 60 * 60 * 1000);
        
        cacheTA = {
            token,
            sign,
            expira: afipExpira < maxCacheTime ? afipExpira : maxCacheTime
        };

        console.log(`✅ [ARCA-SERVICE] Nuevo TA adquirido exitosamente. Expira: ${cacheTA.expira.toISOString()}`);

        // Guardar la caché en base de datos para persistencia entre procesos
        try {
            console.log(`💾 [ARCA-SERVICE] Guardando nuevo TA en la base de datos para ${ENTORNO}/ws_sr_constancia_inscripcion...`);
            const query = `
                INSERT INTO factura_afip_ta (entorno, servicio, token, sign, expira_en, creado_en)
                VALUES ($1, $2, $3, $4, $5, NOW())
                ON CONFLICT (entorno, servicio)
                DO UPDATE SET
                    token = EXCLUDED.token,
                    sign = EXCLUDED.sign,
                    expira_en = EXCLUDED.expira_en,
                    creado_en = NOW()
            `;
            await pool.query(query, [ENTORNO, 'ws_sr_constancia_inscripcion', token, sign, cacheTA.expira]);
            console.log('✅ [ARCA-SERVICE] TA guardado en base de datos con éxito');
        } catch (dbErr) {
            console.warn('⚠️ [ARCA-SERVICE] No se pudo persistir el TA en base de datos:', dbErr.message);
        }

        return { token, sign };

    } finally {
        // Limpieza higiénica de archivos temporales
        try {
            if (fs.existsSync(traFile)) fs.unlinkSync(traFile);
            if (fs.existsSync(cmsFile)) fs.unlinkSync(cmsFile);
        } catch (err) {
            console.warn('⚠️ [ARCA-SERVICE] No se pudieron borrar archivos temporales:', err.message);
        }
    }
}

/**
 * Mapea la condición de IVA en base a los impuestos activos del contribuyente.
 * @param {Array|Object} impuesto - Bloque de impuestos de la respuesta de ARCA
 * @returns {string} Mapeo a las opciones del Drawer
 */
function mapearCondicionIva(impuesto) {
    if (!impuesto) return 'Consumidor Final';
    const listado = Array.isArray(impuesto) ? impuesto : [impuesto];
    
    for (const imp of listado) {
        const id = parseInt(imp.idImpuesto || imp.id, 10);
        const desc = (imp.descripcionImpuesto || imp.descripcion || '').toUpperCase();
        
        if (id === 30 || desc.includes('IVA RESPONSABLE INSCRIPTO') || desc.includes('RESPONSABLE INSCRIPTO')) {
            return 'Responsable Inscripto';
        }
        if (id === 20 || id === 21 || id === 22 || desc.includes('MONOTRIBUTO')) {
            return 'Monotributo';
        }
        if (id === 32 || desc.includes('EXENTO')) {
            return 'Exento';
        }
    }
    return 'Consumidor Final';
}

/**
 * Formatea el domicilio fiscal concatenando los campos individuales si 'direccion' no viene definido.
 * @param {Object} dom - Objeto de domicilio de la respuesta de ARCA
 * @returns {string} Domicilio formateado
 */
function formatearDomicilio(dom) {
    if (!dom) return '';
    if (dom.direccion) return dom.direccion;
    
    const partes = [];
    if (dom.calle) partes.push(dom.calle.trim());
    if (dom.numero) partes.push(dom.numero);
    if (dom.piso) partes.push(`Piso ${dom.piso.trim()}`);
    if (dom.oficinaDptoLocal) partes.push(`Depto ${dom.oficinaDptoLocal.trim()}`);
    return partes.join(', ');
}

/**
 * Consulta el Padrón de Alcance 5 (getPersona en ws_sr_constancia_inscripcion) para un CUIT específico.
 * @param {string} cuit - CUIT de 11 dígitos a consultar
 * @returns {Promise<{razon_social: string, condicion_iva: string, domicilio_fiscal: string, provincia: string}>}
 */
async function consultarPadron(cuit) {
    const cuitLimpio = cuit.replace(/[^0-9]/g, '');
    if (cuitLimpio.length !== 11) {
        throw new Error('El CUIT debe poseer exactamente 11 dígitos.');
    }

    const { token, sign } = await obtenerTA();
    
    const soapRequest = `<?xml version="1.0" encoding="UTF-8"?>
<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" xmlns:a5="http://a5.soap.ws.server.puc.sr/">
   <soapenv:Header/>
   <soapenv:Body>
      <a5:getPersona>
         <token>${token}</token>
         <sign>${sign}</sign>
         <cuitRepresentada>${CUIT_REPRESENTADA}</cuitRepresentada>
         <idPersona>${cuitLimpio}</idPersona>
      </a5:getPersona>
   </soapenv:Body>
</soapenv:Envelope>`;

    console.log(`📤 [ARCA-SERVICE] Consultando Constancia de Inscripción para el CUIT: ${cuitLimpio}...`);
    let response;
    try {
        response = await axios.post(PADRON_URL, soapRequest, {
            headers: {
                'Content-Type': 'text/xml; charset=utf-8',
                'SOAPAction': ''
            },
            responseType: 'text',
            timeout: 15000 // 15 segundos de timeout
        });
    } catch (axiosError) {
        if (axiosError.response && axiosError.response.data) {
            console.error('❌ [ARCA-SERVICE] Respuesta de error del Padrón A5 (AFIP/ARCA):');
            console.error(axiosError.response.data);
            
            try {
                const xmlOpts = {
                    explicitArray: false,
                    tagNameProcessors: [xml2js.processors.stripPrefix]
                };
                const parsed = await xml2js.parseStringPromise(axiosError.response.data, xmlOpts);
                const fault = parsed?.Envelope?.Body?.Fault;
                if (fault) {
                    const faultCode = fault.faultcode;
                    const faultString = fault.faultstring;
                    throw new Error(`Fallo del Web Service ARCA: [${faultCode}] ${faultString}`);
                }
            } catch (parseErr) {
                if (parseErr.message.includes('Fallo del Web Service ARCA')) {
                    throw parseErr;
                }
            }
        }
        throw axiosError;
    }

    const xmlOpts = {
        explicitArray: false,
        tagNameProcessors: [xml2js.processors.stripPrefix]
    };
    const parsed = await xml2js.parseStringPromise(response.data, xmlOpts);
    const body = parsed?.Envelope?.Body;

    // Verificar si el servidor devolvió un error SOAP Fault
    if (body?.Fault) {
        const faultCode = body.Fault.faultcode;
        const faultString = body.Fault.faultstring;
        throw new Error(`Fallo del Web Service ARCA: [${faultCode}] ${faultString}`);
    }

    const personaReturn = body?.getPersonaResponse?.personaReturn;
    
    if (!personaReturn || (!personaReturn.datosGenerales && !personaReturn.errorConstancia)) {
        throw new Error('El contribuyente no fue encontrado en los registros de ARCA.');
    }

    // Si viene un error interno en la constancia de AFIP
    if (personaReturn.errorConstancia) {
        const errMsg = personaReturn.errorConstancia.descripcionError || 'Error al consultar constancia en AFIP.';
        throw new Error(`Fallo de Padrón ARCA: ${errMsg}`);
    }

    const datosGenerales = personaReturn.datosGenerales;
    if (!datosGenerales) {
        throw new Error('El contribuyente no retornó datos generales en el padrón de ARCA.');
    }
    
    // A. LÓGICA DE NEGOCIO: Razón Social (Mapear Persona Jurídica o concatenar Persona Física)
    let razonSocial = '';
    if (datosGenerales.razonSocial) {
        razonSocial = datosGenerales.razonSocial.trim();
    } else {
        const partesNombre = [];
        if (datosGenerales.apellido) partesNombre.push(datosGenerales.apellido.trim());
        if (datosGenerales.nombre) partesNombre.push(datosGenerales.nombre.trim());
        razonSocial = partesNombre.join(', ');
    }

    // B. Domicilio Fiscal y Provincia (A5 viene estructurado bajo domicilioFiscal)
    let domicilioFiscal = '';
    let provincia = '';
    
    if (datosGenerales.domicilioFiscal) {
        const dom = datosGenerales.domicilioFiscal;
        domicilioFiscal = formatearDomicilio(dom);
        provincia = dom.descripcionProvincia || '';
    }

    // C. Mapear Condición de IVA (A5 distingue entre monotributo y régimen general)
    let condicionIva = 'Consumidor Final';
    let advertenciaFiscal = null;

    const esPersonaJuridica = (datosGenerales.tipoPersona && datosGenerales.tipoPersona.toUpperCase() === 'JURIDICA') ||
                              cuitLimpio.startsWith('30') || 
                              cuitLimpio.startsWith('33') || 
                              cuitLimpio.startsWith('34');

    if (personaReturn.datosMonotributo) {
        condicionIva = 'Monotributo';
    } else if (personaReturn.datosRegimenGeneral) {
        const impuesto = personaReturn.datosRegimenGeneral.impuesto;
        condicionIva = mapearCondicionIva(impuesto);
    } else if (personaReturn.errorRegimenGeneral) {
        // ARCA bloqueó la constancia por incumplimientos de DDJJ
        const errDesc = personaReturn.errorRegimenGeneral.error || personaReturn.errorRegimenGeneral.mensaje || '';
        console.warn(`⚠️ [ARCA-SERVICE] CUIT ${cuitLimpio} posee errorRegimenGeneral: "${errDesc}"`);
        
        if (esPersonaJuridica) {
            condicionIva = 'Responsable Inscripto';
            advertenciaFiscal = 'El contribuyente posee advertencia de ARCA por falta de DDJJ, pero se mantiene la condición fiscal societaria (Responsable Inscripto).';
            console.log(`ℹ️ [ARCA-SERVICE] Se preservó condición fiscal 'Responsable Inscripto' por tratarse de Persona Jurídica (CUIT ${cuitLimpio}).`);
        } else {
            condicionIva = 'Consumidor Final';
            advertenciaFiscal = `Advertencia ARCA: ${errDesc}`;
        }
    } else if (esPersonaJuridica) {
        // Fallback preventivo para personas jurídicas sin nodo tributario explícito
        condicionIva = 'Responsable Inscripto';
    }

    // D. Datos fiscales extendidos (Fase 3)
    const estadoClave = datosGenerales.estadoClave ? datosGenerales.estadoClave.trim() : null;

    let categoriaMonotributo = null;
    if (personaReturn.datosMonotributo && personaReturn.datosMonotributo.categoriaMonotributo) {
        const cat = personaReturn.datosMonotributo.categoriaMonotributo;
        categoriaMonotributo = cat.descripcionCategoria ? cat.descripcionCategoria.trim() : null;
    }

    let actividadPrincipal = null;
    if (personaReturn.datosRegimenGeneral && personaReturn.datosRegimenGeneral.actividad) {
        const acts = Array.isArray(personaReturn.datosRegimenGeneral.actividad)
            ? personaReturn.datosRegimenGeneral.actividad
            : [personaReturn.datosRegimenGeneral.actividad];
        const prim = acts.find(a => parseInt(a.orden, 10) === 1) || acts[0];
        if (prim) {
            actividadPrincipal = prim.descripcionActividad ? prim.descripcionActividad.trim() : null;
        }
    } else if (personaReturn.datosMonotributo && personaReturn.datosMonotributo.actividadMonotributista) {
        const acts = Array.isArray(personaReturn.datosMonotributo.actividadMonotributista)
            ? personaReturn.datosMonotributo.actividadMonotributista
            : [personaReturn.datosMonotributo.actividadMonotributista];
        const prim = acts.find(a => parseInt(a.orden, 10) === 1) || acts[0];
        if (prim) {
            actividadPrincipal = prim.descripcionActividad ? prim.descripcionActividad.trim() : null;
        }
    }

    console.log(`✅ [ARCA-SERVICE] Datos del CUIT ${cuitLimpio} mapeados con éxito: "${razonSocial}" (IVA: ${condicionIva}, Estado: ${estadoClave}, Cat: ${categoriaMonotributo})`);
    return {
        razon_social: razonSocial,
        condicion_iva: condicionIva,
        domicilio_fiscal: domicilioFiscal,
        provincia: provincia,
        estado_clave: estadoClave,
        categoria_monotributo: categoriaMonotributo,
        actividad_principal: actividadPrincipal,
        advertencia_fiscal: advertenciaFiscal
    };
}

module.exports = {
    obtenerTA,
    consultarPadron
};
