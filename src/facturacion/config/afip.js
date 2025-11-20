const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

console.log('🔍 [FACTURACION-AFIP] Cargando configuración de AFIP...');

/**
 * Configuración de AFIP para WSAA y WSFE
 * Soporta entornos HOMO (homologación) y PROD (producción)
 * 
 * Parámetros exactos para HOMO:
 * - CUIT: 23248921749
 * - Punto de Venta: 32
 * - Tipos soportados: 6 (Factura B), 11 (Factura C)
 */

// Entorno actual (HOMO o PROD)
const ENTORNO = process.env.AFIP_ENV || 'HOMO';

console.log(`🌍 [FACTURACION-AFIP] Entorno configurado: ${ENTORNO}`);

// CUIT de la empresa (EXACTO para HOMO)
const CUIT = process.env.AFIP_CUIT || '23248921749';

// Punto de venta (EXACTO para HOMO)
const PTO_VTA = parseInt(process.env.AFIP_PTO_VTA || '32');

// Activar AFIP real o usar stubs
const USE_REAL = process.env.AFIP_USE_REAL === 'true';

console.log(`🔧 [FACTURACION-AFIP] CUIT: ${CUIT}`);
console.log(`🔧 [FACTURACION-AFIP] Punto de Venta: ${PTO_VTA}`);
console.log(`🔧 [FACTURACION-AFIP] Usar AFIP Real: ${USE_REAL}`);

/**
 * URLs de Web Services de AFIP
 */
const URLS = {
    HOMO: {
        WSAA: process.env.WSAA_URL_HOMO || 'https://wsaahomo.afip.gov.ar/ws/services/LoginCms',
        WSFE: process.env.WSFE_URL_HOMO || 'https://wswhomo.afip.gov.ar/wsfev1/service.asmx'
    },
    PROD: {
        WSAA: process.env.WSAA_URL_PROD || 'https://wsaa.afip.gov.ar/ws/services/LoginCms',
        WSFE: process.env.WSFE_URL_PROD || 'https://servicios1.afip.gov.ar/wsfev1/service.asmx'
    }
};

/**
 * Rutas a certificados y claves
 * Usa rutas absolutas del .env (validadas en HOMO)
 */
const CERTIFICADOS = {
    HOMO: {
        CERT: process.env.CERT_FILE || path.resolve(__dirname, '..', './certs/homo_cert.pem'),
        KEY: process.env.KEY_FILE || path.resolve(__dirname, '..', './certs/homo_key.pem')
    },
    PROD: {
        CERT: process.env.CERT_FILE_PROD || path.resolve(__dirname, '..', './certs/prod-cert.pem'),
        KEY: process.env.KEY_FILE_PROD || path.resolve(__dirname, '..', './certs/prod-key.pem')
    }
};

/**
 * Rutas adicionales para WSAA
 */
const WSAA_WORKDIR = process.env.WSAA_WORKDIR || path.resolve(__dirname, '..', './wsaa');
const OPENSSL_EXE = process.env.OPENSSL_EXE || 'C:\\Program Files\\OpenSSL-Win64\\bin\\openssl.exe';

console.log(`📁 [FACTURACION-AFIP] WSAA Workdir: ${WSAA_WORKDIR}`);
console.log(`🔧 [FACTURACION-AFIP] OpenSSL: ${OPENSSL_EXE}`);

/**
 * Configuración de WSAA (Web Service de Autenticación y Autorización)
 */
const WSAA_CONFIG = {
    // Servicio a autenticar (wsfe para facturación electrónica)
    SERVICIO: process.env.AFIP_SERVICE || 'wsfe',
    
    // Minutos antes de expiración para renovar el token
    RENOVAR_ANTES_MINUTOS: parseInt(process.env.WSAA_RENEW_MINUTES_BEFORE || '5'),
    
    // Tiempo de vida del ticket de acceso (en segundos, AFIP lo define)
    TTL_TICKET: 43200 // 12 horas
};

/**
 * Configuración de WSFE (Web Service de Facturación Electrónica)
 */
const WSFE_CONFIG = {
    // Namespace del servicio
    NAMESPACE: 'http://ar.gov.afip.dif.FEV1/',
    
    // Timeout para requests SOAP (en milisegundos)
    TIMEOUT: 30000,
    
    // Reintentos en caso de error
    REINTENTOS: 3,
    
    // Delay entre reintentos (en milisegundos)
    DELAY_REINTENTOS: 1000
};

/**
 * Tipos de comprobante soportados
 */
const TIPOS_COMPROBANTE = {
    1: 'Factura A',
    2: 'Nota de Débito A',
    3: 'Nota de Crédito A',
    6: 'Factura B',
    7: 'Nota de Débito B',
    8: 'Nota de Crédito B',
    11: 'Factura C',
    12: 'Nota de Débito C',
    13: 'Nota de Crédito C'
};

/**
 * Tipos de comprobante soportados para este sistema
 * (Configurables según necesidad)
 */
const TIPOS_CBTE_SOPORTADOS = [6, 11]; // Factura B y C por defecto

/**
 * Tipos de documento
 */
const TIPOS_DOCUMENTO = {
    80: 'CUIT',
    86: 'CUIL',
    87: 'CDI',
    89: 'LE',
    90: 'LC',
    91: 'CI Extranjera',
    92: 'En trámite',
    93: 'Acta Nacimiento',
    95: 'CI Bs. As. RNP',
    96: 'DNI',
    99: 'Consumidor Final',
    0: 'Sin identificar'
};

