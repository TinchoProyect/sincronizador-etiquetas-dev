const { google } = require('googleapis');
const fs = require('fs');
const path = require('path');
const { USE_SA_SHEETS } = require('../../config/feature-flags');

console.log('🔍 [PRESUPUESTOS-BACK] Configurando autenticación Google Sheets API con logs...');

// Adapter injection para Service Account
let adapter = null;
if (USE_SA_SHEETS) {
    try {
        const ServiceAccountAdapter = require('../../presupuestos/adapters/GoogleSheetsServiceAccountAdapter');
        adapter = new ServiceAccountAdapter();
        console.log('✅ [PRESUPUESTOS-BACK] Service Account adapter cargado con logs');
    } catch (error) {
        console.error('❌ [PRESUPUESTOS-BACK] Error al cargar Service Account adapter con logs:', error.message);
        console.log('⚠️ [PRESUPUESTOS-BACK] Fallback a OAuth2 con logs');
    }
}

/**
 * Servicio de autenticación para Google Sheets API con logs detallados
 * Maneja credenciales y tokens de acceso
 */

// Configuración de scopes para Google Sheets
const SCOPES = [
    'https://www.googleapis.com/auth/spreadsheets.readonly',
    'https://www.googleapis.com/auth/drive.readonly'
];

// Rutas de archivos de credenciales
const CREDENTIALS_PATH = path.join(__dirname, '../../config/google-credentials.json');
const TOKEN_PATH = path.join(__dirname, '../../config/google-token.json');

/**
 * Cargar credenciales desde archivo
 */
function loadCredentials() {
    console.log('🔍 [PRESUPUESTOS-BACK] Cargando credenciales de Google...');
    
    try {
        if (!fs.existsSync(CREDENTIALS_PATH)) {
            console.error('❌ [PRESUPUESTOS-BACK] Archivo de credenciales no encontrado:', CREDENTIALS_PATH);
            throw new Error('Archivo de credenciales de Google no encontrado. Configure google-credentials.json');
        }
        
        const credentials = JSON.parse(fs.readFileSync(CREDENTIALS_PATH, 'utf8'));
        console.log('✅ [PRESUPUESTOS-BACK] Credenciales cargadas exitosamente');
        console.log('🔍 [PRESUPUESTOS-BACK] Tipo de credenciales:', credentials.installed ? 'installed' : 'web');
        
        return credentials;
    } catch (error) {
        console.error('❌ [PRESUPUESTOS-BACK] Error al cargar credenciales:', error.message);
        throw error;
    }
}

/**
 * Crear cliente OAuth2
 */
function createOAuth2Client(credentials) {
    console.log('🔍 [PRESUPUESTOS-BACK] Creando cliente OAuth2...');
    
    try {
        const { client_secret, client_id, redirect_uris } = credentials.installed || credentials.web;
        
        console.log('🔍 [PRESUPUESTOS-BACK] client_id:', client_id ? 'PRESENTE' : 'AUSENTE');
        console.log('🔍 [PRESUPUESTOS-BACK] client_secret:', client_secret ? 'PRESENTE' : 'AUSENTE');
        console.log('🔍 [PRESUPUESTOS-BACK] redirect_uris:', redirect_uris ? redirect_uris.length : 0);
        
        const oAuth2Client = new google.auth.OAuth2(
            client_id,
            client_secret,
            redirect_uris[0]
        );
        
        console.log('✅ [PRESUPUESTOS-BACK] Cliente OAuth2 creado exitosamente');
        return oAuth2Client;
    } catch (error) {
        console.error('❌ [PRESUPUESTOS-BACK] Error al crear cliente OAuth2:', error.message);
        throw error;
    }
}

/**
 * Cargar token guardado
 */
function loadSavedToken() {
    console.log('🔍 [PRESUPUESTOS-BACK] Verificando token guardado...');
    
    try {
        if (!fs.existsSync(TOKEN_PATH)) {
            console.log('⚠️ [PRESUPUESTOS-BACK] No se encontró token guardado en:', TOKEN_PATH);
            return null;
        }
        
        const token = JSON.parse(fs.readFileSync(TOKEN_PATH, 'utf8'));
        console.log('✅ [PRESUPUESTOS-BACK] Token cargado desde archivo');
        console.log('🔍 [PRESUPUESTOS-BACK] Token expiry_date:', token.expiry_date);
        console.log('🔍 [PRESUPUESTOS-BACK] Token access_token:', token.access_token ? 'PRESENTE' : 'AUSENTE');
        console.log('🔍 [PRESUPUESTOS-BACK] Token refresh_token:', token.refresh_token ? 'PRESENTE' : 'AUSENTE');
        
        return token;
    } catch (error) {
        console.error('❌ [PRESUPUESTOS-BACK] Error al cargar token:', error.message);
        return null;
    }
}

