/**
 * Servicio REAL de autenticación WSAA (Web Service de Autenticación y Autorización)
 * Implementación completa para AFIP HOMO/PROD
 * 
 * Flujo:
 * 1. Crear LoginTicketRequest (TRA) XML
 * 2. Firmar con certificado → login.cms (PKCS#7 DER, -binary -nodetached)
 * 3. Llamar loginCms SOAP
 * 4. Parsear loginTicketResponse → Token, Sign, Expiración
 * 5. Guardar en BD y reutilizar si está vigente
 */

const fs = require('fs').promises;
const { execFile } = require('child_process');
const { promisify } = require('util');
const path = require('path');
const axios = require('axios');
const xml2js = require('xml2js');
const { pool } = require('../config/database');
const { obtenerConfiguracion, WSAA_CONFIG, USE_REAL } = require('../config/afip');
const { ahora, agregarDias, paraBD } = require('../config/timezone');

const execFileAsync = promisify(execFile);

// Obtener ruta de OpenSSL desde variables de entorno
const OPENSSL_PATH = process.env.OPENSSL_PATH || process.env.OPENSSL_EXE || 'openssl';

console.log('🔍 [FACTURACION-WSAA-REAL] Cargando servicio WSAA REAL...');
console.log(`🔧 [FACTURACION-WSAA-REAL] OpenSSL: ${OPENSSL_PATH}`);

/**
 * Leer TA desde archivo TA.xml en disco
 * @param {string} entorno - 'HOMO' o 'PROD'
 * @returns {Promise<Object|null>} TA o null
 */
const leerTADesdeDisco = async (entorno) => {
    const config = obtenerConfiguracion();
    const taPath = path.join(config.wsaaWorkdir || 'C:\\Users\\Martin\\Documents\\lambda-ws-homo\\wsaa\\', 'TA.xml');
    
    console.log(`📁 [WSAA-REAL] Buscando TA en disco: ${taPath}`);
    
    try {
        const taXml = await fs.readFile(taPath, 'utf8');
        console.log(`✅ [WSAA-REAL] TA.xml encontrado en disco`);
        
        // Parsear XML
        const parser = new xml2js.Parser({ explicitArray: false });
        const result = await parser.parseStringPromise(taXml);
        
        const credentials = result.loginTicketResponse.credentials;
        const header = result.loginTicketResponse.header;
        
        if (!credentials || !credentials.token || !credentials.sign) {
            console.warn(`⚠️ [WSAA-REAL] TA.xml inválido (faltan credenciales)`);
            return null;
        }
        
        const ta = {
            token: credentials.token,
            sign: credentials.sign,
            expira_en: header.expirationTime
        };
        
        // Verificar si está vigente
        const minutosRestantes = calcularMinutosRestantes(ta.expira_en);
        console.log(`📊 [WSAA-REAL] TA del disco expira en ${minutosRestantes} min`);
        
        if (minutosRestantes > 0) {
            console.log(`✅ [WSAA-REAL] TA del disco es válido`);
            return ta;
        } else {
            console.warn(`⚠️ [WSAA-REAL] TA del disco expirado`);
            return null;
        }
        
    } catch (error) {
        if (error.code === 'ENOENT') {
            console.log(`📁 [WSAA-REAL] TA.xml no encontrado en disco`);
        } else {
            console.error(`❌ [WSAA-REAL] Error leyendo TA del disco:`, error.message);
        }
        return null;
    }
};

/**
 * Obtener Token de Acceso (TA) válido
 * @param {string} entorno - 'HOMO' o 'PROD'
 * @returns {Promise<Object>} { token, sign, expira_en }
 */
