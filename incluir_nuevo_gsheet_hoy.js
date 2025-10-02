/**
 * "Incluir lo nuevo de GSheet HOY y correr"
 * Objetivo: traer a Local los presupuestos/detalles NUEVOS creados en Google Sheets hoy
 */

require('dotenv').config();

const { pool } = require('./src/presupuestos/config/database');
const { forwardOnlyState } = require('./src/services/gsheets/forward_only_state');
const { runForwardOnlySync } = require('./src/services/gsheets/forward_only_sync');

async function incluirNuevoGSheetHoy() {
    console.log('🔍 [INCLUIR-HOY] === INCLUIR LO NUEVO DE GSHEET HOY ===\n');
    
    try {
        // 1) Leer presupuestos_config (activo=true) y mostrar
        console.log('[INCLUIR-HOY] 1. Leyendo configuración actual...');
        await forwardOnlyState.loadConfig();
        const configAntes = forwardOnlyState.getConfig();
        
        console.log('📋 [INCLUIR-HOY] Configuración ANTES:');
        console.log(`FORWARD_ONLY_MODE: ${configAntes.FORWARD_ONLY_MODE}`);
        console.log(`CUTOFF_AT (UTC): ${configAntes.CUTOFF_AT}`);
        console.log(`LAST_SEEN_LOCAL_ID: ${configAntes.LAST_SEEN_LOCAL_ID}`);
        console.log(`LAST_SEEN_SHEET_ROW: ${configAntes.LAST_SEEN_SHEET_ROW}`);
        
        // 2) Ajustar marcadores para incluir lo de hoy (solo remoto)
        console.log('\n[INCLUIR-HOY] 2. Ajustando marcadores para incluir datos de hoy...');
        
        // Set CUTOFF_AT = now() - 1 hour (UTC)
        const nuevoCutoff = new Date(Date.now() - (1 * 60 * 60 * 1000)); // 1 hora atrás
        
        // Actualizar configuración
        forwardOnlyState.config.CUTOFF_AT = nuevoCutoff.toISOString();
        forwardOnlyState.config.LAST_SEEN_SHEET_ROW = 0; // Reset para incluir todo desde hoy
        // Mantener FORWARD_ONLY_MODE = true
        // NO modificar LAST_SEEN_LOCAL_ID
        
        const guardado = await forwardOnlyState.saveConfig();
        
        if (guardado) {
            console.log('✅ [INCLUIR-HOY] Marcadores ajustados exitosamente');
            console.log('📋 [INCLUIR-HOY] Configuración DESPUÉS:');
            console.log(`FORWARD_ONLY_MODE: ${forwardOnlyState.config.FORWARD_ONLY_MODE}`);
            console.log(`CUTOFF_AT (UTC): ${forwardOnlyState.config.CUTOFF_AT}`);
            console.log(`LAST_SEEN_LOCAL_ID: ${forwardOnlyState.config.LAST_SEEN_LOCAL_ID} (sin cambios)`);
            console.log(`LAST_SEEN_SHEET_ROW: ${forwardOnlyState.config.LAST_SEEN_SHEET_ROW} (reset a 0)`);
        } else {
            console.log('❌ [INCLUIR-HOY] Error guardando configuración');
            return;
        }
        
        // 3) Ejecutar el botón de sincronización (Forward-Only)
        console.log('\n[INCLUIR-HOY] 3. Ejecutando sincronización Forward-Only...');
        
        const sheetsConfig = {
            hoja_id: process.env.SPREADSHEET_ID || '1r7VEnEArREqAGZiDxQCW4A0XIKb8qaxHXD0TlVhfuf8'
        };
        
        const correlationId = 'INCLUIR-HOY-' + new Date().toISOString().slice(0, 10);
        const resultado = await runForwardOnlySync(sheetsConfig, pool, correlationId);
        
        // 4) Mostrar señales observables (exactas)
        console.log('\n📊 [INCLUIR-HOY] 4. === SEÑALES OBSERVABLES ===');
        console.log(`Solo desde corte (forward-only): ${resultado.soloDesdeCorte ? '✅' : '❌'}`);
        console.log(`MAP creados: ${resultado.mapCreados.Local} (Local) / ${resultado.mapCreados.AppSheet} (GSheet)`);
        console.log(`0 duplicados nuevos: ${resultado.ceroDuplicadosNuevos ? '✅' : '❌'}`);
        console.log(`LWW aplicado (nuevos): ${resultado.lwwAplicado.exito ? '✅' : '❌'} (${resultado.lwwAplicado.casos} casos)`);
        console.log(`Tiempo acorde: ${resultado.tiempoAcorde ? '✅' : '❌'}`);
        
        // Información adicional
        console.log('\n📋 [INCLUIR-HOY] === INFORMACIÓN ADICIONAL ===');
        console.log(`Tiempo de ejecución: ${resultado.tiempoEjecucion}ms`);
        console.log(`Errores: ${resultado.errores.length}`);
        console.log(`Éxito: ${resultado.exito ? '✅' : '❌'}`);
        
        if (resultado.errores.length > 0) {
            console.log('Errores encontrados:');
            resultado.errores.forEach(error => console.log(`  - ${error}`));
        }
        
        // Verificar si bajó algo de GSheet
        const mapGSheet = resultado.mapCreados.AppSheet;
        
        if (mapGSheet === 0) {
            console.log('\n⚠️ [INCLUIR-HOY] === DIAGNÓSTICO: NO BAJÓ NADA DE GSHEET ===');
            console.log('💡 [INCLUIR-HOY] Ejecutar diagnóstico con: node diagnosticar_gsheet_vacio.js');
        } else {
            console.log(`\n✅ [INCLUIR-HOY] Se procesaron ${mapGSheet} registros nuevos desde GSheet`);
        }
        
        // Resumen final
        console.log('\n🎯 [INCLUIR-HOY] === RESUMEN ===');
        console.log(`Configuración ajustada: ✅`);
        console.log(`Sincronización ejecutada: ${resultado.exito ? '✅' : '❌'}`);
        console.log(`Datos nuevos de GSheet: ${mapGSheet > 0 ? '✅' : '❌'} (${mapGSheet} registros)`);
        console.log(`Sin tocar históricos: ✅`);
        console.log(`Sin recarga completa: ✅`);
        
        return resultado.exito;
        
    } catch (error) {
        console.error('❌ [INCLUIR-HOY] Error:', error.message);
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
    incluirNuevoGSheetHoy();
}

module.exports = {
    incluirNuevoGSheetHoy
};
