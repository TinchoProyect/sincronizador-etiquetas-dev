/**
 * Script de verificación final para confirmar que la implementación
 * de completado de campos funciona correctamente
 */

const { Pool } = require('pg');

// Configuración de base de datos (misma que el proyecto)
const dbConfig = {
    user: 'postgres',
    host: 'localhost',
    database: 'etiquetas',
    password: 'ta3Mionga',
    port: 5432,
};

async function verificarImplementacionFinal() {
    const db = new Pool(dbConfig);
    
    try {
        console.log('🔍 [VERIFICACIÓN] ===== VERIFICANDO IMPLEMENTACIÓN FINAL =====');
        
        // 1. Verificar configuración activa
        console.log('\n1. Verificando configuración activa...');
        const configQuery = `
            SELECT id, hoja_url, activo, usuario_id
            FROM presupuestos_config
            WHERE activo = true
            ORDER BY id DESC
            LIMIT 1
        `;
        const configResult = await db.query(configQuery);
        
        if (configResult.rows.length === 0) {
            console.log('❌ No se encontró configuración activa');
            return;
        }
        
        const config = configResult.rows[0];
        console.log('✅ Configuración activa encontrada:', {
            id: config.id,
            hoja_url: config.hoja_url,
            usuario_id: config.usuario_id
        });
        
        // 2. Verificar presupuestos recientes (últimos 5 minutos)
        console.log('\n2. Verificando presupuestos recientes...');
        const presupuestosRecientesQuery = `
            SELECT id, id_presupuesto_ext, hoja_url, usuario_id, fecha_actualizacion
            FROM presupuestos
            WHERE fecha_actualizacion >= NOW() - INTERVAL '5 minutes'
            ORDER BY fecha_actualizacion DESC
            LIMIT 10
        `;
        const presupuestosRecientesResult = await db.query(presupuestosRecientesQuery);
        
        console.log(`📊 Presupuestos recientes (últimos 5 min): ${presupuestosRecientesResult.rows.length}`);
        
        if (presupuestosRecientesResult.rows.length > 0) {
            console.log('Presupuestos recientes:');
            presupuestosRecientesResult.rows.forEach((row, i) => {
                const hojaUrlStatus = row.hoja_url ? 'COMPLETADO' : 'NULL';
                const usuarioIdStatus = row.usuario_id ? `${row.usuario_id}` : 'NULL';
                console.log(`   ${i + 1}. ID: ${row.id}, Ext: ${row.id_presupuesto_ext}`);
                console.log(`      hoja_url: ${hojaUrlStatus}, usuario_id: ${usuarioIdStatus}`);
                console.log(`      fecha_actualizacion: ${row.fecha_actualizacion}`);
            });
            
            // 3. Verificar que los campos están correctamente completados
            const camposIncompletos = presupuestosRecientesResult.rows.filter(row => 
                !row.hoja_url || !row.usuario_id
            );
            
            if (camposIncompletos.length === 0) {
                console.log('\n✅ ÉXITO: Todos los presupuestos recientes tienen campos completados');
            } else {
                console.log(`\n⚠️ ADVERTENCIA: ${camposIncompletos.length} presupuestos recientes con campos incompletos:`);
                camposIncompletos.forEach((row, i) => {
                    console.log(`   ${i + 1}. ID: ${row.id}, hoja_url: ${row.hoja_url || 'NULL'}, usuario_id: ${row.usuario_id || 'NULL'}`);
                });
            }
        } else {
            console.log('⚠️ No hay presupuestos recientes para verificar');
            console.log('💡 Sugerencia: Crear un presupuesto local y ejecutar sincronización manual para probar');
        }
        
        // 4. Verificar que la URL de configuración coincide
        if (presupuestosRecientesResult.rows.length > 0) {
            const presupuestosConUrl = presupuestosRecientesResult.rows.filter(row => row.hoja_url);
            if (presupuestosConUrl.length > 0) {
                const urlEsperada = config.hoja_url;
                const urlEncontrada = presupuestosConUrl[0].hoja_url;
                
                if (urlEsperada === urlEncontrada) {
                    console.log('\n✅ URL de configuración coincide correctamente');
                } else {
                    console.log('\n❌ URL de configuración NO coincide:');
                    console.log(`   Esperada: ${urlEsperada}`);
                    console.log(`   Encontrada: ${urlEncontrada}`);
                }
            }
        }
        
        console.log('\n🏁 [VERIFICACIÓN] Verificación completada');
        
    } catch (error) {
        console.error('❌ Error en verificación:', error.message);
        console.error('Stack trace:', error.stack);
    } finally {
        await db.end();
    }
}

// Ejecutar verificación
verificarImplementacionFinal().catch(console.error);