const getTA = async (entorno = 'HOMO') => {
    console.log(`🔑 [WSAA-REAL] Obteniendo TA para ${entorno}...`);
    
    // Si no está activado AFIP real, usar stub
    if (!USE_REAL) {
        console.log(`⚠️ [WSAA-REAL] AFIP_USE_REAL=false, usando stub`);
        return await getTAStub(entorno);
    }
    
    try {
        // 1. Buscar TA vigente en BD
        const taExistente = await buscarTAEnBD(entorno);
        
        if (taExistente) {
            const minutosRestantes = calcularMinutosRestantes(taExistente.expira_en);
            console.log(`📊 [WSAA-REAL] TA en BD, expira en ${minutosRestantes} min`);
            
            if (minutosRestantes > WSAA_CONFIG.RENOVAR_ANTES_MINUTOS) {
                console.log(`✅ [WSAA-REAL] TA vigente, reutilizando`);
                return {
                    token: taExistente.token,
                    sign: taExistente.sign,
                    expira_en: taExistente.expira_en
                };
            }
            
            console.log(`⚠️ [WSAA-REAL] TA por vencer, renovando...`);
        }
        
        // 2. Intentar leer TA desde disco (TA.xml)
        const taDisco = await leerTADesdeDisco(entorno);
        if (taDisco) {
            console.log(`✅ [WSAA-REAL] Usando TA del disco`);
            // Guardar en BD para próximas consultas
            await guardarTAEnBD(entorno, taDisco);
            return taDisco;
        }
        
        // 3. Solicitar nuevo TA a AFIP
        const nuevoTA = await solicitarNuevoTA(entorno);
        
        // 4. Guardar en BD
        await guardarTAEnBD(entorno, nuevoTA);
        
        console.log(`✅ [WSAA-REAL] Nuevo TA obtenido y guardado`);
        return nuevoTA;
        
    } catch (error) {
        console.error(`❌ [WSAA-REAL] Error obteniendo TA:`, error.message);
        
        // Si falla, intentar con TA del disco
        const taDisco = await leerTADesdeDisco(entorno);
        if (taDisco) {
            console.warn(`⚠️ [WSAA-REAL] Usando TA del disco como fallback`);
            return taDisco;
        }
        
        // Si falla, intentar con TA existente en BD aunque esté por vencer
        const taExistente = await buscarTAEnBD(entorno);
        if (taExistente && !esDelPasado(taExistente.expira_en)) {
            console.warn(`⚠️ [WSAA-REAL] Usando TA de BD como fallback`);
            return {
                token: taExistente.token,
                sign: taExistente.sign,
                expira_en: taExistente.expira_en
            };
        }
        
        throw error;
    }
};

/**
 * Solicitar nuevo TA a AFIP
 * @param {string} entorno - 'HOMO' o 'PROD'
 * @returns {Promise<Object>} Nuevo TA
 */
const solicitarNuevoTA = async (entorno) => {
    console.log(`🔄 [WSAA-REAL] Solicitando nuevo TA a AFIP ${entorno}...`);
    
    try {
        const config = obtenerConfiguracion();
        
        // 1. Crear TRA (Ticket de Requerimiento de Acceso)
        console.log(`📝 [WSAA-REAL] Paso 1: Creando TRA XML...`);
        const tra = crearTRA(config.cuit);
        
        // 2. Firmar TRA → CMS (PKCS#7)
        console.log(`🔐 [WSAA-REAL] Paso 2: Firmando TRA con OpenSSL...`);
        const cms = await firmarTRA(tra, config.certificados);
        
        // 3. Llamar loginCms
        console.log(`📤 [WSAA-REAL] Paso 3: Llamando loginCms...`);
        const response = await llamarLoginCms(cms, config.urls.WSAA);
        
        // 4. Parsear respuesta
        console.log(`📥 [WSAA-REAL] Paso 4: Parseando respuesta...`);
        const ta = await parsearLoginTicketResponse(response);
        
        console.log(`✅ [WSAA-REAL] TA obtenido exitosamente`);
        console.log(`   Token: ${ta.token.substring(0, 50)}...`);
        console.log(`   Expira: ${ta.expira_en}`);
        
        return ta;
        
    } catch (error) {
        console.error(`❌ [WSAA-REAL] Error solicitando TA:`, error.message);
        if (error.response) {
            console.error(`   Status: ${error.response.status}`);
            console.error(`   Data: ${JSON.stringify(error.response.data).substring(0, 200)}`);
        }
        throw error;
    }
};

/**
 * Crear TRA (Ticket de Requerimiento de Acceso) XML
 * @param {string} cuit - CUIT del emisor
 * @returns {string} TRA XML
 */
const crearTRA = (cuit) => {
    const uniqueId = Date.now();
    const generationTime = ahora().toISOString();
    const expirationTime = ahora().add(12, 'hours').toISOString();
    
    const tra = `<?xml version="1.0" encoding="UTF-8"?>
<loginTicketRequest version="1.0">
<header>
    <uniqueId>${uniqueId}</uniqueId>
    <generationTime>${generationTime}</generationTime>
    <expirationTime>${expirationTime}</expirationTime>
</header>
<service>${WSAA_CONFIG.SERVICIO}</service>
</loginTicketRequest>`;
    
    console.log(`✅ [WSAA-REAL] TRA creado (uniqueId: ${uniqueId})`);
    return tra;
};

/**
 * Firmar TRA con OpenSSL para generar CMS (PKCS#7)
 * Usa: openssl smime -sign -in tra.xml -out login.cms -signer cert.crt -inkey key.key -outform DER -nodetach
 * 
 * @param {string} tra - TRA XML
 * @param {Object} certificados - { CERT, KEY }
 * @returns {Promise<string>} CMS en base64
 */
