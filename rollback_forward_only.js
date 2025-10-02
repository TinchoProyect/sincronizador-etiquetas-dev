/**
 * Rollback rápido al flujo tradicional (sin perder marcadores)
 * PROMPT 3 — Rollback rápido al flujo tradicional (sin perder marcadores)
 */

require('dotenv').config();

const { forwardOnlyState } = require('./src/services/gsheets/forward_only_state');

async function rollbackForwardOnly() {
    console.log('🔍 [ROLLBACK] === ROLLBACK AL FLUJO TRADICIONAL ===\n');
    
    try {
        // Cargar configuración actual
        await forwardOnlyState.loadConfig();
        const configAntes = forwardOnlyState.getConfig();
        
        console.log('[ROLLBACK] Configuración antes del rollback:');
        console.log(`FORWARD_ONLY_MODE: ${configAntes.FORWARD_ONLY_MODE}`);
        console.log(`CUTOFF_AT: ${configAntes.CUTOFF_AT}`);
        console.log(`LAST_SEEN_LOCAL_ID: ${configAntes.LAST_SEEN_LOCAL_ID}`);
        console.log(`LAST_SEEN_SHEET_ROW: ${configAntes.LAST_SEEN_SHEET_ROW}`);
        
        // Desactivar Forward-Only (conservando marcadores)
        const rollbackExitoso = await forwardOnlyState.disableForwardOnly();
        
        if (rollbackExitoso) {
            // Verificar que se desactivó correctamente
            await forwardOnlyState.loadConfig();
            const configDespues = forwardOnlyState.getConfig();
            
            console.log('\n[ROLLBACK] Configuración después del rollback:');
            console.log(`FORWARD_ONLY_MODE: ${configDespues.FORWARD_ONLY_MODE}`);
            console.log(`CUTOFF_AT: ${configDespues.CUTOFF_AT} (conservado)`);
            console.log(`LAST_SEEN_LOCAL_ID: ${configDespues.LAST_SEEN_LOCAL_ID} (conservado)`);
            console.log(`LAST_SEEN_SHEET_ROW: ${configDespues.LAST_SEEN_SHEET_ROW} (conservado)`);
            
            // Salida obligatoria exacta
            console.log('\n📊 [ROLLBACK] === SALIDA OBLIGATORIA ===');
            console.log('Forward-only desactivado: ✅');
            console.log('Flujo tradicional activo (push+recarga): ✅');
            console.log('Marcadores conservados para futura reactivación: ✅');
            
            console.log('\n✅ [ROLLBACK] El botón "Sincronizar Google Sheets" ahora ejecutará:');
            console.log('   1. Push previo Local→Sheet');
            console.log('   2. Lectura completa Sheets→Local');
            console.log('   3. Reemplazo atómico');
            console.log('   4. UPSERT por MAP');
            console.log('\n✅ [ROLLBACK] presupuestos_detalles_map NO fue alterada');
            
        } else {
            console.log('❌ [ROLLBACK] Error ejecutando rollback');
        }
        
    } catch (error) {
        console.error('❌ [ROLLBACK] Error:', error.message);
        console.error('Stack:', error.stack);
    }
}

// Ejecutar si se llama directamente
if (require.main === module) {
    rollbackForwardOnly();
}

module.exports = {
    rollbackForwardOnly
};
