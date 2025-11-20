/**
 * Servicio de autenticación WSAA (Web Service de Autenticación y Autorización)
 * Gestiona tokens de acceso para servicios de AFIP
 * 
 * IMPLEMENTACIÓN REAL para AFIP HOMO/PROD
 */

const { USE_REAL } = require('../config/afip');

console.log('🔍 [FACTURACION-WSAA] Cargando servicio WSAA...');
console.log(`   Modo: ${USE_REAL ? 'REAL (AFIP)' : 'STUB (Desarrollo)'}`);

// Cargar implementación real
const wsaaReal = require('./wsaaService.real');

console.log('✅ [FACTURACION-WSAA] Servicio WSAA cargado');

// Exportar funciones de la implementación real
module.exports = {
    getTA: wsaaReal.getTA,
    hayTAValido: wsaaReal.hayTAValido,
    renovarTA: wsaaReal.renovarTA
};
