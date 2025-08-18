/**
 * ACTIVACIÓN DIRECTA DEL MOTOR
 * Escribe las variables directamente al .env y reinicia el servidor
 */

console.log('🔧 [ACTIVAR_MOTOR] Activando motor directamente...');

const fs = require('fs');
const path = require('path');

try {
    // 1. Escribir variables al .env
    console.log('\n1️⃣ [ACTIVAR_MOTOR] Escribiendo variables al .env...');
    
    const envPath = path.join(__dirname, '.env');
    let envContent = '';
    
    if (fs.existsSync(envPath)) {
        envContent = fs.readFileSync(envPath, 'utf8');
        console.log('📄 [ACTIVAR_MOTOR] Archivo .env existente encontrado');
    } else {
        console.log('📄 [ACTIVAR_MOTOR] Creando nuevo archivo .env');
    }
    
    // Actualizar o agregar SYNC_ENGINE_ENABLED
    if (envContent.includes('SYNC_ENGINE_ENABLED=')) {
        envContent = envContent.replace(/SYNC_ENGINE_ENABLED=.*/g, 'SYNC_ENGINE_ENABLED=true');
        console.log('✅ [ACTIVAR_MOTOR] SYNC_ENGINE_ENABLED actualizado a true');
    } else {
        envContent += '\nSYNC_ENGINE_ENABLED=true';
        console.log('✅ [ACTIVAR_MOTOR] SYNC_ENGINE_ENABLED agregado como true');
    }
    
    // Actualizar o agregar AUTO_SYNC_ENABLED
    if (envContent.includes('AUTO_SYNC_ENABLED=')) {
        envContent = envContent.replace(/AUTO_SYNC_ENABLED=.*/g, 'AUTO_SYNC_ENABLED=true');
        console.log('✅ [ACTIVAR_MOTOR] AUTO_SYNC_ENABLED actualizado a true');
    } else {
        envContent += '\nAUTO_SYNC_ENABLED=true';
        console.log('✅ [ACTIVAR_MOTOR] AUTO_SYNC_ENABLED agregado como true');
    }
    
    // Escribir archivo
    fs.writeFileSync(envPath, envContent);
    console.log('✅ [ACTIVAR_MOTOR] Variables guardadas en .env');
    
    // 2. Mostrar contenido del .env
    console.log('\n2️⃣ [ACTIVAR_MOTOR] Contenido actualizado del .env:');
    console.log('─'.repeat(50));
    console.log(envContent);
    console.log('─'.repeat(50));
    
    // 3. Activar variables en el proceso actual
    console.log('\n3️⃣ [ACTIVAR_MOTOR] Activando variables en el proceso actual...');
    process.env.SYNC_ENGINE_ENABLED = 'true';
    process.env.AUTO_SYNC_ENABLED = 'true';
    
    console.log('✅ [ACTIVAR_MOTOR] Variables activadas:', {
        SYNC_ENGINE_ENABLED: process.env.SYNC_ENGINE_ENABLED,
        AUTO_SYNC_ENABLED: process.env.AUTO_SYNC_ENABLED
    });
    
    // 4. Instrucciones
    console.log('\n4️⃣ [ACTIVAR_MOTOR] === INSTRUCCIONES ===');
    console.log('🔄 [ACTIVAR_MOTOR] REINICIA EL SERVIDOR para que tome las nuevas variables:');
    console.log('   1. Presiona Ctrl+C en el terminal del servidor');
    console.log('   2. Ejecuta: .\\iniciar_servidor_presupuestos.bat');
    console.log('');
    console.log('✅ [ACTIVAR_MOTOR] Después del reinicio, el motor debería funcionar automáticamente');
    console.log('🔍 [ACTIVAR_MOTOR] Busca en los logs: [SYNC] ✅ Motor de sincronización habilitado');
    
    console.log('\n🎯 [ACTIVAR_MOTOR] Activación directa completada exitosamente');
    
} catch (error) {
    console.error('❌ [ACTIVAR_MOTOR] Error:', error.message);
    process.exit(1);
}
