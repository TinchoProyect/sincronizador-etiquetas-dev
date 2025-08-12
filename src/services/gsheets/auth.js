const { google } = require('googleapis');
const fs = require('fs');
const path = require('path');

console.log('🔍 [PRESUPUESTOS] Configurando autenticación Google Sheets API...');

/**
 * Servicio de autenticación para Google Sheets API
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
    console.log('🔍 [PRESUPUESTOS] Cargando credenciales de Google...');
    
    try {
        if (!fs.existsSync(CREDENTIALS_PATH)) {
            console.error('❌ [PRESUPUESTOS] Archivo de credenciales no encontrado:', CREDENTIALS_PATH);
            throw new Error('Archivo de credenciales de Google no encontrado. Configure google-credentials.json');
        }
        
        const credentials = JSON.parse(fs.readFileSync(CREDENTIALS_PATH, 'utf8'));
        console.log('✅ [PRESUPUESTOS] Credenciales cargadas exitosamente');
        
        return credentials;
    } catch (error) {
        console.error('❌ [PRESUPUESTOS] Error al cargar credenciales:', error.message);
        throw error;
    }
}

/**
 * Crear cliente OAuth2
 */
function createOAuth2Client(credentials) {
    console.log('🔍 [PRESUPUESTOS] Creando cliente OAuth2...');
    
    try {
        const { client_secret, client_id, redirect_uris } = credentials.installed || credentials.web;
        
        const oAuth2Client = new google.auth.OAuth2(
            client_id,
            client_secret,
            redirect_uris[0]
        );
        
        console.log('✅ [PRESUPUESTOS] Cliente OAuth2 creado exitosamente');
        return oAuth2Client;
    } catch (error) {
        console.error('❌ [PRESUPUESTOS] Error al crear cliente OAuth2:', error.message);
        throw error;
    }
}

/**
 * Cargar token guardado
 */
function loadSavedToken() {
    console.log('🔍 [PRESUPUESTOS] Verificando token guardado...');
    
    try {
        if (!fs.existsSync(TOKEN_PATH)) {
            console.log('⚠️ [PRESUPUESTOS] No se encontró token guardado');
            return null;
        }
        
        const token = JSON.parse(fs.readFileSync(TOKEN_PATH, 'utf8'));
        console.log('✅ [PRESUPUESTOS] Token cargado desde archivo');
        
        return token;
    } catch (error) {
        console.error('❌ [PRESUPUESTOS] Error al cargar token:', error.message);
        return null;
    }
}

/**
 * Guardar token para uso futuro
 */
function saveToken(token) {
    console.log('🔍 [PRESUPUESTOS] Guardando token...');
    
    try {
        // Crear directorio si no existe
        const tokenDir = path.dirname(TOKEN_PATH);
        if (!fs.existsSync(tokenDir)) {
            fs.mkdirSync(tokenDir, { recursive: true });
        }
        
        fs.writeFileSync(TOKEN_PATH, JSON.stringify(token, null, 2));
        console.log('✅ [PRESUPUESTOS] Token guardado exitosamente');
    } catch (error) {
        console.error('❌ [PRESUPUESTOS] Error al guardar token:', error.message);
        throw error;
    }
}

/**
 * Generar URL de autorización
 */
function generateAuthUrl(oAuth2Client) {
    console.log('🔍 [PRESUPUESTOS] Generando URL de autorización...');
    
    const authUrl = oAuth2Client.generateAuthUrl({
        access_type: 'offline',
        scope: SCOPES,
        prompt: 'consent'
    });
    
    console.log('✅ [PRESUPUESTOS] URL de autorización generada');
    console.log('🔗 [PRESUPUESTOS] URL:', authUrl);
    
    return authUrl;
}

/**
 * Obtener token desde código de autorización
 */
async function getTokenFromCode(oAuth2Client, code) {
    console.log('🔍 [PRESUPUESTOS] Obteniendo token desde código de autorización...');
    
    try {
        const { tokens } = await oAuth2Client.getToken(code);
        console.log('✅ [PRESUPUESTOS] Token obtenido exitosamente');
        
        // Guardar token para uso futuro
        saveToken(tokens);
        
        return tokens;
    } catch (error) {
        console.error('❌ [PRESUPUESTOS] Error al obtener token:', error.message);
        throw error;
    }
}

/**
 * Verificar si el token es válido
 */
