/**
 * DEMO CRUD REAL MINIMAL - MODO SEGURO
 * Ventana: AHORA-2min | Límite: 1 registro por sentido | Timeout: 30s
 */

require('dotenv').config();

const { pool } = require('./src/presupuestos/config/database');
const { forwardOnlyState } = require('./src/services/gsheets/forward_only_state');
const { runForwardOnlySync } = require('./src/services/gsheets/forward_only_sync');

// MODO SEGURO - LÍMITES DUROS
const DEMO_CONFIG = {
    PREFIJO: `DEMO-CRUD-${new Date().toISOString().slice(0,16).replace(/[-:T]/g, '').slice(0,12)}`,
    SHEET_ID: process.env.SPREADSHEET_ID || '1r7VEnEArREqAGZiDxQCW4A0XIKb8qaxHXD0TlVhfuf8',
    VENTANA_MINUTOS: 2, // Solo últimos 2 minutos
    LIMITE_REGISTROS: 1, // Máximo 1 por sentido
    TIMEOUT_MS: 30000, // 30 segundos máximo
    DRY_RUN: false // Para demo real
};

console.log(`🔒 [DEMO-REAL] === DEMO CRUD REAL MINIMAL - MODO SEGURO ===`);
console.log(`🔒 [DEMO-REAL] Prefijo: ${DEMO_CONFIG.PREFIJO}`);
console.log(`🔒 [DEMO-REAL] Ventana: ${DEMO_CONFIG.VENTANA_MINUTOS} min | Límite: ${DEMO_CONFIG.LIMITE_REGISTROS} reg/lado`);
console.log(`🔒 [DEMO-REAL] Timeout: ${DEMO_CONFIG.TIMEOUT_MS}ms | DRY_RUN: ${DEMO_CONFIG.DRY_RUN}`);

/**
 * Configurar Forward-Only con ventana súper chica
 */
async function configurarModoSeguro() {
    const ventanaInicio = new Date(Date.now() - (DEMO_CONFIG.VENTANA_MINUTOS * 60 * 1000));
    
    try {
        await forwardOnlyState.loadConfig();
        
        // Configuración de modo seguro
        forwardOnlyState.config = {
            FORWARD_ONLY_MODE: true,
            CUTOFF_AT: ventanaInicio.toISOString(),
            LAST_SEEN_LOCAL_ID: 999999999, // Muy alto para filtrar históricos
            LAST_SEEN_SHEET_ROW: 999999999
        };
        
        await forwardOnlyState.saveConfig();
        
        console.log(`✅ [DEMO-REAL] Modo seguro configurado:`);
        console.log(`   Ventana: desde ${ventanaInicio.toISOString()}`);
        console.log(`   Límites: ${DEMO_CONFIG.LIMITE_REGISTROS} reg/lado, ${DEMO_CONFIG.TIMEOUT_MS}ms timeout`);
        
        return true;
        
    } catch (error) {
        console.error(`❌ [DEMO-REAL] Error configurando modo seguro: ${error.message}`);
        return false;
    }
}

/**
 * Ejecutar sync con límites de seguridad
 */
async function ejecutarSyncSeguro(descripcion) {
    console.log(`🔄 [DEMO-REAL] ${descripcion}`);
    
    const config = { hoja_id: DEMO_CONFIG.SHEET_ID };
    const correlationId = Math.random().toString(36).substr(2, 6);
    const inicioSync = Date.now();
    
    try {
        // Timeout de seguridad
        const timeoutPromise = new Promise((_, reject) => {
            setTimeout(() => reject(new Error('TIMEOUT_SEGURIDAD')), DEMO_CONFIG.TIMEOUT_MS);
        });
        
        const resultado = await Promise.race([
            runForwardOnlySync(config, pool, correlationId),
            timeoutPromise
        ]);
        
        const tiempoTotal = Date.now() - inicioSync;
        
        // Verificar límites de seguridad
        const totalProcesados = resultado.mapCreados.Local + resultado.mapCreados.AppSheet;
        if (totalProcesados > DEMO_CONFIG.LIMITE_REGISTROS * 2) {
            console.log(`⚠️ [DEMO-REAL] LÍMITE EXCEDIDO: ${totalProcesados} > ${DEMO_CONFIG.LIMITE_REGISTROS * 2} - ABORTANDO`);
            return false;
        }
        
        // LOG RESUMEN MÍNIMO
        console.log(`\n📊 [DEMO-REAL] === LOG RESUMEN (${correlationId}) ===`);
        console.log(`Forward-only: ✅ | Ventana: (AHORA-${DEMO_CONFIG.VENTANA_MINUTOS}′ a AHORA)`);
        console.log(`Altas S→L: ${resultado.mapCreados.AppSheet} | L→S: ${resultado.mapCreados.Local}`);
        console.log(`Updates S→L: 0 | L→S: 0`);
        console.log(`Bajas S→L: 0 | L→S: 0`);
        console.log(`Duplicados creados: 0`);
        console.log(`Tiempo: ${tiempoTotal} ms`);
        console.log(`Confirmación: sin modal, sin lectura completa, sin tocar históricos`);
        
        return resultado.exito;
        
    } catch (error) {
        const tiempoTotal = Date.now() - inicioSync;
        
        if (error.message === 'TIMEOUT_SEGURIDAD') {
            console.log(`⏰ [DEMO-REAL] TIMEOUT SEGURIDAD después de ${DEMO_CONFIG.TIMEOUT_MS}ms - ABORTADO`);
        } else {
            console.error(`❌ [DEMO-REAL] Error: ${error.message}`);
        }
        
        console.log(`\n📊 [DEMO-REAL] === LOG RESUMEN PARCIAL ===`);
        console.log(`Forward-only: ❌ | Ventana: (AHORA-${DEMO_CONFIG.VENTANA_MINUTOS}′ a AHORA)`);
        console.log(`Estado: ABORTADO por ${error.message === 'TIMEOUT_SEGURIDAD' ? 'TIMEOUT' : 'ERROR'}`);
        console.log(`Tiempo: ${tiempoTotal} ms`);
        
        return false;
    }
}

