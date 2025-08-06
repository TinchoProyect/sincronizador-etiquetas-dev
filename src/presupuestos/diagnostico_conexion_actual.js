console.log('🔍 [DIAGNÓSTICO] Iniciando diagnóstico de conexión Google Sheets...');

const fs = require('fs');
const path = require('path');

// Verificar archivos de credenciales
function verificarCredenciales() {
    console.log('\n📋 [DIAGNÓSTICO] Verificando archivos de credenciales...');
    
    const credentialsPath = path.join(__dirname, '../config/google-credentials.json');
    const tokenPath = path.join(__dirname, '../config/google-token.json');
    
    console.log('📁 [DIAGNÓSTICO] Ruta credenciales:', credentialsPath);
    console.log('📁 [DIAGNÓSTICO] Ruta token:', tokenPath);
    
    // Verificar google-credentials.json
    if (fs.existsSync(credentialsPath)) {
        console.log('✅ [DIAGNÓSTICO] google-credentials.json EXISTE');
        try {
            const credentials = JSON.parse(fs.readFileSync(credentialsPath, 'utf8'));
            console.log('✅ [DIAGNÓSTICO] Credenciales válidas JSON');
            console.log('📊 [DIAGNÓSTICO] Client ID:', credentials.installed?.client_id ? 'PRESENTE' : 'AUSENTE');
            console.log('📊 [DIAGNÓSTICO] Client Secret:', credentials.installed?.client_secret ? 'PRESENTE' : 'AUSENTE');
            console.log('📊 [DIAGNÓSTICO] Project ID:', credentials.installed?.project_id || 'NO ENCONTRADO');
        } catch (error) {
            console.log('❌ [DIAGNÓSTICO] Error leyendo credenciales:', error.message);
        }
    } else {
        console.log('❌ [DIAGNÓSTICO] google-credentials.json NO EXISTE');
    }
    
    // Verificar google-token.json
    if (fs.existsSync(tokenPath)) {
        console.log('✅ [DIAGNÓSTICO] google-token.json EXISTE');
        try {
            const token = JSON.parse(fs.readFileSync(tokenPath, 'utf8'));
            console.log('✅ [DIAGNÓSTICO] Token válido JSON');
            console.log('📊 [DIAGNÓSTICO] Access Token:', token.access_token ? 'PRESENTE' : 'AUSENTE');
            console.log('📊 [DIAGNÓSTICO] Refresh Token:', token.refresh_token ? 'PRESENTE' : 'AUSENTE');
            
            if (token.expiry_date) {
                const expiryDate = new Date(token.expiry_date);
                const now = new Date();
                const isValid = expiryDate > now;
                console.log('📊 [DIAGNÓSTICO] Expiry Date:', expiryDate.toISOString());
                console.log('📊 [DIAGNÓSTICO] Token válido:', isValid ? '✅ SÍ' : '❌ EXPIRADO');
            }
        } catch (error) {
            console.log('❌ [DIAGNÓSTICO] Error leyendo token:', error.message);
        }
    } else {
        console.log('❌ [DIAGNÓSTICO] google-token.json NO EXISTE');
    }
}

