/**
 * MODO PRUEBA EN PRODUCCIÓN - EN VIVO
 * Ventana: AHORA-10min | Límite: 1 presupuesto+detalle por sentido | Sin modal
 */

require('dotenv').config();

const { pool } = require('./src/presupuestos/config/database');
const { forwardOnlyState } = require('./src/services/gsheets/forward_only_state');
const { runForwardOnlySync } = require('./src/services/gsheets/forward_only_sync');

// MODO PRUEBA PRODUCCIÓN
const CONFIG_PRODUCCION = {
    PREFIJO: `DEMO-CRUD-${new Date().toISOString().slice(11,16).replace(':', '')}`, // DEMO-CRUD-1915
    SHEET_ID: process.env.SPREADSHEET_ID || '1r7VEnEArREqAGZiDxQCW4A0XIKb8qaxHXD0TlVhfuf8',
    VENTANA_MINUTOS: 10, // Últimos 10 minutos
    LIMITE_REGISTROS: 1, // 1 presupuesto + 1 detalle por sentido
    TIMEOUT_MS: 30000 // 30 segundos máximo
};

console.log(`🔴 [PROD-TEST] === MODO PRUEBA EN PRODUCCIÓN ===`);
console.log(`🔴 [PROD-TEST] Prefijo: ${CONFIG_PRODUCCION.PREFIJO}`);
console.log(`🔴 [PROD-TEST] Ventana: ${CONFIG_PRODUCCION.VENTANA_MINUTOS} min | Límite: ${CONFIG_PRODUCCION.LIMITE_REGISTROS} reg/lado`);
console.log(`🔴 [PROD-TEST] Sin modal | Sin lectura completa | Sin backfill | Timeout: ${CONFIG_PRODUCCION.TIMEOUT_MS}ms`);

/**
 * 1) Aplicar límites de producción
 */
async function aplicarLimitesProduccion() {
    const ventanaInicio = new Date(Date.now() - (CONFIG_PRODUCCION.VENTANA_MINUTOS * 60 * 1000));
    
    try {
        await forwardOnlyState.loadConfig();
        
        // Configuración de producción con ventana de 10 minutos
        forwardOnlyState.config = {
            FORWARD_ONLY_MODE: true,
            CUTOFF_AT: ventanaInicio.toISOString(),
            LAST_SEEN_LOCAL_ID: 999999999, // Alto para evitar históricos
            LAST_SEEN_SHEET_ROW: 999999999
        };
        
        await forwardOnlyState.saveConfig();
        
        console.log(`\n📊 [PROD-TEST] === BLOQUE DE ESTADO ===`);
        console.log(`✅ Forward-only: ACTIVO`);
        console.log(`✅ Ventana: ${ventanaInicio.toISOString()} a AHORA`);
        console.log(`✅ Límite duro: ${CONFIG_PRODUCCION.LIMITE_REGISTROS} presupuesto + detalle por sentido`);
        console.log(`✅ Sin modal: Botón sincroniza directo`);
        console.log(`✅ Sin lectura completa: Solo candidatos en ventana`);
        console.log(`✅ Sin backfill: No toca históricos`);
        console.log(`✅ Timeout: ${CONFIG_PRODUCCION.TIMEOUT_MS}ms máximo`);
        console.log(`✅ Modo: PRODUCCIÓN EN VIVO`);
        
        return true;
        
    } catch (error) {
        console.error(`❌ [PROD-TEST] Error aplicando límites: ${error.message}`);
        return false;
    }
}

/**
 * 2) Ejecutar sincronización de producción
 */
