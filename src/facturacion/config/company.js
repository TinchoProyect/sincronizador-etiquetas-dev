/**
 * Configuración de datos de la empresa
 * Lee desde .env y valida los datos
 */

console.log('🔍 [FACTURACION-COMPANY] Cargando configuración de empresa...');

/**
 * Formatea un CUIT al formato XX-XXXXXXXX-X
 * @param {string} cuit - CUIT sin formato (11 dígitos)
 * @returns {string} CUIT formateado
 */
function formatCUIT(cuit) {
    if (!cuit || cuit.length !== 11) {
        return cuit;
    }
    return `${cuit.substring(0, 2)}-${cuit.substring(2, 10)}-${cuit.substring(10)}`;
}

/**
 * Formatea un CBU en bloques de 22 dígitos
 * @param {string} cbu - CBU sin formato (22 dígitos)
 * @returns {string} CBU formateado
 */
function formatCBU(cbu) {
    if (!cbu || cbu.length !== 22) {
        return cbu;
    }
    // Formato: 007 0373 2300 0400 7844 141 (bloques de 3-4-4-4-4-3)
    return `${cbu.substring(0, 3)} ${cbu.substring(3, 7)} ${cbu.substring(7, 11)} ${cbu.substring(11, 15)} ${cbu.substring(15, 19)} ${cbu.substring(19)}`;
}

/**
 * Valida y obtiene la configuración de la empresa
 * @returns {Object} Datos de la empresa formateados y validados
 */
function getCompanyConfig() {
    const config = {
        // Datos básicos
        name: process.env.COMPANY_NAME || '',
        address: process.env.COMPANY_ADDRESS || '',
        
        // CUIT
        cuitRaw: process.env.COMPANY_CUIT || '',
        cuitFmt: '',
        
        // Datos bancarios
        bank: process.env.COMPANY_BANK || '',
        du: process.env.COMPANY_DU || '',
        account: process.env.COMPANY_ACCOUNT || '',
        
        // CBU
        cbuRaw: process.env.COMPANY_CBU || '',
        cbuFmt: '',
        
        alias: process.env.COMPANY_ALIAS || '',
        
        // Contacto (opcionales)
        email: process.env.COMPANY_EMAIL || '',
        phone: process.env.COMPANY_PHONE || ''
    };
    
    // Validar CUIT
    if (config.cuitRaw) {
        if (config.cuitRaw.length !== 11 || !/^\d{11}$/.test(config.cuitRaw)) {
            console.warn('⚠️ [FACTURACION-COMPANY] CUIT inválido (debe tener 11 dígitos)');
        } else {
            config.cuitFmt = formatCUIT(config.cuitRaw);
        }
    }
    
    // Validar CBU
    if (config.cbuRaw) {
        if (config.cbuRaw.length !== 22 || !/^\d{22}$/.test(config.cbuRaw)) {
            console.warn('⚠️ [FACTURACION-COMPANY] CBU inválido (debe tener 22 dígitos)');
        } else {
            config.cbuFmt = formatCBU(config.cbuRaw);
        }
    }
    
    // Log de configuración cargada (sin mostrar datos sensibles completos)
    console.log('✅ [FACTURACION-COMPANY] Configuración cargada:');
    console.log(`   - Empresa: ${config.name}`);
    console.log(`   - Dirección: ${config.address}`);
    console.log(`   - CUIT: ${config.cuitFmt || 'No configurado'}`);
    console.log(`   - Banco: ${config.bank || 'No configurado'}`);
    console.log(`   - CBU: ${config.cbuRaw ? 'Configurado' : 'No configurado'}`);
    console.log(`   - Alias: ${config.alias || 'No configurado'}`);
    console.log(`   - Email: ${config.email || 'No configurado'}`);
    console.log(`   - Teléfono: ${config.phone || 'No configurado'}`);
    
    return config;
}

// Exportar configuración
const COMPANY_CONFIG = getCompanyConfig();

module.exports = {
    COMPANY_CONFIG,
    formatCUIT,
    formatCBU
};
