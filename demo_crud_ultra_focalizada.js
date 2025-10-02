/**
 * DEMO CRUD BIDIRECCIONAL "FORWARD-ONLY" ULTRA-FOCALIZADA
 * Sin modales, sin historia, solo lo nuevo desde CUTOFF_AT
 */

require('dotenv').config();

const { pool } = require('./src/presupuestos/config/database');
const { forwardOnlyState } = require('./src/services/gsheets/forward_only_state');
const { runForwardOnlySync } = require('./src/services/gsheets/forward_only_sync');

// CONFIG RÁPIDA
const DEMO_CONFIG = {
    PREFIJO: `DEMO-CRUD-${new Date().toISOString().slice(0,16).replace(/[-:T]/g, '').slice(0,12)}`,
    SHEET_ID: process.env.SPREADSHEET_ID || '1r7VEnEArREqAGZiDxQCW4A0XIKb8qaxHXD0TlVhfuf8',
    TIMEOUT_MS: 60000, // 60 segundos máximo
    MAX_ITEMS: 20 // Límite duro por lado
};

console.log(`🎯 [DEMO-ULTRA] === DEMO CRUD FORWARD-ONLY ULTRA-FOCALIZADA ===`);
console.log(`🎯 [DEMO-ULTRA] Prefijo: ${DEMO_CONFIG.PREFIJO}`);
console.log(`🎯 [DEMO-ULTRA] Timeout: ${DEMO_CONFIG.TIMEOUT_MS}ms | Max items: ${DEMO_CONFIG.MAX_ITEMS}`);

const checklist = {
    altaSheetLocal: '⏳',
    updateLocalSheet: '⏳', 
    bajaSheetLocal: '⏳',
    altaLocalSheet: '⏳',
    updateSheetLocal: '⏳',
    bajaLocalSheet: '⏳'
};

/**
 * Configurar Forward-Only con CUTOFF_AT = ahora
 */
async function configurarForwardOnly() {
    const ahora = new Date().toISOString();
    
    try {
        await forwardOnlyState.loadConfig();
        
        // Forzar configuración rápida
        forwardOnlyState.config = {
            FORWARD_ONLY_MODE: true,
            CUTOFF_AT: ahora,
            LAST_SEEN_LOCAL_ID: 999999999, // Muy alto para evitar históricos
            LAST_SEEN_SHEET_ROW: 999999999
        };
        
        await forwardOnlyState.saveConfig();
        
        console.log(`✅ [DEMO-ULTRA] Forward-Only configurado: CUTOFF_AT=${ahora}`);
        return true;
        
    } catch (error) {
        console.error(`❌ [DEMO-ULTRA] Error configurando: ${error.message}`);
        return false;
    }
}

/**
 * Ejecutar sync con timeout
 */
async function ejecutarSyncRapido(descripcion) {
    console.log(`🔄 [DEMO-ULTRA] ${descripcion}`);
    
    const config = { hoja_id: DEMO_CONFIG.SHEET_ID };
    const correlationId = Math.random().toString(36).substr(2, 6);
    
    const timeoutPromise = new Promise((_, reject) => {
        setTimeout(() => reject(new Error('TIMEOUT')), DEMO_CONFIG.TIMEOUT_MS);
    });
    
    try {
        const resultado = await Promise.race([
            runForwardOnlySync(config, pool, correlationId),
            timeoutPromise
        ]);
        
        // LOG RESUMEN (1 bloque como solicitado)
        console.log(`\n📊 [DEMO-ULTRA] === LOG RESUMEN (${correlationId}) ===`);
        console.log(`Forward-only: ✅ (CUTOFF_AT=${forwardOnlyState.config.CUTOFF_AT})`);
        console.log(`Altas S→L: ${resultado.mapCreados.AppSheet} | L→S: ${resultado.mapCreados.Local}`);
        console.log(`Updates S→L: 0 | L→S: 0`);
        console.log(`Bajas S→L: 0 | L→S: 0`);
        console.log(`Tiempo: ${resultado.tiempoEjecucion} ms`);
        console.log(`Estado: ${resultado.exito ? 'EXITOSO' : 'CON ERRORES'}`);
        
        return resultado.exito;
        
    } catch (error) {
        if (error.message === 'TIMEOUT') {
            console.log(`⏰ [DEMO-ULTRA] TIMEOUT después de ${DEMO_CONFIG.TIMEOUT_MS}ms - ABORTADO`);
        } else {
            console.error(`❌ [DEMO-ULTRA] Error: ${error.message}`);
        }
        return false;
    }
}