/**
 * Tipos de concepto
 */
const TIPOS_CONCEPTO = {
    1: 'Productos',
    2: 'Servicios',
    3: 'Productos y Servicios'
};

/**
 * Alícuotas de IVA (según tabla factura_iva_alicuotas)
 * ID = id de la tabla, codigo_afip = código que va a AFIP
 */
const ALICUOTAS_IVA = {
    1: { porcentaje: 21, descripcion: 'IVA 21%', codigo_afip: 5 },
    2: { porcentaje: 10.5, descripcion: 'IVA 10.5%', codigo_afip: 4 },
    3: { porcentaje: 0, descripcion: 'Exento', codigo_afip: 3 }
};

/**
 * Condiciones de IVA
 */
const CONDICIONES_IVA = {
    1: 'Responsable Inscripto',
    2: 'Responsable no Inscripto',
    3: 'No Responsable',
    4: 'Exento',
    5: 'Consumidor Final',
    6: 'Responsable Monotributo',
    7: 'Sujeto no Categorizado',
    8: 'Proveedor del Exterior',
    9: 'Cliente del Exterior',
    10: 'IVA Liberado',
    11: 'IVA Responsable Inscripto - Agente de Percepción',
    12: 'Pequeño Contribuyente Eventual',
    13: 'Monotributista Social',
    14: 'Pequeño Contribuyente Eventual Social'
};

/**
 * Monedas soportadas
 */
const MONEDAS = {
    'PES': { codigo: 'PES', descripcion: 'Pesos Argentinos', simbolo: '$' },
    'DOL': { codigo: 'DOL', descripcion: 'Dólar Estadounidense', simbolo: 'U$S' },
    'EUR': { codigo: 'EUR', descripcion: 'Euro', simbolo: '€' }
};

/**
 * Obtener configuración según el entorno actual
 * @returns {Object} Configuración del entorno
 */
const obtenerConfiguracion = () => {
    const config = {
        entorno: ENTORNO,
        cuit: CUIT,
        urls: URLS[ENTORNO],
        certificados: CERTIFICADOS[ENTORNO],
        wsaa: WSAA_CONFIG,
        wsfe: WSFE_CONFIG,
        wsaaWorkdir: WSAA_WORKDIR,
        opensslExe: OPENSSL_EXE
    };
    
    console.log('📋 [FACTURACION-AFIP] Configuración cargada:');
    console.log(`   - Entorno: ${config.entorno}`);
    console.log(`   - CUIT: ${config.cuit}`);
    console.log(`   - WSAA URL: ${config.urls.WSAA}`);
    console.log(`   - WSFE URL: ${config.urls.WSFE}`);
    console.log(`   - Certificado: ${config.certificados.CERT}`);
    console.log(`   - Clave: ${config.certificados.KEY}`);
    console.log(`   - WSAA Workdir: ${config.wsaaWorkdir}`);
    console.log(`   - OpenSSL: ${config.opensslExe}`);
    
    return config;
};

/**
 * Validar que la configuración esté completa
 * @returns {Object} Resultado de la validación
 */
const validarConfiguracion = () => {
    console.log('🔍 [FACTURACION-AFIP] Validando configuración...');
    
    const errores = [];
    const advertencias = [];
    
    // Validar CUIT
    if (!CUIT) {
        errores.push('CUIT no configurado (AFIP_CUIT)');
    } else if (!/^\d{11}$/.test(CUIT)) {
        errores.push('CUIT debe tener 11 dígitos sin guiones');
    }
    
    // Validar entorno
    if (!['HOMO', 'PROD'].includes(ENTORNO)) {
        errores.push('Entorno debe ser HOMO o PROD (AFIP_ENV)');
    }
    
    // Validar URLs
    if (!URLS[ENTORNO].WSAA) {
        errores.push('URL de WSAA no configurada');
    }
    if (!URLS[ENTORNO].WSFE) {
        errores.push('URL de WSFE no configurada');
    }
    
    // Advertencias para certificados (no son errores críticos en esta etapa)
    if (!CERTIFICADOS[ENTORNO].CERT) {
        advertencias.push('Ruta de certificado no configurada');
    }
    if (!CERTIFICADOS[ENTORNO].KEY) {
        advertencias.push('Ruta de clave privada no configurada');
    }
    
    // Mostrar resultados
    if (errores.length > 0) {
        console.error('❌ [FACTURACION-AFIP] Errores de configuración:');
        errores.forEach(error => console.error(`   - ${error}`));
    }
    
    if (advertencias.length > 0) {
        console.warn('⚠️ [FACTURACION-AFIP] Advertencias de configuración:');
        advertencias.forEach(adv => console.warn(`   - ${adv}`));
    }
    
    if (errores.length === 0 && advertencias.length === 0) {
        console.log('✅ [FACTURACION-AFIP] Configuración válida');
    }
    
    return {
        valida: errores.length === 0,
        errores,
        advertencias
    };
};

module.exports = {
    ENTORNO,
    CUIT,
    PTO_VTA,
    USE_REAL,
    URLS,
    CERTIFICADOS,
    WSAA_WORKDIR,
    OPENSSL_EXE,
    WSAA_CONFIG,
    WSFE_CONFIG,
    TIPOS_COMPROBANTE,
    TIPOS_DOCUMENTO,
    TIPOS_CONCEPTO,
    ALICUOTAS_IVA,
    CONDICIONES_IVA,
    MONEDAS,
    TIPOS_CBTE_SOPORTADOS,
    obtenerConfiguracion,
    validarConfiguracion
};
