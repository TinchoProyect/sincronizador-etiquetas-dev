/**
 * Servicio WSAA Real - Implementación completa para AFIP
 * Gestiona autenticación con WSAA (Web Service de Autenticación y Autorización)
 */

const fs = require('fs');
const path = require('path');
const { execFile } = require('child_process');
const { promisify } = require('util');
const execFileAsync = promisify(execFile);
const axios = require('axios');
const os = require('os');
const xml2js = require('xml2js');
const { pool } = require('../config/database');
const { ENTORNO, CUIT, OPENSSL_EXE } = require('../config/afip');

console.log('🔍 [WSAA-REAL] Cargando servicio WSAA real...');

/**
 * Obtener TA desde la base de datos
 */
async function obtenerTADesdeBD(entorno, servicio) {
    console.log(`🔍 [WSAA-REAL] Buscando TA en BD para ${entorno}/${servicio}...`);
    
    const query = `
        SELECT token, sign, expira_en, creado_en
        FROM factura_afip_ta
        WHERE entorno = $1 AND servicio = $2
    `;
    
    const result = await pool.query(query, [entorno, servicio]);
    
    if (result.rows.length === 0) {
        console.log('ℹ️ [WSAA-REAL] No se encontró TA en BD');
        return null;
    }
    
    const ta = result.rows[0];
    console.log(`✅ [WSAA-REAL] TA encontrado en BD (expira: ${ta.expira_en})`);
    
    return ta;
}

/**
 * Guardar TA en la base de datos
 */
async function guardarTA(entorno, servicio, token, sign, expira_en) {
    console.log(`💾 [WSAA-REAL] Guardando TA en BD...`);
    
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
    
    await pool.query(query, [entorno, servicio, token, sign, expira_en]);
    console.log(`✅ [WSAA-REAL] TA guardado en BD`);
}

/**
 * Verificar si hay un TA válido
 */
async function hayTAValido(entorno = 'HOMO') {
    console.log(`🔍 [WSAA-REAL] Verificando si hay TA válido para ${entorno}...`);
    
    const ta = await obtenerTADesdeBD(entorno, 'wsfe');
    
    if (!ta) {
        console.log('❌ [WSAA-REAL] No hay TA en BD');
        return false;
    }
    
    const ahora = new Date();
    const expiracion = new Date(ta.expira_en);
    const vigente = expiracion > ahora;
    
    console.log(`${vigente ? '✅' : '❌'} [WSAA-REAL] TA ${vigente ? 'vigente' : 'expirado'}`);
    
    return vigente;
}

/**
 * Obtener TA (desde BD o solicitando uno nuevo)
 */
async function getTA(entorno = 'HOMO') {
    console.log(`🔍 [WSAA-REAL] Obteniendo TA para ${entorno}...`);
    
    // Intentar obtener de BD
    const ta = await obtenerTADesdeBD(entorno, 'wsfe');
    
    if (ta) {
        const ahora = new Date();
        const expiracion = new Date(ta.expira_en);
        const minutosRestantes = Math.floor((expiracion - ahora) / 60000);
        
        // Si está vigente y no está por vencer, usarlo
        if (minutosRestantes > 5) {
            console.log(`✅ [WSAA-REAL] Usando TA existente (expira en ${minutosRestantes} min)`);
            return {
                token: ta.token,
                sign: ta.sign,
                expira_en: ta.expira_en
            };
        }
        
        console.log(`⚠️ [WSAA-REAL] TA por vencer o expirado (${minutosRestantes} min), renovando...`);
    }
    
    // Solicitar nuevo TA
    return await renovarTA(entorno);
}

/**
 * Renovar TA forzadamente (implementación completa según AFIP)
 */