const firmarTRA = async (tra, certificados) => {
    console.log(`🔐 [WSAA-REAL] Firmando TRA con OpenSSL...`);
    console.log(`   OpenSSL: ${OPENSSL_PATH}`);
    console.log(`   Cert: ${certificados.CERT}`);
    console.log(`   Key: ${certificados.KEY}`);
    
    try {
        // Verificar que existan los archivos
        await fs.access(certificados.CERT);
        await fs.access(certificados.KEY);
        console.log(`✅ [WSAA-REAL] Certificados encontrados`);
        
        // Crear archivos temporales
        const tmpDir = path.join(__dirname, '..', 'temp');
        await fs.mkdir(tmpDir, { recursive: true });
        
        const traPath = path.join(tmpDir, `tra_${Date.now()}.xml`);
        const cmsPath = path.join(tmpDir, `login_${Date.now()}.cms`);
        
        // Escribir TRA
        await fs.writeFile(traPath, tra, 'utf8');
        console.log(`📝 [WSAA-REAL] TRA escrito en: ${traPath}`);
        
        // Argumentos para OpenSSL (usando array para evitar problemas con espacios)
        // IMPORTANTE: -binary es REQUERIDO para AFIP
        const args = [
            'smime',
            '-sign',
            '-in', traPath,
            '-out', cmsPath,
            '-signer', certificados.CERT,
            '-inkey', certificados.KEY,
            '-outform', 'DER',
            '-nodetach',
            '-binary'
        ];
        
        console.log(`🔧 [WSAA-REAL] Ejecutando OpenSSL con execFile...`);
        console.log(`   Comando: ${OPENSSL_PATH} ${args.join(' ')}`);
        
        // Ejecutar OpenSSL con execFile (más seguro que execSync)
        try {
            const { stdout, stderr } = await execFileAsync(OPENSSL_PATH, args, {
                windowsHide: true,
                timeout: 30000
            });
            
            if (stderr) {
                console.log(`⚠️ [WSAA-REAL] OpenSSL stderr: ${stderr}`);
            }
            
            console.log(`✅ [WSAA-REAL] OpenSSL ejecutado exitosamente`);
            
        } catch (execError) {
            console.error(`❌ [WSAA-REAL] Error ejecutando OpenSSL:`, execError.message);
            
            if (execError.code === 'ENOENT') {
                throw new Error(
                    `OpenSSL no encontrado en: ${OPENSSL_PATH}\n` +
                    `Verifica la variable OPENSSL_PATH en el .env\n` +
                    `O instala OpenSSL: https://slproweb.com/products/Win32OpenSSL.html`
                );
            }
            
            throw new Error(`OpenSSL falló: ${execError.stderr || execError.message}`);
        }
        
        // Leer CMS
        const cmsBuffer = await fs.readFile(cmsPath);
        const cmsBase64 = cmsBuffer.toString('base64');
        
        console.log(`✅ [WSAA-REAL] CMS generado (${cmsBase64.length} chars)`);
        
        // Limpiar archivos temporales
        await fs.unlink(traPath);
        await fs.unlink(cmsPath);
        
        return cmsBase64;
        
    } catch (error) {
        console.error(`❌ [WSAA-REAL] Error firmando TRA:`, error.message);
        
        if (error.code === 'ENOENT') {
            if (error.path) {
                console.error(`   Archivo no encontrado: ${error.path}`);
            } else {
                console.error(`   OpenSSL no encontrado en PATH`);
                console.error(`   Configura OPENSSL_PATH en .env con la ruta completa`);
            }
        }
        
        throw error;
    }
};

/**
 * Llamar loginCms de WSAA
 * @param {string} cms - CMS en base64
 * @param {string} url - URL de WSAA
 * @returns {Promise<string>} Respuesta XML
 */