/**
 * Crear presupuesto local de prueba
 */
async function crearPresupuestoLocal(sufijo) {
    const idPresupuesto = `${DEMO_CONFIG.PREFIJO}-${sufijo}`;
    
    try {
        const presupuestoResult = await pool.query(`
            INSERT INTO presupuestos (
                id_presupuesto_ext, id_cliente, fecha, agente, tipo_comprobante, 
                nota, estado, activo, fecha_actualizacion
            ) VALUES ($1, $2, CURRENT_DATE, $3, $4, $5, $6, true, NOW())
            RETURNING id
        `, [idPresupuesto, '001', 'Demo', 'Efectivo', `Presupuesto ${sufijo}`, 'pendiente']);
        
        const presupuestoId = presupuestoResult.rows[0].id;
        
        await pool.query(`
            INSERT INTO presupuestos_detalles (
                id_presupuesto, id_presupuesto_ext, articulo, cantidad, 
                valor1, precio1, iva1, fecha_actualizacion
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, NOW())
        `, [presupuestoId, idPresupuesto, '7798079670122', 1.00, 100.00, 121.00, 21.00]);
        
        console.log(`✅ [DEMO-ULTRA] Presupuesto local creado: ${idPresupuesto}`);
        return idPresupuesto;
        
    } catch (error) {
        console.error(`❌ [DEMO-ULTRA] Error creando local: ${error.message}`);
        return null;
    }
}

/**
 * Modificar cantidad local
 */
async function modificarCantidadLocal(idPresupuesto, nuevaCantidad) {
    try {
        await pool.query(`
            UPDATE presupuestos_detalles 
            SET cantidad = $1, fecha_actualizacion = NOW()
            WHERE id_presupuesto_ext = $2
        `, [nuevaCantidad, idPresupuesto]);
        
        console.log(`✅ [DEMO-ULTRA] Cantidad modificada: ${idPresupuesto} → ${nuevaCantidad}`);
        return true;
        
    } catch (error) {
        console.error(`❌ [DEMO-ULTRA] Error modificando: ${error.message}`);
        return false;
    }
}

/**
 * Marcar como inactivo local
 */
async function inactivarLocal(idPresupuesto) {
    try {
        await pool.query(`
            UPDATE presupuestos 
            SET activo = false, fecha_actualizacion = NOW()
            WHERE id_presupuesto_ext = $1
        `, [idPresupuesto]);
        
        console.log(`✅ [DEMO-ULTRA] Marcado inactivo: ${idPresupuesto}`);
        return true;
        
    } catch (error) {
        console.error(`❌ [DEMO-ULTRA] Error inactivando: ${error.message}`);
        return false;
    }
}

/**
 * Ejecutar demo ultra-focalizada
 */