// Probar conexión con Google Sheets
async function probarConexion() {
    console.log('\n🔗 [DIAGNÓSTICO] Probando conexión con Google Sheets...');
    
    try {
        // Intentar cargar el servicio de autenticación
        const authService = require('../../services/gsheets/auth_with_logs');
        console.log('✅ [DIAGNÓSTICO] Servicio de autenticación cargado');
        
        // Verificar estado de autenticación
        const authStatus = await authService.checkAuthStatus();
        console.log('📊 [DIAGNÓSTICO] Estado de autenticación:', authStatus.authenticated ? '✅ AUTENTICADO' : '❌ NO AUTENTICADO');
        
        if (authStatus.authenticated) {
            console.log('✅ [DIAGNÓSTICO] Token válido y funcional');
            
            // Intentar acceder al archivo específico
            const clientService = require('../../services/gsheets/client_with_logs');
            const sheetId = '1r7VEnEArREqAGZiDxQCW4A0XIKb8qaxHXD0TlVhfuf8';
            
            console.log('🔍 [DIAGNÓSTICO] Probando acceso al archivo PresupuestosCopia...');
            const validation = await clientService.validateSheetAccess(sheetId);
            
            if (validation.hasAccess) {
                console.log('✅ [DIAGNÓSTICO] Acceso al archivo EXITOSO');
                console.log('📊 [DIAGNÓSTICO] Título del archivo:', validation.sheetTitle);
                console.log('📊 [DIAGNÓSTICO] Hojas disponibles:', validation.availableSheets.join(', '));
            } else {
                console.log('❌ [DIAGNÓSTICO] Acceso al archivo FALLIDO');
                console.log('📊 [DIAGNÓSTICO] Error:', validation.error);
                console.log('📊 [DIAGNÓSTICO] Tipo de error:', validation.errorType);
            }
        } else {
            console.log('❌ [DIAGNÓSTICO] No se puede probar acceso - token no válido');
            if (authStatus.error) {
                console.log('📊 [DIAGNÓSTICO] Error de autenticación:', authStatus.error);
            }
        }
        
    } catch (error) {
        console.log('❌ [DIAGNÓSTICO] Error crítico probando conexión:', error.message);
        console.log('📊 [DIAGNÓSTICO] Stack trace:', error.stack);
    }
}

// Verificar configuración de base de datos
async function verificarConfiguracion() {
    console.log('\n⚙️ [DIAGNÓSTICO] Verificando configuración en base de datos...');
    
    try {
        const dbConfig = require('../config/database');
        console.log('✅ [DIAGNÓSTICO] Configuración de BD cargada');
        
        // Intentar conectar y consultar configuración activa
        const query = `
            SELECT * FROM presupuestos_config 
            WHERE activo = true 
            ORDER BY fecha_creacion DESC 
            LIMIT 1
        `;
        
        const result = await dbConfig.query(query);
        
        if (result.rows.length > 0) {
            const config = result.rows[0];
            console.log('✅ [DIAGNÓSTICO] Configuración activa encontrada');
            console.log('📊 [DIAGNÓSTICO] ID de configuración:', config.id);
            console.log('📊 [DIAGNÓSTICO] URL de hoja:', config.hoja_url);
            console.log('📊 [DIAGNÓSTICO] ID de hoja:', config.hoja_id);
            console.log('📊 [DIAGNÓSTICO] Nombre de hoja:', config.hoja_nombre);
            console.log('📊 [DIAGNÓSTICO] Rango:', config.rango);
            console.log('📊 [DIAGNÓSTICO] Fecha creación:', config.fecha_creacion);
        } else {
            console.log('❌ [DIAGNÓSTICO] No hay configuración activa en BD');
        }
        
    } catch (error) {
        console.log('❌ [DIAGNÓSTICO] Error verificando configuración BD:', error.message);
    }
}

// Ejecutar diagnóstico completo
async function ejecutarDiagnostico() {
    console.log('🚀 [DIAGNÓSTICO] ===== DIAGNÓSTICO COMPLETO DE GOOGLE SHEETS =====');
    
    verificarCredenciales();
    await probarConexion();
    await verificarConfiguracion();
    
    console.log('\n🏁 [DIAGNÓSTICO] ===== DIAGNÓSTICO COMPLETADO =====');
}

// Ejecutar si se llama directamente
if (require.main === module) {
    ejecutarDiagnostico().catch(error => {
        console.error('💥 [DIAGNÓSTICO] Error crítico:', error);
        process.exit(1);
    });
}

module.exports = {
    verificarCredenciales,
    probarConexion,
    verificarConfiguracion,
    ejecutarDiagnostico
};