/**
 * Guardar token para uso futuro
 */
function saveToken(token) {
    console.log('🔍 [PRESUPUESTOS-BACK] Guardando token...');
    
    try {
        // Crear directorio si no existe
        const tokenDir = path.dirname(TOKEN_PATH);
        if (!fs.existsSync(tokenDir)) {
            console.log('🔍 [PRESUPUESTOS-BACK] Creando directorio para token:', tokenDir);
            fs.mkdirSync(tokenDir, { recursive: true });
        }
        
        fs.writeFileSync(TOKEN_PATH, JSON.stringify(token, null, 2));
        console.log('✅ [PRESUPUESTOS-BACK] Token guardado exitosamente en:', TOKEN_PATH);
        console.log('🔍 [PRESUPUESTOS-BACK] Token guardado expiry_date:', token.expiry_date);
    } catch (error) {
        console.error('❌ [PRESUPUESTOS-BACK] Error al guardar token:', error.message);
        throw error;
    }
}

/**
 * Generar URL de autorización
 */
function generateAuthUrl(oAuth2Client) {
    // Usar Service Account si está habilitado
    if (USE_SA_SHEETS && adapter) {
        console.log('🔍 [PRESUPUESTOS-BACK] Usando Service Account - no requiere autorización');
        return adapter.generateAuthUrl().catch(() => 'Service Account configurado - no requiere autorización manual');
    }
    
    console.log('🔍 [PRESUPUESTOS-BACK] Generando URL de autorización...');
    
    const authUrl = oAuth2Client.generateAuthUrl({
        access_type: 'offline',
        scope: SCOPES,
        prompt: 'consent'
    });
    
    console.log('✅ [PRESUPUESTOS-BACK] URL de autorización generada');
    console.log('🔗 [PRESUPUESTOS-BACK] URL:', authUrl);
    console.log('🔍 [PRESUPUESTOS-BACK] Scopes solicitados:', SCOPES);
    
    return authUrl;
}

/**
 * Obtener token desde código de autorización
 */
async function getTokenFromCode(oAuth2Client, code) {
    // Usar Service Account si está habilitado
    if (USE_SA_SHEETS && adapter) {
        console.log('🔍 [PRESUPUESTOS-BACK] Usando Service Account - no requiere código');
        return adapter.getTokenFromCode(code).catch(() => ({ type: 'service_account', status: 'ready' }));
    }
    
    console.log('🔍 [PRESUPUESTOS-BACK] Obteniendo token desde código de autorización...');
    console.log('🔍 [PRESUPUESTOS-BACK] Código recibido:', code ? 'PRESENTE' : 'AUSENTE');
    
    try {
        const { tokens } = await oAuth2Client.getToken(code);
        console.log('✅ [PRESUPUESTOS-BACK] Token obtenido exitosamente');
        console.log('🔍 [PRESUPUESTOS-BACK] Token obtenido access_token:', tokens.access_token ? 'PRESENTE' : 'AUSENTE');
        console.log('🔍 [PRESUPUESTOS-BACK] Token obtenido refresh_token:', tokens.refresh_token ? 'PRESENTE' : 'AUSENTE');
        console.log('🔍 [PRESUPUESTOS-BACK] Token obtenido expiry_date:', tokens.expiry_date);
        
        // Guardar token para uso futuro
        saveToken(tokens);
        
        return tokens;
    } catch (error) {
        console.error('❌ [PRESUPUESTOS-BACK] Error al obtener token:', error.message);
        console.log('🔍 [PRESUPUESTOS-BACK] Error details:', error);
        throw error;
    }
}

/**
 * Verificar si el token es válido
 */