const llamarLoginCms = async (cms, url) => {
    console.log(`📤 [WSAA-REAL] Llamando loginCms: ${url}`);
    
    const soapEnvelope = `<?xml version="1.0" encoding="UTF-8"?>
<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" xmlns:wsaa="http://wsaa.view.sua.dvadac.desein.afip.gov">
<soapenv:Header/>
<soapenv:Body>
<wsaa:loginCms>
<wsaa:in0>${cms}</wsaa:in0>
</wsaa:loginCms>
</soapenv:Body>
</soapenv:Envelope>`;
    
    try {
        const response = await axios.post(url, soapEnvelope, {
            headers: {
                'Content-Type': 'text/xml; charset=utf-8',
                'SOAPAction': ''
            },
            timeout: 30000
        });
        
        console.log(`✅ [WSAA-REAL] Respuesta recibida (${response.status})`);
        return response.data;
        
    } catch (error) {
        console.error(`❌ [WSAA-REAL] Error llamando loginCms:`, error.message);
        
        // Intentar extraer SOAP Fault para diagnóstico
        if (error.response && error.response.data) {
            try {
                const parser = new xml2js.Parser({ explicitArray: false });
                const result = await parser.parseStringPromise(error.response.data);
                
                const fault = result['soapenv:Envelope']?.['soapenv:Body']?.['soapenv:Fault'];
                if (fault) {
                    const faultcode = fault.faultcode || 'N/A';
                    const faultstring = fault.faultstring || 'N/A';
                    
                    console.error(`❌ [WSAA-REAL] SOAP Fault:`);
                    console.error(`   Code: ${faultcode}`);
                    console.error(`   String: ${faultstring}`);
                    
                    // Si es alreadyAuthenticated, es un caso especial
                    if (faultstring.includes('alreadyAuthenticated') || faultstring.includes('ya posee un TA válido')) {
                        console.warn(`⚠️ [WSAA-REAL] AFIP indica que ya existe un TA válido`);
                        console.warn(`⚠️ [WSAA-REAL] Intentando reusar TA existente...`);
                    }
                }
            } catch (parseError) {
                console.error(`❌ [WSAA-REAL] No se pudo parsear SOAP Fault`);
            }
        }
        
        throw error;
    }
};

/**
 * Parsear loginTicketResponse
 * @param {string} xml - XML de respuesta
 * @returns {Promise<Object>} { token, sign, expira_en }
 */
const parsearLoginTicketResponse = async (xml) => {
    console.log(`📥 [WSAA-REAL] Parseando loginTicketResponse...`);
    
    try {
        const parser = new xml2js.Parser({ explicitArray: false });
        const result = await parser.parseStringPromise(xml);
        
        // Navegar por la estructura SOAP
        const body = result['soapenv:Envelope']['soapenv:Body'];
        const loginCmsReturn = body['loginCmsReturn'] || body['ns1:loginCmsReturn'];
        
        if (!loginCmsReturn) {
            throw new Error('loginCmsReturn no encontrado en respuesta');
        }
        
        // Parsear el loginTicketResponse interno
        const ltrParser = new xml2js.Parser({ explicitArray: false });
        const ltr = await ltrParser.parseStringPromise(loginCmsReturn);
        
        const credentials = ltr.loginTicketResponse.credentials;
        const header = ltr.loginTicketResponse.header;
        
        if (!credentials || !credentials.token || !credentials.sign) {
            throw new Error('Credenciales no encontradas');
        }
        
        const ta = {
            token: credentials.token,
            sign: credentials.sign,
            expira_en: header.expirationTime
        };
        
        console.log(`✅ [WSAA-REAL] TA parseado exitosamente`);
        return ta;
        
    } catch (error) {
        console.error(`❌ [WSAA-REAL] Error parseando respuesta:`, error.message);
        console.error(`   XML: ${xml.substring(0, 500)}...`);
        throw error;
    }
};

/**
 * Buscar TA en BD
 * @param {string} entorno - 'HOMO' o 'PROD'
 * @returns {Promise<Object|null>} TA o null
 */
const buscarTAEnBD = async (entorno) => {
    try {
        const query = `
            SELECT token, sign, expira_en
            FROM factura_afip_ta
            WHERE entorno = $1 AND servicio = $2
            ORDER BY creado_en DESC
            LIMIT 1
        `;
        
        const result = await pool.query(query, [entorno, WSAA_CONFIG.SERVICIO]);
        return result.rows.length > 0 ? result.rows[0] : null;
        
    } catch (error) {
        console.error(`❌ [WSAA-REAL] Error buscando TA en BD:`, error.message);
        return null;
    }
};

/**
 * Guardar TA en BD
 * @param {string} entorno - 'HOMO' o 'PROD'
 * @param {Object} ta - { token, sign, expira_en }
 * @returns {Promise<void>}
 */
const guardarTAEnBD = async (entorno, ta) => {
    console.log(`💾 [WSAA-REAL] Guardando TA en BD...`);
    
    try {
        const query = `
            INSERT INTO factura_afip_ta (entorno, servicio, token, sign, expira_en, creado_en)
            VALUES ($1, $2, $3, $4, $5, $6)
            ON CONFLICT (entorno, servicio)
            DO UPDATE SET
                token = EXCLUDED.token,
                sign = EXCLUDED.sign,
                expira_en = EXCLUDED.expira_en,
                creado_en = EXCLUDED.creado_en
        `;
        
        await pool.query(query, [
            entorno,
            WSAA_CONFIG.SERVICIO,
            ta.token,
            ta.sign,
            ta.expira_en,
            paraBD()
        ]);
        
        console.log(`✅ [WSAA-REAL] TA guardado en BD`);
        
    } catch (error) {
        console.error(`❌ [WSAA-REAL] Error guardando TA:`, error.message);
        throw error;
    }
};

