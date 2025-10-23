/**
 * Script para insertar TA en la base de datos
 * Ejecutar: node insertar-ta-desde-valores.js
 */

const { Pool } = require('pg');

// Configuración de la base de datos
const pool = new Pool({
    user: 'postgres',
    host: 'localhost',
    database: 'etiquetas',
    password: 'ta3Mionga',
    port: 5432,
});

// VALORES DEL TA OBTENIDO CON POWERSHELL
// Reemplaza estos valores con los que obtuviste:
const TOKEN = 'PEGAR_TOKEN_AQUI';
const SIGN = 'PEGAR_SIGN_AQUI';
const EXPIRA_EN = '2025-10-16T08:11:56.202-03:00'; // Formato: YYYY-MM-DDTHH:mm:ss.SSS-03:00

async function insertarTA() {
    console.log('🔄 Insertando TA en la base de datos...');
    console.log('');
    
    // Validar que se hayan reemplazado los valores
    if (TOKEN === 'PEGAR_TOKEN_AQUI' || SIGN === 'PEGAR_SIGN_AQUI') {
        console.error('❌ ERROR: Debes editar este archivo y reemplazar TOKEN y SIGN con los valores reales');
        console.error('');
        console.error('Abre el archivo: insertar-ta-desde-valores.js');
        console.error('Y reemplaza:');
        console.error('  - TOKEN: con el valor de $token de PowerShell');
        console.error('  - SIGN: con el valor de $sign de PowerShell');
        console.error('  - EXPIRA_EN: con el valor de $exp de PowerShell');
        process.exit(1);
    }
    
    try {
        const query = `
            INSERT INTO factura_afip_ta (entorno, servicio, token, sign, expira_en, creado_en)
            VALUES ($1, $2, $3, $4, $5::timestamptz, NOW())
            ON CONFLICT (entorno, servicio)
            DO UPDATE SET
                token = EXCLUDED.token,
                sign = EXCLUDED.sign,
                expira_en = EXCLUDED.expira_en,
                creado_en = NOW()
            RETURNING *;
        `;
        
        const result = await pool.query(query, ['HOMO', 'wsfe', TOKEN, SIGN, EXPIRA_EN]);
        
        console.log('✅ TA insertado exitosamente!');
        console.log('');
        console.log('📊 Datos guardados:');
        console.log('   Entorno:', result.rows[0].entorno);
        console.log('   Servicio:', result.rows[0].servicio);
        console.log('   Expira en:', result.rows[0].expira_en);
        console.log('   Token (primeros 50 chars):', result.rows[0].token.substring(0, 50) + '...');
        console.log('   Sign (primeros 20 chars):', result.rows[0].sign.substring(0, 20) + '...');
        console.log('');
        console.log('🎉 Próximos pasos:');
        console.log('   1. Ir a: http://localhost:3004/pages/afip-admin.html');
        console.log('   2. Hacer clic en "Renovar TA"');
        console.log('   3. Debería mostrar: "TA vigente (sin renovar)" en azul');
        console.log('');
        
    } catch (error) {
        console.error('❌ Error insertando TA:', error.message);
        console.error('');
        console.error('Detalles:', error);
    } finally {
        await pool.end();
    }
}

// Ejecutar
insertarTA();