async function isTokenValid(oAuth2Client) {
    console.log('🔍 [PRESUPUESTOS] Verificando validez del token...');
    
    try {
        const tokenInfo = await oAuth2Client.getTokenInfo(oAuth2Client.credentials.access_token);
        const isValid = tokenInfo.expiry_date > Date.now();
        
        console.log(`${isValid ? '✅' : '⚠️'} [PRESUPUESTOS] Token ${isValid ? 'válido' : 'expirado'}`);
        
        return isValid;
    } catch (error) {
        console.error('❌ [PRESUPUESTOS] Error al verificar token:', error.message);
        return false;
    }
}

/**
 * Refrescar token si es necesario
 */
async function refreshTokenIfNeeded(oAuth2Client) {
    console.log('🔍 [PRESUPUESTOS] Verificando si es necesario refrescar token...');
    
    try {
        if (!oAuth2Client.credentials.refresh_token) {
            console.log('⚠️ [PRESUPUESTOS] No hay refresh token disponible');
            return false;
        }
        
        const isValid = await isTokenValid(oAuth2Client);
        
        if (!isValid) {
            console.log('🔄 [PRESUPUESTOS] Refrescando token...');
            
            const { credentials } = await oAuth2Client.refreshAccessToken();
            oAuth2Client.setCredentials(credentials);
            
            // Guardar nuevo token
            saveToken(credentials);
            
            console.log('✅ [PRESUPUESTOS] Token refrescado exitosamente');
        }
        
        return true;
    } catch (error) {
        console.error('❌ [PRESUPUESTOS] Error al refrescar token:', error.message);
        return false;
    }
}

/**
 * Obtener cliente autenticado
 */
async function getAuthenticatedClient() {
    console.log('🔍 [PRESUPUESTOS] Obteniendo cliente autenticado...');
    
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
            console.log('🔍 [PRESUPUESTOS] Usando token guardado...');
            console.log('🔍 [GSHEETS-DEBUG] Token encontrado - expiry_date:', savedToken.expiry_date);
            console.log('🔍 [GSHEETS-DEBUG] Token access_token:', savedToken.access_token ? 'PRESENTE' : 'AUSENTE');
            console.log('🔍 [GSHEETS-DEBUG] Token refresh_token:', savedToken.refresh_token ? 'PRESENTE' : 'AUSENTE');
            
            oAuth2Client.setCredentials(savedToken);
            
            // Verificar y refrescar si es necesario
            console.log('🔍 [GSHEETS-DEBUG] Verificando validez del token...');
            const refreshed = await refreshTokenIfNeeded(oAuth2Client);
            
            if (refreshed) {
                console.log('✅ [PRESUPUESTOS] Cliente autenticado exitosamente');
                console.log('🔍 [GSHEETS-DEBUG] ✅ AUTENTICACIÓN EXITOSA - Cliente listo para usar');
                return oAuth2Client;
            } else {
                console.log('🔍 [GSHEETS-DEBUG] ❌ FALLO EN REFRESH DEL TOKEN');
            }
        } else {
            console.log('🔍 [GSHEETS-DEBUG] ❌ NO SE ENCONTRÓ TOKEN GUARDADO');
        }
        
        // Si no hay token válido, generar URL de autorización
        console.log('⚠️ [PRESUPUESTOS] Se requiere autorización manual');
        console.log('🔍 [GSHEETS-DEBUG] ❌ REQUIERE AUTORIZACIÓN MANUAL');
        const authUrl = generateAuthUrl(oAuth2Client);
        console.log('🔍 [GSHEETS-DEBUG] URL de autorización generada:', authUrl);
        
        throw new Error(`Autorización requerida. Visite: ${authUrl}`);
        
    } catch (error) {
        console.error('❌ [PRESUPUESTOS] Error al obtener cliente autenticado:', error.message);
        console.log('🔍 [GSHEETS-DEBUG] ❌ ERROR EN AUTENTICACIÓN:', error.message);
        throw error;
    }
}

/**
 * Verificar estado de autenticación
 */
async function checkAuthStatus() {
    console.log('🔍 [PRESUPUESTOS] Verificando estado de autenticación...');
    
    try {
        const client = await getAuthenticatedClient();
        
        return {
            authenticated: true,
            hasValidToken: true,
            tokenExpiry: client.credentials.expiry_date,
            scopes: SCOPES
        };
    } catch (error) {
        console.log('⚠️ [PRESUPUESTOS] No autenticado:', error.message);
        
        return {
            authenticated: false,
            hasValidToken: false,
            error: error.message,
            authUrl: error.message.includes('Visite:') ? 
                error.message.split('Visite: ')[1] : null
        };
    }
}

console.log('✅ [PRESUPUESTOS] Servicio de autenticación Google configurado');

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
