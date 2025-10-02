/**
 * SOLUCIÓN INTEGRAL PARA SINCRONIZACIÓN DE DETALLES
 * 
 * PROBLEMA IDENTIFICADO:
 * - Los encabezados SÍ llegan a Sheets
 * - Los detalles NO llegan porque confirmedIds no incluye IDs existentes
 * - Solo incluye IDs nuevos insertados, no los que ya existían
 * 
 * SOLUCIÓN:
 * - Modificar pushCambiosLocalesConTimestamp para incluir TODOS los IDs válidos
 * - Mejorar logs según especificaciones del usuario
 * - Mantener integridad del sistema
 */

const fs = require('fs');
const path = require('path');

// Ruta del archivo a modificar
const CONTROLLER_PATH = path.join(__dirname, 'src/presupuestos/controllers/sync_fechas_fix.js');
const SERVICE_PATH = path.join(__dirname, 'src/services/gsheets/sync_fechas_fix.js');

async function aplicarSolucionIntegral() {
    console.log('🔧 [FIX-INTEGRAL] Iniciando solución integral para sincronización de detalles...');
    
    try {
        // 1. BACKUP de archivos originales
        console.log('📋 [FIX-INTEGRAL] Creando backup de archivos...');
        
        const controllerBackup = CONTROLLER_PATH + '.backup.' + Date.now();
        const serviceBackup = SERVICE_PATH + '.backup.' + Date.now();
        
        fs.copyFileSync(CONTROLLER_PATH, controllerBackup);
        fs.copyFileSync(SERVICE_PATH, serviceBackup);
        
        console.log('✅ [FIX-INTEGRAL] Backup creado:', {
            controller: controllerBackup,
            service: serviceBackup
        });
        
        // 2. LEER archivos actuales
        let controllerContent = fs.readFileSync(CONTROLLER_PATH, 'utf8');
        let serviceContent = fs.readFileSync(SERVICE_PATH, 'utf8');
        
        // 3. APLICAR FIX AL CONTROLADOR - pushCambiosLocalesConTimestamp
        console.log('🔧 [FIX-INTEGRAL] Aplicando fix al controlador...');
        
        // Fix 1: Mejorar logs de encabezados
        const logFix = `
    // ✅ FIX CRÍTICO: Retornar TODOS los IDs confirmados (nuevos + existentes + actualizados)
    const allConfirmedIds = new Set([
      ...Array.from(updatedIds),
      ...Array.from(insertedIds)
    ]);
    
    // Logs claros como solicitó el usuario
    Array.from(updatedIds).forEach(id => console.log('[PUSH-HEAD] UPDATE-OK: %s', id));
    Array.from(insertedIds).forEach(id => console.log('[PUSH-HEAD] INSERT-OK: %s', id));
    
    // Agregar IDs existentes que pasaron el filtro cutoff_at pero no se insertaron
    const existingValidIds = new Set();
    for (const r of rs.rows) {
      const id = String(r.id || '').trim();
      if (id && existingHeaderIds.has(id) && !insertedIds.has(id) && !updatedIds.has(id)) {
        existingValidIds.add(id);
        allConfirmedIds.add(id);
      }
    }
    
    Array.from(existingValidIds).forEach(id => console.log('[PUSH-HEAD] skip por existente: %s', id));
    
    console.log('[PUSH-HEAD] ✅ Total confirmados: %d (updates=%d + inserts=%d + existentes=%d)', 
                allConfirmedIds.size, updatedIds.size, insertedIds.size, existingValidIds.size);
    
    // Retornar TODOS los IDs confirmados para sincronizar detalles
    return allConfirmedIds;`;
        
        // Buscar y reemplazar el return final de pushCambiosLocalesConTimestamp
        const returnPattern = /console\.log\('\[PUSH-HEAD\] done'[\s\S]*?return confirmedIds;/;
        
        if (returnPattern.test(controllerContent)) {
            controllerContent = controllerContent.replace(returnPattern, 
                `console.log('[PUSH-HEAD] done', {
      updated: updatedIds.size,
      inserted: insertedIds.size,
      confirmed: allConfirmedIds.size
    });
    
    ${logFix}`);
            
            console.log('✅ [FIX-INTEGRAL] Fix aplicado al controlador - pushCambiosLocalesConTimestamp');
        } else {
            console.warn('⚠️ [FIX-INTEGRAL] No se encontró el patrón de return en pushCambiosLocalesConTimestamp');
        }
        
        // 4. APLICAR FIX AL SERVICIO - pushDetallesLocalesASheets
        console.log('🔧 [FIX-INTEGRAL] Aplicando fix al servicio...');
        
        // Fix 2: Mejorar logs de detalles
        const detallesLogFix = `
    console.log('[PUSH-DET] detallesSeleccionados count=%d', rs.rows.length);
    
    if (rs.rowCount === 0) {
      console.log('[PUSH-DET] sin detalles locales para IDs: %o', ids);
      return;
    }`;
        
        // Buscar y reemplazar el log de detalles seleccionados
        const detallesPattern = /console\.log\('\[PUSH-DET\] detallesSeleccionados'[\s\S]*?if \(rs\.rows\.length === 0\) \{[\s\S]*?return;[\s\S]*?\}/;
        
        if (detallesPattern.test(serviceContent)) {
            serviceContent = serviceContent.replace(detallesPattern, detallesLogFix);
            console.log('✅ [FIX-INTEGRAL] Fix aplicado al servicio - logs de detalles');
        }
        
        // Fix 3: Mejorar log final de MAP upserts
        const mapLogPattern = /console\.log\(`\[PUSH-DET\] MAP upserts: \$\{mapCreados\}`\);/;
        
        if (mapLogPattern.test(serviceContent)) {
            serviceContent = serviceContent.replace(mapLogPattern, 
                `console.log('[PUSH-DET] MAP upserts: %d', mapCreados);`);
            console.log('✅ [FIX-INTEGRAL] Fix aplicado al servicio - log de MAP upserts');
        }
        
        // 5. ESCRIBIR archivos modificados
        console.log('💾 [FIX-INTEGRAL] Escribiendo archivos modificados...');
        
        fs.writeFileSync(CONTROLLER_PATH, controllerContent);
        fs.writeFileSync(SERVICE_PATH, serviceContent);
        
        console.log('✅ [FIX-INTEGRAL] Archivos modificados exitosamente');
        
        // 6. VALIDAR cambios
        console.log('🔍 [FIX-INTEGRAL] Validando cambios aplicados...');
        
        const newControllerContent = fs.readFileSync(CONTROLLER_PATH, 'utf8');
        const newServiceContent = fs.readFileSync(SERVICE_PATH, 'utf8');
        
        const hasControllerFix = newControllerContent.includes('allConfirmedIds') && 
                                newControllerContent.includes('PUSH-HEAD] UPDATE-OK:') &&
                                newControllerContent.includes('PUSH-HEAD] INSERT-OK:') &&
                                newControllerContent.includes('skip por existente:');
        
        const hasServiceFix = newServiceContent.includes('detallesSeleccionados count=') &&
                             newServiceContent.includes('sin detalles locales para IDs:') &&
                             newServiceContent.includes('MAP upserts: %d');
        
        if (hasControllerFix && hasServiceFix) {
            console.log('✅ [FIX-INTEGRAL] Validación exitosa - todos los fixes aplicados correctamente');
            
            // 7. RESUMEN DE CAMBIOS
            console.log('\n📋 [FIX-INTEGRAL] RESUMEN DE CAMBIOS APLICADOS:');
            console.log('');
            console.log('🔧 CONTROLADOR (sync_fechas_fix.js):');
            console.log('   ✅ pushCambiosLocalesConTimestamp ahora retorna TODOS los IDs confirmados');
            console.log('   ✅ Logs mejorados: [PUSH-HEAD] UPDATE-OK: <id>');
            console.log('   ✅ Logs mejorados: [PUSH-HEAD] INSERT-OK: <id>');
            console.log('   ✅ Logs mejorados: [PUSH-HEAD] skip por existente: <id>');
            console.log('   ✅ IDs existentes ahora se incluyen en confirmedIds');
            console.log('');
            console.log('🔧 SERVICIO (sync_fechas_fix.js):');
            console.log('   ✅ pushDetallesLocalesASheets con logs mejorados');
            console.log('   ✅ Log: [PUSH-DET] detallesSeleccionados count=<n>');
            console.log('   ✅ Log: [PUSH-DET] sin detalles locales para IDs: [...]');
            console.log('   ✅ Log: [PUSH-DET] MAP upserts: <n>');
            console.log('');
            console.log('🎯 RESULTADO ESPERADO:');
            console.log('   ✅ Los encabezados existentes ahora confirman sus detalles');
            console.log('   ✅ Los detalles se sincronizan correctamente a Sheets');
            console.log('   ✅ Se crean registros en presupuestos_detalles_map con fuente="Local"');
            console.log('   ✅ Logs claros y específicos según requerimientos');
            
            return {
                success: true,
                backups: {
                    controller: controllerBackup,
                    service: serviceBackup
                },
                changes: {
                    controller: hasControllerFix,
                    service: hasServiceFix
                }
            };
            
        } else {
            throw new Error('Validación falló - no todos los fixes se aplicaron correctamente');
        }
        
    } catch (error) {
        console.error('❌ [FIX-INTEGRAL] Error aplicando solución:', error.message);
        
        // Restaurar backups en caso de error
        try {
            if (fs.existsSync(controllerBackup)) {
                fs.copyFileSync(controllerBackup, CONTROLLER_PATH);
                console.log('🔄 [FIX-INTEGRAL] Backup del controlador restaurado');
            }
            if (fs.existsSync(serviceBackup)) {
                fs.copyFileSync(serviceBackup, SERVICE_PATH);
                console.log('🔄 [FIX-INTEGRAL] Backup del servicio restaurado');
            }
        } catch (restoreError) {
            console.error('❌ [FIX-INTEGRAL] Error restaurando backups:', restoreError.message);
        }
        
        return {
            success: false,
            error: error.message
        };
    }
}

// Ejecutar si se llama directamente
if (require.main === module) {
    aplicarSolucionIntegral()
        .then(result => {
            if (result.success) {
                console.log('\n🎉 [FIX-INTEGRAL] SOLUCIÓN APLICADA EXITOSAMENTE');
                console.log('');
                console.log('📝 PRÓXIMOS PASOS:');
                console.log('1. Reiniciar el servidor de presupuestos');
                console.log('2. Probar sincronización con un presupuesto nuevo con 2 detalles');
                console.log('3. Verificar logs esperados en consola');
                console.log('4. Confirmar que aparecen encabezado + detalles en Sheets');
                console.log('5. Verificar registros en presupuestos_detalles_map');
            } else {
                console.log('\n❌ [FIX-INTEGRAL] SOLUCIÓN FALLÓ');
                console.log('Error:', result.error);
            }
        })
        .catch(console.error);
}

module.exports = { aplicarSolucionIntegral };
