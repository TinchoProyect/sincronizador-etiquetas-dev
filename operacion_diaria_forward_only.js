/**
 * PROMPT 2 — Operación diaria (solo lo nuevo, sin backfill)
 * Uso diario al presionar el botón; asegura que todo alta nueva entra bien y rápido
 */

require('dotenv').config();

const { pool } = require('./src/presupuestos/config/database');
const { forwardOnlyState } = require('./src/services/gsheets/forward_only_state');
const { runForwardOnlySync } = require('./src/services/gsheets/forward_only_sync');

async function operacionDiaria() {
    console.log('🔍 [OPERACION-DIARIA] === SINCRONIZACIÓN DIARIA FORWARD-ONLY ===\n');
    
    try {
        // Verificar que Forward-Only está activado
        await forwardOnlyState.loadConfig();
        const config = forwardOnlyState.getConfig();
        
        if (!config.FORWARD_ONLY_MODE) {
            console.log('❌ [OPERACION-DIARIA] Forward-Only no está activado');
            console.log('💡 [OPERACION-DIARIA] Ejecutar: node activar_forward_only.js');
            return;
        }
        
        console.log('[OPERACION-DIARIA] Configuración actual:');
        console.log(`CUTOFF_AT: ${config.CUTOFF_AT}`);
        console.log(`LAST_SEEN_LOCAL_ID: ${config.LAST_SEEN_LOCAL_ID}`);
        console.log(`LAST_SEEN_SHEET_ROW: ${config.LAST_SEEN_SHEET_ROW}`);
        
        // Configuración de Sheets
        const sheetsConfig = {
            hoja_id: process.env.SPREADSHEET_ID || '1r7VEnEArREqAGZiDxQCW4A0XIKb8qaxHXD0TlVhfuf8'
        };
        
        console.log('\n[OPERACION-DIARIA] Ejecutando sincronización diaria...');
        console.log('[OPERACION-DIARIA] Flujo:');
        console.log('  1) Local→Sheet: id > LAST_SEEN_LOCAL_ID OR fecha >= CUTOFF_AT');
        console.log('  2) Sheet→Local: _rowIndex > LAST_SEEN_SHEET_ROW OR LastModified >= CUTOFF_AT');
        console.log('  3) Normalización: Articulo = texto trim; Cantidad = número con 2 decimales');
        console.log('  4) MAP inmediato al insertar (fuente=Local/AppSheet)');
        console.log('  5) LWW con timestamps para conflictos');
        
        // Ejecutar sincronización Forward-Only
        const correlationId = 'DIARIA-' + new Date().toISOString().slice(0, 10);
        const resultado = await runForwardOnlySync(sheetsConfig, pool, correlationId);
        
        // Salida obligatoria (exacta)
        console.log('\n📊 [OPERACION-DIARIA] === SALIDA OBLIGATORIA ===');
        console.log(`Solo desde corte (forward-only): ${resultado.soloDesdeCorte ? '✅' : '❌'}`);
        console.log(`0 duplicados nuevos: ${resultado.ceroDuplicadosNuevos ? '✅' : '❌'}`);
        console.log(`MAP creados: ${resultado.mapCreados.Local} (Local) / ${resultado.mapCreados.AppSheet} (AppSheet)`);
        console.log(`LWW aplicado (nuevos): ${resultado.lwwAplicado.exito ? '✅' : '❌'} (${resultado.lwwAplicado.casos} casos)`);
        console.log(`Tiempo acorde: ${resultado.tiempoAcorde ? '✅' : '❌'}`);
        
        if (resultado.corridaParcial) {
            console.log('Corrida parcial (sin actualizar marcadores): ✅');
        }
        
        // Información adicional
        console.log('\n📋 [OPERACION-DIARIA] === INFORMACIÓN ADICIONAL ===');
        console.log(`Tiempo de ejecución: ${resultado.tiempoEjecucion}ms`);
        console.log(`Errores: ${resultado.errores.length}`);
        
        if (resultado.errores.length > 0) {
            console.log('Errores encontrados:');
            resultado.errores.forEach(error => console.log(`  - ${error}`));
        }
        
        // Verificar marcadores actualizados (solo si corrida exitosa)
        if (resultado.exito && !resultado.corridaParcial) {
            await forwardOnlyState.loadConfig();
            const configActualizada = forwardOnlyState.getConfig();
            
            console.log('\n📊 [OPERACION-DIARIA] Marcadores actualizados:');
            console.log(`LAST_SEEN_LOCAL_ID: ${config.LAST_SEEN_LOCAL_ID} → ${configActualizada.LAST_SEEN_LOCAL_ID}`);
            console.log(`LAST_SEEN_SHEET_ROW: ${config.LAST_SEEN_SHEET_ROW} → ${configActualizada.LAST_SEEN_SHEET_ROW}`);
        }
        
        // Resumen final
        if (resultado.exito) {
            console.log('\n✅ [OPERACION-DIARIA] Sincronización diaria completada exitosamente');
            console.log('✅ [OPERACION-DIARIA] Solo se procesaron datos nuevos desde el corte');
            console.log('✅ [OPERACION-DIARIA] No se tocaron históricos consolidados');
        } else {
            console.log('\n⚠️ [OPERACION-DIARIA] Sincronización completada con errores');
            console.log('⚠️ [OPERACION-DIARIA] Revisar logs para detalles');
        }
        
        return resultado.exito;
        
    } catch (error) {
        console.error('❌ [OPERACION-DIARIA] Error:', error.message);
        console.error('Stack:', error.stack);
        return false;
    } finally {
        try {
            await pool.end();
        } catch (e) {
            console.log('Pool ya cerrado');
        }
    }
}

// Ejecutar si se llama directamente
if (require.main === module) {
    operacionDiaria();
}

module.exports = {
    operacionDiaria
};