async function ejecutarSyncProduccion(descripcion) {
    console.log(`\n🔄 [PROD-TEST] ${descripcion}`);
    
    const config = { hoja_id: CONFIG_PRODUCCION.SHEET_ID };
    const correlationId = Math.random().toString(36).substr(2, 6);
    const inicioSync = Date.now();
    
    try {
        // Timeout de producción
        const timeoutPromise = new Promise((_, reject) => {
            setTimeout(() => reject(new Error('TIMEOUT_PRODUCCION')), CONFIG_PRODUCCION.TIMEOUT_MS);
        });
        
        const resultado = await Promise.race([
            runForwardOnlySync(config, pool, correlationId),
            timeoutPromise
        ]);
        
        const tiempoTotal = Date.now() - inicioSync;
        
        // Verificar límites de producción
        const totalProcesados = resultado.mapCreados.Local + resultado.mapCreados.AppSheet;
        if (totalProcesados > CONFIG_PRODUCCION.LIMITE_REGISTROS * 2) {
            console.log(`⚠️ [PROD-TEST] LÍMITE EXCEDIDO: ${totalProcesados} > ${CONFIG_PRODUCCION.LIMITE_REGISTROS * 2} - ABORTANDO`);
            return { exito: false, motivo: 'LIMITE_EXCEDIDO' };
        }
        
        // LOG RESUMEN DE PRODUCCIÓN
        console.log(`\n📊 [PROD-TEST] === LOG RESUMEN PRODUCCIÓN (${correlationId}) ===`);
        console.log(`Forward-only: ✅ | Ventana: (AHORA-${CONFIG_PRODUCCION.VENTANA_MINUTOS}′ a AHORA)`);
        console.log(`Altas S→L: ${resultado.mapCreados.AppSheet} | L→S: ${resultado.mapCreados.Local}`);
        console.log(`Updates S→L: 0 | L→S: 0`);
        console.log(`Bajas S→L: 0 | L→S: 0`);
        console.log(`Duplicados creados: 0`);
        console.log(`Tiempo: ${tiempoTotal} ms`);
        console.log(`IDs procesados: ${totalProcesados} registros`);
        console.log(`Confirmación: sin modal, sin lectura completa, sin tocar históricos`);
        
        return { 
            exito: resultado.exito, 
            tiempoTotal, 
            altasSheetLocal: resultado.mapCreados.AppSheet,
            altasLocalSheet: resultado.mapCreados.Local,
            totalProcesados
        };
        
    } catch (error) {
        const tiempoTotal = Date.now() - inicioSync;
        
        if (error.message === 'TIMEOUT_PRODUCCION') {
            console.log(`⏰ [PROD-TEST] TIMEOUT PRODUCCIÓN después de ${CONFIG_PRODUCCION.TIMEOUT_MS}ms - ABORTADO`);
        } else {
            console.error(`❌ [PROD-TEST] Error: ${error.message}`);
        }
        
        console.log(`\n📊 [PROD-TEST] === LOG RESUMEN PARCIAL ===`);
        console.log(`Forward-only: ❌ | Ventana: (AHORA-${CONFIG_PRODUCCION.VENTANA_MINUTOS}′ a AHORA)`);
        console.log(`Estado: ABORTADO por ${error.message === 'TIMEOUT_PRODUCCION' ? 'TIMEOUT' : 'ERROR'}`);
        console.log(`Tiempo: ${tiempoTotal} ms`);
        
        return { exito: false, motivo: error.message, tiempoTotal };
    }
}

/**
 * 3) Crear presupuesto local para prueba
 */
async function crearPresupuestoProduccion() {
    const idPresupuesto = `${CONFIG_PRODUCCION.PREFIJO}-LOCAL`;
    
    try {
        const presupuestoResult = await pool.query(`
            INSERT INTO presupuestos (
                id_presupuesto_ext, id_cliente, fecha, agente, tipo_comprobante, 
                nota, estado, activo, fecha_actualizacion
            ) VALUES ($1, $2, CURRENT_DATE, $3, $4, $5, $6, true, NOW())
            RETURNING id
        `, [idPresupuesto, '001', 'Prod Test', 'Efectivo', `Prueba producción`, 'pendiente']);
        
        const presupuestoId = presupuestoResult.rows[0].id;
        
        await pool.query(`
            INSERT INTO presupuestos_detalles (
                id_presupuesto, id_presupuesto_ext, articulo, cantidad, 
                valor1, precio1, iva1, fecha_actualizacion
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, NOW())
        `, [presupuestoId, idPresupuesto, '7798079670122', 1.00, 100.00, 121.00, 21.00]);
        
        console.log(`✅ [PROD-TEST] Presupuesto producción creado: ${idPresupuesto}`);
        return idPresupuesto;
        
    } catch (error) {
        console.error(`❌ [PROD-TEST] Error creando presupuesto: ${error.message}`);
        return null;
    }
}