/**
 * Calcular minutos restantes hasta expiración
 * @param {string} expiraEn - Timestamp
 * @returns {number} Minutos
 */
const calcularMinutosRestantes = (expiraEn) => {
    const now = new Date();
    const expira = new Date(expiraEn);
    return Math.floor((expira - now) / 1000 / 60);
};

/**
 * Verificar si fecha está en el pasado
 * @param {string} fecha - Timestamp
 * @returns {boolean}
 */
const esDelPasado = (fecha) => {
    return new Date(fecha) < new Date();
};

/**
 * Stub para desarrollo sin AFIP real
 * @param {string} entorno - 'HOMO' o 'PROD'
 * @returns {Promise<Object>} TA simulado
 */
const getTAStub = async (entorno) => {
    console.log(`⚠️ [WSAA-REAL] Usando STUB (AFIP_USE_REAL=false)`);
    
    const ta = {
        token: `STUB_TOKEN_${Date.now()}`,
        sign: `STUB_SIGN_${Date.now()}`,
        expira_en: ahora().add(12, 'hours').toISOString()
    };
    
    // Guardar en BD para consistencia
    await guardarTAEnBD(entorno, ta);
    
    return ta;
};

/**
 * Verificar si hay TA válido
 * @param {string} entorno - 'HOMO' o 'PROD'
 * @returns {Promise<boolean>}
 */
const hayTAValido = async (entorno = 'HOMO') => {
    const ta = await buscarTAEnBD(entorno);
    if (!ta) return false;
    
    const minutosRestantes = calcularMinutosRestantes(ta.expira_en);
    return minutosRestantes > WSAA_CONFIG.RENOVAR_ANTES_MINUTOS;
};

/**
 * Renovar TA forzadamente (para botón de UI)
 * @param {string} entorno - 'HOMO' o 'PROD'
 * @returns {Promise<Object>} { entorno, servicio, expira_en, vigente, mensaje, token, sign }
 */
const renovarTA = async (entorno = 'HOMO') => {
    console.log(`🔄 [WSAA-REAL] Renovación forzada de TA para ${entorno}...`);
    
    try {
        // Solicitar nuevo TA (sin verificar si existe uno vigente)
        const nuevoTA = await solicitarNuevoTA(entorno);
        
        // Guardar en BD
        await guardarTAEnBD(entorno, nuevoTA);
        
        // Calcular minutos restantes
        const minutosRestantes = calcularMinutosRestantes(nuevoTA.expira_en);
        const vigente = minutosRestantes > 0;
        
        console.log(`✅ [WSAA-REAL] TA renovado exitosamente (expira en ${minutosRestantes} min)`);
        
        return {
            entorno,
            servicio: WSAA_CONFIG.SERVICIO,
            expira_en: nuevoTA.expira_en,
            vigente,
            mensaje: vigente ? 'TA actualizado exitosamente' : 'TA obtenido pero ya expirado',
            token: nuevoTA.token.substring(0, 50) + '...',
            sign: nuevoTA.sign.substring(0, 50) + '...'
        };
        
    } catch (error) {
        console.error(`❌ [WSAA-REAL] Error renovando TA:`, error.message);
        
        // Intentar reusar TA existente como fallback
        const taExistente = await buscarTAEnBD(entorno);
        if (taExistente) {
            const minutosRestantes = calcularMinutosRestantes(taExistente.expira_en);
            if (minutosRestantes > 0) {
                console.warn(`⚠️ [WSAA-REAL] Usando TA existente como fallback`);
                return {
                    entorno,
                    servicio: WSAA_CONFIG.SERVICIO,
                    expira_en: taExistente.expira_en,
                    vigente: true,
                    mensaje: 'No se pudo renovar, usando TA existente',
                    token: taExistente.token.substring(0, 50) + '...',
                    sign: taExistente.sign.substring(0, 50) + '...'
                };
            }
        }
        
        throw error;
    }
};

console.log('✅ [WSAA-REAL] Servicio WSAA REAL cargado');
console.log(`   AFIP_USE_REAL: ${USE_REAL}`);

module.exports = {
    getTA,
    hayTAValido,
    renovarTA
};
