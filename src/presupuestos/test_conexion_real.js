console.log('🚀 [TEST] Iniciando test de conexión real con Google Sheets...');

const { google } = require('googleapis');
const fs = require('fs');
const path = require('path');

async function testConexionReal() {
    try {
        console.log('📋 [TEST] Cargando credenciales...');
        
        // Cargar credenciales
        const credentialsPath = path.join(__dirname, '../config/google-credentials.json');
        const tokenPath = path.join(__dirname, '../config/google-token.json');
        
        const credentials = JSON.parse(fs.readFileSync(credentialsPath, 'utf8'));
        const token = JSON.parse(fs.readFileSync(tokenPath, 'utf8'));
        
        console.log('✅ [TEST] Credenciales cargadas correctamente');
        
        // Configurar OAuth2
        const { client_secret, client_id, redirect_uris } = credentials.installed;
        const oAuth2Client = new google.auth.OAuth2(client_id, client_secret, redirect_uris[0]);
        
        // Establecer credenciales
        oAuth2Client.setCredentials(token);
        
        console.log('✅ [TEST] Cliente OAuth2 configurado');
        
        // Crear cliente de Google Sheets
        const sheets = google.sheets({ version: 'v4', auth: oAuth2Client });
        
        console.log('✅ [TEST] Cliente Google Sheets creado');
        
        // ID del archivo PresupuestosCopia (extraído de las imágenes)
        const spreadsheetId = '1r7VEnEArREqAGZiDxQCW4A0XIKb8qaxHXD0TlVhfuf8';
        
        console.log('🔍 [TEST] Probando acceso al archivo PresupuestosCopia...');
        console.log('📊 [TEST] ID del archivo:', spreadsheetId);
        
        // Obtener información del archivo
        const spreadsheetInfo = await sheets.spreadsheets.get({
            spreadsheetId: spreadsheetId
        });
        
        console.log('✅ [TEST] ¡CONEXIÓN EXITOSA!');
        console.log('📊 [TEST] Título del archivo:', spreadsheetInfo.data.properties.title);
        console.log('📊 [TEST] Hojas disponibles:');
        
        spreadsheetInfo.data.sheets.forEach((sheet, index) => {
            console.log(`   ${index + 1}. ${sheet.properties.title} (${sheet.properties.gridProperties.rowCount} filas x ${sheet.properties.gridProperties.columnCount} columnas)`);
        });
        
        // Probar lectura de datos de la hoja "Presupuestos"
        console.log('\n📖 [TEST] Probando lectura de datos de la hoja "Presupuestos"...');
        
        const presupuestosData = await sheets.spreadsheets.values.get({
            spreadsheetId: spreadsheetId,
            range: 'Presupuestos!A1:M10' // Primeras 10 filas con todas las columnas visibles
        });
        
        if (presupuestosData.data.values && presupuestosData.data.values.length > 0) {
            console.log('✅ [TEST] Datos de Presupuestos leídos correctamente');
            console.log('📊 [TEST] Encabezados:', presupuestosData.data.values[0]);
            console.log('📊 [TEST] Total filas leídas:', presupuestosData.data.values.length);
            console.log('📊 [TEST] Ejemplo de primera fila de datos:', presupuestosData.data.values[1]);
        }
        
        // Probar lectura de datos de la hoja "DetallesPresupuestos"
        console.log('\n📖 [TEST] Probando lectura de datos de la hoja "DetallesPresupuestos"...');
        
        const detallesData = await sheets.spreadsheets.values.get({
            spreadsheetId: spreadsheetId,
            range: 'DetallesPresupuestos!A1:P10' // Primeras 10 filas con todas las columnas visibles
        });
        
        if (detallesData.data.values && detallesData.data.values.length > 0) {
            console.log('✅ [TEST] Datos de DetallesPresupuestos leídos correctamente');
            console.log('📊 [TEST] Encabezados:', detallesData.data.values[0]);
            console.log('📊 [TEST] Total filas leídas:', detallesData.data.values.length);
            console.log('📊 [TEST] Ejemplo de primera fila de datos:', detallesData.data.values[1]);
        }
        
        console.log('\n🎉 [TEST] ===== TEST COMPLETADO EXITOSAMENTE =====');
        console.log('✅ [TEST] La conexión con Google Sheets está funcionando perfectamente');
        console.log('✅ [TEST] Se puede acceder al archivo PresupuestosCopia');
        console.log('✅ [TEST] Se pueden leer datos de ambas hojas');
        
        return {
            success: true,
            spreadsheetTitle: spreadsheetInfo.data.properties.title,
            sheets: spreadsheetInfo.data.sheets.map(s => s.properties.title),
            presupuestosRows: presupuestosData.data.values?.length || 0,
            detallesRows: detallesData.data.values?.length || 0
        };
        
    } catch (error) {
        console.error('❌ [TEST] Error en el test de conexión:', error.message);
        console.error('📊 [TEST] Código de error:', error.code);
        console.error('📊 [TEST] Stack trace:', error.stack);
        
        return {
            success: false,
            error: error.message,
            code: error.code
        };
    }
}

// Ejecutar test
if (require.main === module) {
    testConexionReal().then(result => {
        if (result.success) {
            console.log('\n🏆 [TEST] TEST EXITOSO - La conexión funciona correctamente');
            process.exit(0);
        } else {
            console.log('\n💥 [TEST] TEST FALLIDO - Hay problemas de conexión');
            process.exit(1);
        }
    });
}

module.exports = { testConexionReal };
