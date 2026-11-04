const { getAuthenticatedClient } = require('../src/services/gsheets/auth');
const { google } = require('googleapis');

async function testGmail() {
    console.log('🔄 Iniciando prueba de API de Gmail...');
    try {
        const auth = await getAuthenticatedClient();
        const gmail = google.gmail({ version: 'v1', auth });
        
        console.log('🔄 Solicitando perfil de usuario a Gmail API (users.getProfile)...');
        const res = await gmail.users.getProfile({
            userId: 'me'
        });
        
        console.log('✅ Conexión con Gmail exitosa!');
        console.log('Datos del perfil:', res.data);
    } catch (error) {
        console.error('❌ Error al comunicarse con la API de Gmail:', error.message);
        if (error.message.includes('insufficient_permissions') || error.message.includes('Insufficient Permission')) {
            console.log('⚠️ Diagnóstico: El token actual NO tiene permisos (scopes) para Gmail. Es necesario elevar los scopes y re-autorizar.');
        }
    }
}

testGmail();