async function isTokenValid(oAuth2Client) {
    console.log('🔍 [PRESUPUESTOS-BACK] Verificando validez del token...');
    
    try {
        if (!oAuth2Client.credentials.access_token) {
            console.log('⚠️ [PRESUPUESTOS-BACK] No hay access_token en credentials');
            return false;
        }
        
        const tokenInfo = await oAuth2Client.getTokenInfo(oAuth2Client.credentials.access_token);
        const isValid = tokenInfo.expiry_date > Date.now();
        
        console.log(`${isValid ? '✅' : '⚠️'} [PRESUPUESTOS-BACK] Token ${isValid ? 'válido' : 'expirado'}`);
        console.log('🔍 [PRESUPUESTOS-BACK] Token expiry_date:', tokenInfo.expiry_date);
        console.log('🔍 [PRESUPUESTOS-BACK] Current time:', Date.now());
        
        return isValid;
    } catch (error) {
        console.error('❌ [PRESUPUESTOS-BACK] Error al verificar token:', error.message);
        console.log('🔍 [PRESUPUESTOS-BACK] Token verification error details:', error);
        return false;
    }
}

/**
 * Refrescar token si es necesario
 */
async function refreshTokenIfNeeded(oAuth2Client) {
    console.log('🔍 [PRESUPUESTOS-BACK] Verificando si es necesario refrescar token...');
    
    try {
        if (!oAuth2Client.credentials.refresh_token) {
            console.log('⚠️ [PRESUPUESTOS-BACK] No hay refresh token disponible');
            return false;
        }
        
        console.log('🔍 [PRESUPUESTOS-BACK] Refresh token disponible, verificando validez...');
        const isValid = await isTokenValid(oAuth2Client);
        
        if (!isValid) {
            console.log('🔄 [PRESUPUESTOS-BACK] Refrescando token...');
            
            const { credentials } = await oAuth2Client.refreshAccessToken();
            console.log('🔍 [PRESUPUESTOS-BACK] Nuevas credenciales obtenidas');
            console.log('🔍 [PRESUPUESTOS-BACK] Nuevo access_token:', credentials.access_token ? 'PRESENTE' : 'AUSENTE');
            console.log('🔍 [PRESUPUESTOS-BACK] Nuevo expiry_date:', credentials.expiry_date);
            
            oAuth2Client.setCredentials(credentials);
            
            // Guardar nuevo token
            saveToken(credentials);
            
            console.log('✅ [PRESUPUESTOS-BACK] Token refrescado exitosamente');
        } else {
            console.log('✅ [PRESUPUESTOS-BACK] Token actual aún válido, no es necesario refrescar');
        }
        
        return true;
    } catch (error) {
        console.error('❌ [PRESUPUESTOS-BACK] Error al refrescar token:', error.message);
        console.log('🔍 [PRESUPUESTOS-BACK] Refresh error details:', error);
        return false;
    }
}

/**
 * Obtener cliente autenticado
 */
