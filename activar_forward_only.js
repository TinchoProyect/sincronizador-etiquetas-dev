/**
 * Script de activación one-shot para modo Forward-Only
 * Prompt E - Activación ahora
 */

require('dotenv').config();

const { pool } = require('./src/presupuestos/config/database');
const { forwardOnlyState } = require('./src/services/gsheets/forward_only_state');

async function activarForwardOnly() {
    console.log('🔍 [ACTIVAR-FORWARD-ONLY] === ACTIVACIÓN MODO FORWARD-ONLY ===\n');
    
    try {
        // Configuración de Sheets
        const config = {
            hoja_id: process.env.SPREADSHEET_ID || '1r7VEnEArREqAGZiDxQCW4A0XIKb8qaxHXD0TlVhfuf8'
        };
        
        console.log('[ACTIVAR-FORWARD-ONLY] Habilitando modo Forward-Only...');
        
        // Ejecutar setup inicial
        const resultado = await forwardOnlyState.enableForwardOnly(config);
        
        if (resultado) {
            console.log('\n✅ [ACTIVAR-FORWARD-ONLY] Modo Forward-Only activado exitosamente');
            console.log('\n📋 [ACTIVAR-FORWARD-ONLY] Configuración actual:');
            
            const configActual = forwardOnlyState.getConfig();
            console.log(`FORWARD_ONLY_MODE: ${configActual.FORWARD_ONLY_MODE}`);
            console.log(`CUTOFF_AT: ${configActual.CUTOFF_AT}`);
            console.log(`LAST_SEEN_LOCAL_ID: ${configActual.LAST_SEEN_LOCAL_ID}`);
            console.log(`LAST_SEEN_SHEET_ROW: ${configActual.LAST_SEEN_SHEET_ROW}`);
            
            console.log('\n🎯 [ACTIVAR-FORWARD-ONLY] El botón "Sincronizar Google Sheets" ahora ejecutará modo Forward-Only');
            console.log('🎯 [ACTIVAR-FORWARD-ONLY] Solo procesará datos nuevos desde el corte establecido');
            console.log('🎯 [ACTIVAR-FORWARD-ONLY] No tocará históricos ni ejecutará recarga completa');
            
        } else {
            console.log('\n❌ [ACTIVAR-FORWARD-ONLY] Error activando modo Forward-Only');
        }
        
    } catch (error) {
        console.error('❌ [ACTIVAR-FORWARD-ONLY] Error:', error.message);
        console.error('Stack:', error.stack);
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
    activarForwardOnly();
}

module.exports = {
    activarForwardOnly
};