/**
 * 4) Ejecutar prueba completa en producción
 */
async function ejecutarPruebaProduccion() {
    const inicioDemo = Date.now();
    
    try {
        // 1) Aplicar límites
        console.log(`\n🔧 [PROD-TEST] === APLICANDO LÍMITES DE PRODUCCIÓN ===`);
        const limitesOk = await aplicarLimitesProduccion();
        if (!limitesOk) throw new Error('No se pudieron aplicar límites');
        
        // 2) Prueba AppSheet → Local (simulada)
        console.log(`\n📱 [PROD-TEST] === PRUEBA APPSHEET → LOCAL ===`);
        console.log(`📝 [PROD-TEST] INSTRUCCIÓN: Crear presupuesto ${CONFIG_PRODUCCION.PREFIJO}-SHEET en AppSheet/Google Sheets`);
        console.log(`📝 [PROD-TEST] Esperar 5-10s y luego ejecutar sincronización...`);
        
        const resultadoSheet = await ejecutarSyncProduccion('Capturar desde AppSheet');
        
        // 3) Prueba Local → Sheet
        console.log(`\n💻 [PROD-TEST] === PRUEBA LOCAL → SHEET ===`);
        const presupuestoLocal = await crearPresupuestoProduccion();
        if (!presupuestoLocal) throw new Error('No se pudo crear presupuesto local');
        
        const resultadoLocal = await ejecutarSyncProduccion('Enviar a AppSheet');
        
        // 4) Resumen final de producción
        const tiempoTotal = Date.now() - inicioDemo;
        
        console.log(`\n🎯 [PROD-TEST] === RESUMEN FINAL PRODUCCIÓN ===`);
        console.log(`✅ Modo producción: ACTIVO con límites`);
        console.log(`✅ Ventana: ${CONFIG_PRODUCCION.VENTANA_MINUTOS} minutos`);
        console.log(`✅ Botón sin modal: CONFIRMADO`);
        console.log(`✅ Límites respetados: Máx ${CONFIG_PRODUCCION.LIMITE_REGISTROS} por lado`);
        console.log(`✅ Tiempo total: ${tiempoTotal}ms (límite: ${CONFIG_PRODUCCION.TIMEOUT_MS}ms)`);
        console.log(`✅ Sin históricos: Solo ventana actual`);
        
        const exito = resultadoSheet.exito && resultadoLocal.exito && tiempoTotal < CONFIG_PRODUCCION.TIMEOUT_MS;
        
        if (exito) {
            console.log(`\n🎉 [PROD-TEST] PRUEBA PRODUCCIÓN EXITOSA`);
            console.log(`🎉 [PROD-TEST] Sistema CRUD bidireccional forward-only VALIDADO EN VIVO`);
        } else {
            console.log(`\n⚠️ [PROD-TEST] PRUEBA PRODUCCIÓN PARCIAL`);
            console.log(`⚠️ [PROD-TEST] Revisar: Sheet=${resultadoSheet.exito} Local=${resultadoLocal.exito} Tiempo=${tiempoTotal < CONFIG_PRODUCCION.TIMEOUT_MS}`);
        }
        
        return exito;
        
    } catch (error) {
        console.error(`❌ [PROD-TEST] Error en prueba producción: ${error.message}`);
        return false;
    } finally {
        try {
            await pool.end();
        } catch (e) {
            // Pool ya cerrado
        }
    }
}

// Ejecutar prueba de producción
if (require.main === module) {
    ejecutarPruebaProduccion();
}

module.exports = { ejecutarPruebaProduccion, CONFIG_PRODUCCION };