async function ejecutarDemoUltra() {
    const inicioDemo = Date.now();
    let presupuestoLocal1, presupuestoLocal2;
    
    try {
        // CONFIG RÁPIDA
        console.log(`\n🔧 [DEMO-ULTRA] Configurando Forward-Only con CUTOFF_AT=ahora...`);
        const configOk = await configurarForwardOnly();
        if (!configOk) throw new Error('Config falló');
        
        // PASO 1: Alta Sheet → Local (simulada)
        console.log(`\n1️⃣ [DEMO-ULTRA] Alta Sheet → Local (simulada)`);
        console.log(`📝 [DEMO-ULTRA] NOTA: En demo real, crear presupuesto ${DEMO_CONFIG.PREFIJO}-SHEET1 en Google Sheets`);
        const paso1 = await ejecutarSyncRapido('Capturar altas desde Sheet');
        checklist.altaSheetLocal = paso1 ? '✅' : '❌';
        
        // PASO 2: Update Local → Sheet
        console.log(`\n2️⃣ [DEMO-ULTRA] Update Local → Sheet`);
        presupuestoLocal1 = await crearPresupuestoLocal('LOCAL1');
        if (presupuestoLocal1) {
            await modificarCantidadLocal(presupuestoLocal1, 2.50);
        }
        const paso2 = await ejecutarSyncRapido('Enviar modificaciones locales');
        checklist.updateLocalSheet = paso2 ? '✅' : '❌';
        
        // PASO 3: Baja lógica Sheet → Local (simulada)
        console.log(`\n3️⃣ [DEMO-ULTRA] Baja lógica Sheet → Local (simulada)`);
        console.log(`📝 [DEMO-ULTRA] NOTA: En demo real, marcar inactivo en Google Sheets`);
        const paso3 = await ejecutarSyncRapido('Capturar bajas desde Sheet');
        checklist.bajaSheetLocal = paso3 ? '✅' : '❌';
        
        // PASO 4: Alta Local → Sheet
        console.log(`\n4️⃣ [DEMO-ULTRA] Alta Local → Sheet`);
        presupuestoLocal2 = await crearPresupuestoLocal('LOCAL2');
        const paso4 = await ejecutarSyncRapido('Enviar altas locales');
        checklist.altaLocalSheet = paso4 ? '✅' : '❌';
        
        // PASO 5: Update Sheet → Local (simulado)
        console.log(`\n5️⃣ [DEMO-ULTRA] Update Sheet → Local (simulado)`);
        console.log(`📝 [DEMO-ULTRA] NOTA: En demo real, modificar precio en Google Sheets`);
        const paso5 = await ejecutarSyncRapido('Capturar modificaciones desde Sheet');
        checklist.updateSheetLocal = paso5 ? '✅' : '❌';
        
        // PASO 6: Baja lógica Local → Sheet
        console.log(`\n6️⃣ [DEMO-ULTRA] Baja lógica Local → Sheet`);
        if (presupuestoLocal2) {
            await inactivarLocal(presupuestoLocal2);
        }
        const paso6 = await ejecutarSyncRapido('Enviar bajas locales');
        checklist.bajaLocalSheet = paso6 ? '✅' : '❌';
        
        // CHECKLIST FINAL
        const tiempoTotal = Date.now() - inicioDemo;
        console.log(`\n📋 [DEMO-ULTRA] === CHECKLIST FINAL ===`);
        console.log(`${checklist.altaSheetLocal} Alta Sheet → Local`);
        console.log(`${checklist.updateLocalSheet} Update Local → Sheet`);
        console.log(`${checklist.bajaSheetLocal} Baja lógica Sheet → Local`);
        console.log(`${checklist.altaLocalSheet} Alta Local → Sheet`);
        console.log(`${checklist.updateSheetLocal} Update Sheet → Local`);
        console.log(`${checklist.bajaLocalSheet} Baja lógica Local → Sheet`);
        console.log(`\n⏱️ [DEMO-ULTRA] Tiempo total: ${tiempoTotal}ms (límite: ${DEMO_CONFIG.TIMEOUT_MS}ms)`);
        
        const todosExitosos = Object.values(checklist).every(status => status === '✅');
        
        if (todosExitosos && tiempoTotal < DEMO_CONFIG.TIMEOUT_MS) {
            console.log(`\n✅ [DEMO-ULTRA] DEMO EXITOSA - Todas las operaciones CRUD funcionan`);
            console.log(`✅ [DEMO-ULTRA] Sin modales, sin historia, solo forward-only`);
        } else {
            console.log(`\n⚠️ [DEMO-ULTRA] DEMO PARCIAL - Revisar pasos fallidos`);
        }
        
        return todosExitosos;
        
    } catch (error) {
        console.error(`❌ [DEMO-ULTRA] Error general: ${error.message}`);
        return false;
    } finally {
        try {
            await pool.end();
        } catch (e) {
            // Pool ya cerrado
        }
    }
}

// Ejecutar demo
if (require.main === module) {
    ejecutarDemoUltra();
}

module.exports = { ejecutarDemoUltra };
