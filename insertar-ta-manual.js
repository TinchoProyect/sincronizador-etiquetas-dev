/**
 * Script para insertar TA obtenido manualmente en la BD
 * Ejecutar: node insertar-ta-manual.js
 */

const { Pool } = require('pg');

// Configuración de BD
const pool = new Pool({
    user: 'postgres',
    host: 'localhost',
    database: 'etiquetas',
    password: 'ta3Mionga',
    port: 5432,
});

// ⚠️ PEGAR AQUÍ LOS VALORES OBTENIDOS DEL SCRIPT POWERSHELL
const TOKEN = 'PD94bWwgdmVyc2lvbj0iMS4wIiBlbmNvZGluZz0iVVRGLTgiIH...'; // Token completo
const SIGN = 'RvyQwqHFiHf0rdklphCbKElX8KXmBaHon1x9osM/rw2Rgbpeem...'; // Sign completo
const EXPIRA = '2025-10-16T08:11:56.202-03:00'; // Fecha de expiración

async function insertarTA() {
    console.log('🔄 Insertando TA en la base de datos...\n');
    
    try {
        // Verificar que los valores estén completos
        if (TOKEN.includes('...') || SIGN.includes('...')) {
            console.error('❌ ERROR: Debes reemplazar TOKEN y SIGN con los valores completos');
            console.error('❌ Ejecuta en PowerShell:');
            console.error('   $token');
            console.error('   $sign');
            console.error('   $exp');
            console.error('\nY copia los valores completos en este script.\n');
            process.exit(1);
        }
        
        console.log('📋 Datos a insertar:');
        console.log(`   Entorno: HOMO`);
        console.log(`   Servicio: wsfe`);
        console.log(`   Expira: ${EXPIRA}`);
        console.log(`   Token (primeros 50): ${TOKEN.substring(0, 50)}...`);
        console.log(`   Sign (primeros 50): ${SIGN.substring(0, 50)}...`);
        console.log('');
        
        // UPSERT del TA
        const query = `
            INSERT INTO factura_afip_ta (entorno, servicio, token, sign, expira_en, creado_en)
            VALUES ($1, $2, $3, $4, $5, NOW())
            ON CONFLICT (entorno, servicio)
            DO UPDATE SET
                token = EXCLUDED.token,
                sign = EXCLUDED.sign,
                expira_en = EXCLUDED.expira_en,
                creado_en = NOW()
            RETURNING *
        `;
        
        const valores = ['HOMO', 'wsfe', TOKEN, SIGN, EXPIRA];
        
        console.log('💾 Ejecutando UPSERT...');
        const resultado = await pool.query(query, valores);
        
        console.log('✅ TA insertado exitosamente!\n');
        console.log('📊 Registro guardado:');
        console.log(`   ID: ${resultado.rows[0].id}`);
        console.log(`   Entorno: ${resultado.rows[0].entorno}`);
        console.log(`   Servicio: ${resultado.rows[0].servicio}`);
        console.log(`   Expira: ${resultado.rows[0].expira_en}`);
        console.log(`   Creado: ${resultado.rows[0].creado_en}`);
        console.log('');
        
        // Verificar que esté vigente
        const ahora = new Date();
        const expira = new Date(resultado.rows[0].expira_en);
        const vigente = expira > ahora;
        
        if (vigente) {
            const minutosRestantes = Math.floor((expira - ahora) / 1000 / 60);
            console.log(`✅ TA VIGENTE (expira en ${minutosRestantes} minutos)`);
        } else {
            console.log('⚠️ TA EXPIRADO - Necesitas obtener uno nuevo');
        }
        
        console.log('\n🎉 Ahora puedes usar el botón "Renovar TA" en la UI');
        console.log('   O emitir facturas directamente\n');
        
    } catch (error) {
        console.error('❌ Error insertando TA:', error.message);
        console.error('Stack:', error.stack);
    } finally {
        await pool.end();
    }
}

// Ejecutar
insertarTA();