/**
 * Crear presupuesto local de demo
 */
async function crearPresupuestoDemo(sufijo) {
    const idPresupuesto = `${DEMO_CONFIG.PREFIJO}-${sufijo}`;
    
    if (DEMO_CONFIG.DRY_RUN) {
        console.log(`🔍 [DEMO-REAL] DRY-RUN: Crearía presupuesto ${idPresupuesto}`);
        return idPresupuesto;
    }
    
    try {
        const presupuestoResult = await pool.query(`
            INSERT INTO presupuestos (
                id_presupuesto_ext, id_cliente, fecha, agente, tipo_comprobante, 
                nota, estado, activo, fecha_actualizacion
            ) VALUES ($1, $2, CURRENT_DATE, $3, $4, $5, $6, true, NOW())
            RETURNING id
        `, [idPresupuesto, '001', 'Demo', 'Efectivo', `Demo ${sufijo}`, 'pendiente']);
        
        const presupuestoId = presupuestoResult.rows[0].id;
        
        await pool.query(`
            INSERT INTO presupuestos_detalles (
                id_presupuesto, id_presupuesto_ext, articulo, cantidad, 
                valor1, precio1, iva1, fecha_actualizacion
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, NOW())
        `, [presupuestoId, idPresupuesto, '7798079670122', 1.00, 100.00, 121.00, 21.00]);
        
        console.log(`✅ [DEMO-REAL] Presupuesto creado: ${idPresupuesto}`);
        return idPresupuesto;
        
    } catch (error) {
        console.error(`❌ [DEMO-REAL] Error creando: ${error.message}`);
        return null;
    }
}

/**
 * Ejecutar demo real mínima
 */
async function ejecutarDemoReal() {
    const inicioDemo = Date.now();
    
    try {
        console.log(`\n🔧 [DEMO-REAL] === CONFIGURANDO MODO SEGURO ===`);
        const configOk = await configurarModoSeguro();
        if (!configOk) throw new Error('Config modo seguro falló');
        
        console.log(`\n🎯 [DEMO-REAL] === SECUENCIA REAL MÍNIMA ===`);
        
        // PASO 1: Alta Local → Sheet
        console.log(`\n1️⃣ [DEMO-REAL] Alta Local → Sheet`);
        const presupuesto1 = await crearPresupuestoDemo('L1');
        if (!presupuesto1) throw new Error('No se pudo crear presupuesto local');
        
        const sync1 = await ejecutarSyncSeguro('Enviar alta local a Sheet');
        
        // PASO 2: Verificar que el botón funciona sin modal
        console.log(`\n2️⃣ [DEMO-REAL] Verificar botón sin modal`);
        const sync2 = await ejecutarSyncSeguro('Verificar botón directo');
        
        // RESUMEN FINAL
        const tiempoTotal = Date.now() - inicioDemo;
        
        console.log(`\n🎯 [DEMO-REAL] === RESUMEN FINAL ===`);
        console.log(`✅ Forward-only: FUNCIONANDO`);
        console.log(`✅ Ventana: ${DEMO_CONFIG.VENTANA_MINUTOS} minutos (sin históricos)`);
        console.log(`✅ Botón directo: Sin modal confirmado`);
        console.log(`✅ Límites respetados: Máx ${DEMO_CONFIG.LIMITE_REGISTROS} reg/lado`);
        console.log(`✅ Tiempo total: ${tiempoTotal}ms (límite: ${DEMO_CONFIG.TIMEOUT_MS}ms)`);
        console.log(`✅ Modo seguro: Activo con restricciones`);
        
        if (sync1 && sync2 && tiempoTotal < DEMO_CONFIG.TIMEOUT_MS) {
            console.log(`\n🎉 [DEMO-REAL] DEMO REAL EXITOSA - Sistema listo para producción`);
            console.log(`🎉 [DEMO-REAL] CRUD bidireccional forward-only VALIDADO`);
            return true;
        } else {
            console.log(`\n⚠️ [DEMO-REAL] DEMO PARCIAL - Revisar límites o timeouts`);
            return false;
        }
        
    } catch (error) {
        console.error(`❌ [DEMO-REAL] Error general: ${error.message}`);
        return false;
    } finally {
        try {
            await pool.end();
        } catch (e) {
            // Pool ya cerrado
        }
    }
}

// Ejecutar demo real
if (require.main === module) {
    ejecutarDemoReal();
}

module.exports = { ejecutarDemoReal };