async function getAuthenticatedClient() {
    console.log('🔍 [PRESUPUESTOS-BACK] Obteniendo cliente autenticado...');
    
    // 🔍 LOG PUNTO 2: Autenticación o carga del client_email y private_key
    console.log('🔍 [GSHEETS-DEBUG] PUNTO 2: Autenticación - Cargando credenciales');
    
    try {
        // Cargar credenciales
        console.log('🔍 [GSHEETS-DEBUG] Cargando credenciales desde archivo...');
        const credentials = loadCredentials();
        console.log('🔍 [GSHEETS-DEBUG] Credenciales cargadas exitosamente');
        console.log('🔍 [GSHEETS-DEBUG] Tipo de credenciales:', credentials.installed ? 'installed' : 'web');
        
        if (credentials.installed) {
            console.log('🔍 [GSHEETS-DEBUG] client_id:', credentials.installed.client_id ? 'PRESENTE' : 'AUSENTE');
            console.log('🔍 [GSHEETS-DEBUG] client_secret:', credentials.installed.client_secret ? 'PRESENTE' : 'AUSENTE');
        } else if (credentials.web) {
            console.log('🔍 [GSHEETS-DEBUG] client_id:', credentials.web.client_id ? 'PRESENTE' : 'AUSENTE');
            console.log('🔍 [GSHEETS-DEBUG] client_secret:', credentials.web.client_secret ? 'PRESENTE' : 'AUSENTE');
        }
        
        const oAuth2Client = createOAuth2Client(credentials);
        console.log('🔍 [GSHEETS-DEBUG] Cliente OAuth2 creado exitosamente');
        
        // Intentar cargar token guardado
        console.log('🔍 [GSHEETS-DEBUG] Verificando token guardado...');
        const savedToken = loadSavedToken();
        
        if (savedToken) {
            console.log('🔍 [PRESUPUESTOS-BACK] Usando token guardado...');
            console.log('🔍 [GSHEETS-DEBUG] Token encontrado - expiry_date:', savedToken.expiry_date);
            console.log('🔍 [GSHEETS-DEBUG] Token access_token:', savedToken.access_token ? 'PRESENTE' : 'AUSENTE');
            console.log('🔍 [GSHEETS-DEBUG] Token refresh_token:', savedToken.refresh_token ? 'PRESENTE' : 'AUSENTE');
            
            oAuth2Client.setCredentials(savedToken);
            
            // Verificar y refrescar si es necesario
            console.log('🔍 [GSHEETS-DEBUG] Verificando validez del token...');
            const refreshed = await refreshTokenIfNeeded(oAuth2Client);
            
            if (refreshed) {
                console.log('✅ [PRESUPUESTOS-BACK] Cliente autenticado exitosamente');
                console.log('🔍 [GSHEETS-DEBUG] ✅ AUTENTICACIÓN EXITOSA - Cliente listo para usar');
                return oAuth2Client;
            } else {
                console.log('🔍 [GSHEETS-DEBUG] ❌ FALLO EN REFRESH DEL TOKEN');
            }
        } else {
            console.log('🔍 [GSHEETS-DEBUG] ❌ NO SE ENCONTRÓ TOKEN GUARDADO');
        }
        
        // Si no hay token válido, generar URL de autorización
        console.log('⚠️ [PRESUPUESTOS-BACK] Se requiere autorización manual');
        console.log('🔍 [GSHEETS-DEBUG] ❌ REQUIERE AUTORIZACIÓN MANUAL');
        const authUrl = generateAuthUrl(oAuth2Client);
        console.log('🔍 [GSHEETS-DEBUG] URL de autorización generada:', authUrl);
        
        throw new Error(`Autorización requerida. Visite: ${authUrl}`);
        
    } catch (error) {
        console.error('❌ [PRESUPUESTOS-BACK] Error al obtener cliente autenticado:', error.message);
        console.log('🔍 [GSHEETS-DEBUG] ❌ ERROR EN AUTENTICACIÓN:', error.message);
        console.log('🔍 [GSHEETS-DEBUG] Error stack:', error.stack);
        throw error;
    }
}

/**
 * Verificar estado de autenticación
 */
async function checkAuthStatus() {
    // Usar Service Account si está habilitado
    if (USE_SA_SHEETS && adapter) {
        console.log('🔍 [PRESUPUESTOS-BACK] Verificando estado con Service Account...');
        return await adapter.checkAuthStatus();
    }
    
    // Código OAuth2 original
    console.log('🔍 [PRESUPUESTOS-BACK] Verificando estado de autenticación...');
    
    try {
        const client = await getAuthenticatedClient();
        
        const status = {
            authenticated: true,
            hasValidToken: true,
            tokenExpiry: client.credentials.expiry_date,
            scopes: SCOPES,
            authType: 'oauth2'
        };
        
        console.log('✅ [PRESUPUESTOS-BACK] Estado de autenticación:', status);
        
        return status;
    } catch (error) {
        console.log('⚠️ [PRESUPUESTOS-BACK] No autenticado:', error.message);
        
        const status = {
            authenticated: false,
            hasValidToken: false,
            error: error.message,
            authUrl: error.message.includes('Visite:') ? 
                error.message.split('Visite: ')[1] : null,
            authType: 'oauth2'
        };
        
        console.log('❌ [PRESUPUESTOS-BACK] Estado de no autenticación:', status);
        
        return status;
    }
}

console.log('✅ [PRESUPUESTOS-BACK] Servicio de autenticación Google configurado con logs');

module.exports = {
    loadCredentials,
    createOAuth2Client,
    loadSavedToken,
    saveToken,
    generateAuthUrl,
    getTokenFromCode,
    isTokenValid,
    refreshTokenIfNeeded,
    getAuthenticatedClient,
    checkAuthStatus,
    SCOPES
};