async function renovarTA(entorno = 'HOMO') {
    console.log(`🔄 [WSAA-REAL] Renovación forzada de TA para ${entorno}...`);
    
    try {
        // 1. Obtener configuración
        const crtPath = process.env.AFIP_HOMO_CERT_PATH;
        const keyPath = process.env.AFIP_HOMO_KEY_PATH;
        const wsaaUrl = process.env.AFIP_HOMO_WSAA_URL || 'https://wsaahomo.afip.gov.ar/ws/services/LoginCms';
        
        if (!crtPath || !keyPath) {
            throw new Error('Faltan variables de entorno: AFIP_HOMO_CERT_PATH y/o AFIP_HOMO_KEY_PATH');
        }
        
        console.log(`📋 [WSAA-REAL] Configuración:`);
        console.log(`   Cert: ${crtPath}`);
        console.log(`   Key: ${keyPath}`);
        console.log(`   URL: ${wsaaUrl}`);
        
        // 2. Generar TRA (Ticket de Requerimiento de Acceso)
        console.log('📝 [WSAA-REAL] Generando TRA...');
        const now = new Date();
        const generationTime = new Date(now.getTime() - 10 * 60 * 1000).toISOString().replace(/\.\d{3}Z$/, 'Z');
        const expirationTime = new Date(now.getTime() + 12 * 60 * 60 * 1000).toISOString().replace(/\.\d{3}Z$/, 'Z');
        const uniqueId = Math.floor(Math.random() * 1e9);
        
        const traXml = `<?xml version="1.0" encoding="UTF-8"?>
<loginTicketRequest version="1.0">
  <header>
    <uniqueId>${uniqueId}</uniqueId>
    <generationTime>${generationTime}</generationTime>
    <expirationTime>${expirationTime}</expirationTime>
  </header>
  <service>wsfe</service>
</loginTicketRequest>`;
        
        console.log(`✅ [WSAA-REAL] TRA generado (uniqueId: ${uniqueId})`);
        
        // 3. Guardar TRA sin BOM (UTF-8 puro)
        const traFile = path.join(os.tmpdir(), `TRA_${Date.now()}.xml`);
        const cmsFile = path.join(os.tmpdir(), `TRA_${Date.now()}.cms`);
        
        // CRÍTICO: Buffer.from sin BOM
        const traBuffer = Buffer.from(traXml, 'utf8');
        fs.writeFileSync(traFile, traBuffer);
        console.log(`💾 [WSAA-REAL] TRA guardado sin BOM en: ${traFile}`);
        
        // 4. Firmar con OpenSSL (PKCS#7 en formato DER + binario)
        console.log('🔐 [WSAA-REAL] Firmando TRA con OpenSSL...');
        
        const opensslArgs = [
            'smime', '-sign',
            '-in', traFile,
            '-out', cmsFile,
            '-outform', 'DER',  // CRÍTICO: DER no PEM
            '-signer', crtPath,
            '-inkey', keyPath,
            '-nodetach',
            '-binary'  // CRÍTICO: firma binaria
        ];
        
        try {
            console.log(`🔧 [WSAA-REAL] Usando OpenSSL: ${OPENSSL_EXE}`);
            console.log(`🔧 [WSAA-REAL] Formato de salida: DER (binario)`);
            const { stdout, stderr } = await execFileAsync(OPENSSL_EXE, opensslArgs);
            console.log(`✅ [WSAA-REAL] TRA firmado exitosamente en formato DER`);
            if (stderr) console.log(`   OpenSSL stderr: ${stderr}`);
        } catch (opensslError) {
            console.error(`❌ [WSAA-REAL] Error ejecutando OpenSSL:`, opensslError.message);
            console.error(`❌ [WSAA-REAL] Ruta usada: ${OPENSSL_EXE}`);
            throw new Error(`OpenSSL falló: ${opensslError.message}. Verifica que OpenSSL esté en: ${OPENSSL_EXE}`);
        }
        
        // 5. Leer CMS (DER binario) y convertir a Base64
        const cmsBuffer = fs.readFileSync(cmsFile);
        const cmsBase64 = cmsBuffer.toString('base64');
        console.log(`✅ [WSAA-REAL] CMS (DER) convertido a Base64 (${cmsBase64.length} chars)`);
        
        // 6. Construir SOAP request
        const soapRequest = `<?xml version="1.0" encoding="UTF-8"?>
<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" xmlns:wsaa="http://wsaa.view.sua.dvadac.desein.afip.gov">
  <soapenv:Header/>
  <soapenv:Body>
    <wsaa:loginCms>
      <wsaa:in0>${cmsBase64}</wsaa:in0>
    </wsaa:loginCms>
  </soapenv:Body>
</soapenv:Envelope>`;
        
        // 7. Llamar a WSAA con headers correctos
        console.log(`📤 [WSAA-REAL] Llamando a WSAA: ${wsaaUrl}`);
        console.log(`📤 [WSAA-REAL] Headers: Content-Type=text/xml; charset=utf-8, SOAPAction=(vacío)`);
        
        const response = await axios.post(wsaaUrl, soapRequest, {
            headers: {
                'Content-Type': 'text/xml; charset=utf-8',
                'SOAPAction': ''  // CRÍTICO: header vacío obligatorio para AFIP
            },
            responseType: 'text',  // CRÍTICO: recibir como texto
            decompress: true,
            timeout: 60000
        });
        
        console.log(`✅ [WSAA-REAL] Respuesta recibida (status: ${response.status})`);
        
        // 8. Parsear respuesta SOAP con xml2js
        const responseXml = response.data.toString();
        
        // Parsear SOAP envelope (quitar prefijos de namespaces)
        const xmlOpts = {
            explicitArray: false,
            tagNameProcessors: [xml2js.processors.stripPrefix]
        };
        
        console.log('🔍 [WSAA-REAL] Parseando respuesta SOAP...');
        const soapParsed = await xml2js.parseStringPromise(responseXml, xmlOpts);
        
        // Extraer loginCmsReturn (XML interno)
        const loginCmsReturn = soapParsed?.Envelope?.Body?.loginCmsResponse?.loginCmsReturn;
        
        if (!loginCmsReturn) {
            console.error('❌ [WSAA-REAL] No se encontró loginCmsReturn en la respuesta');
            console.error('❌ [WSAA-REAL] Respuesta (primeros 500 chars):', responseXml.slice(0, 500));
            throw new Error('Respuesta WSAA sin loginCmsReturn');
        }
        
        console.log('🔍 [WSAA-REAL] Parseando TA (loginTicketResponse)...');
        
        // Parsear el TA interno
        const taParsed = await xml2js.parseStringPromise(loginCmsReturn, xmlOpts);
        
        // Extraer credenciales (con mayúsculas como vienen de AFIP)
        const token = taParsed?.loginTicketResponse?.credentials?.token;
        const sign = taParsed?.loginTicketResponse?.credentials?.sign;
        const expiraEn = taParsed?.loginTicketResponse?.header?.expirationTime;
        
        if (!token || !sign || !expiraEn) {
            console.error('❌ [WSAA-REAL] Faltan campos en el TA');
            console.error('❌ [WSAA-REAL] token:', token ? 'OK' : 'FALTA');
            console.error('❌ [WSAA-REAL] sign:', sign ? 'OK' : 'FALTA');
            console.error('❌ [WSAA-REAL] expirationTime:', expiraEn ? 'OK' : 'FALTA');
            console.error('❌ [WSAA-REAL] loginCmsReturn (primeros 500 chars):', loginCmsReturn.slice(0, 500));
            throw new Error('Respuesta WSAA incompleta (falta token/sign/expirationTime)');
        }
        
        console.log(`✅ [WSAA-REAL] TA parseado exitosamente`);
        console.log(`   Expira: ${expiraEn}`);
        
        // 9. Guardar en BD
        await guardarTA(entorno, 'wsfe', token, sign, expiraEn);
        
        // 10. Limpiar archivos temporales
        try {
            fs.unlinkSync(traFile);
            fs.unlinkSync(cmsFile);
            console.log('🗑️ [WSAA-REAL] Archivos temporales eliminados');
        } catch (cleanupError) {
            console.warn('⚠️ [WSAA-REAL] Error limpiando archivos temporales:', cleanupError.message);
        }
        
        // 11. Calcular vigencia
        const ahora = new Date();
        const expiracion = new Date(expiraEn);
        const minutosRestantes = Math.floor((expiracion - ahora) / 60000);
        const vigente = minutosRestantes > 0;
        
        console.log(`✅ [WSAA-REAL] TA renovado exitosamente (expira en ${minutosRestantes} min)`);
        
        return {
            entorno,
            servicio: 'wsfe',
            token,
            sign,
            expira_en: expiraEn,
            vigente,
            mensaje: 'TA actualizado exitosamente'
        };
        
    } catch (error) {
        console.error(`❌ [WSAA-REAL] Error renovando TA:`, error.message);
        
        // Manejar error alreadyAuthenticated de AFIP
        if (error.response && error.response.status === 500) {
            const responseBody = error.response.data?.toString() || '';
            
            // Log detallado
            console.error(`❌ [WSAA-REAL] Status: ${error.response.status}`);
            console.error(`❌ [WSAA-REAL] Body (primeros 500 chars):`, responseBody.slice(0, 500));
            
            // Verificar si es alreadyAuthenticated
            if (responseBody.includes('alreadyAuthenticated')) {
                console.warn('⚠️ [WSAA-REAL] AFIP indica que ya existe un TA válido');
                console.warn('⚠️ [WSAA-REAL] Esto significa que el TA está vigente en AFIP pero no en la BD local');
                console.warn('⚠️ [WSAA-REAL] Solución: Insertar el TA manualmente o esperar a que expire');
                
                // Crear error específico para que el controller lo maneje
                const err = new Error('TA vigente en AFIP pero no presente en la BD local');
                err.code = 'TA_AFIP_VIGENTE';
                err.afipMessage = 'El CEE ya posee un TA válido para el acceso al WSN solicitado';
                throw err;
            }
        }
        
        // Log detallado para otros errores
        if (error.response) {
            console.error(`❌ [WSAA-REAL] Headers:`, error.response.headers);
            const data = error.response.data;
            if (data) {
                console.error(`❌ [WSAA-REAL] Body:`, typeof data === 'string' ? data : JSON.stringify(data, null, 2));
            }
        }
        
        console.error(`❌ [WSAA-REAL] Stack:`, error.stack);
        
        // Intentar usar TA existente como fallback
        try {
            console.log('🔄 [WSAA-REAL] Intentando usar TA existente de BD...');
            const taExistente = await obtenerTADesdeBD(entorno, 'wsfe');
            
            if (taExistente) {
                const ahora = new Date();
                const expiracion = new Date(taExistente.expira_en);
                const vigente = expiracion > ahora;
                
                console.log(`ℹ️ [WSAA-REAL] TA existente ${vigente ? 'vigente' : 'expirado'}`);
                
                return {
                    entorno,
                    servicio: 'wsfe',
                    token: taExistente.token,
                    sign: taExistente.sign,
                    expira_en: taExistente.expira_en,
                    vigente,
                    mensaje: vigente ? 'Usando TA existente (renovación falló)' : 'TA expirado y renovación falló',
                    error: error.message
                };
            }
        } catch (fallbackError) {
            console.error('❌ [WSAA-REAL] Error obteniendo TA existente:', fallbackError.message);
        }
        
        throw error;
    }
}

console.log('✅ [WSAA-REAL] Servicio WSAA real cargado');

module.exports = {
    getTA,
    hayTAValido,
    renovarTA
};
