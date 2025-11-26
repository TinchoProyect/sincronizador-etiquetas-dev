/**
 * SERVICIO DE SINCRONIZACIÓN TOLERANTE A CUOTAS
 * 
 * Implementa sincronización bidireccional con:
 * - Control de tasa de escrituras (respeta cuotas de Google Sheets)
 * - Reintentos automáticos con backoff exponencial
 * - Procesamiento por lotes controlados
 * - Progreso visible para el frontend
 * - Minimización de escrituras (solo cambios reales)
 * - Idempotencia y reanudación
 * - Filtro cutoff_at para procesar solo cambios recientes
 */

console.log('[SYNC-QUOTA-SAFE] Inicializando servicio de sincronización tolerante a cuotas...');

const { quotaManager } = require('./quotaManager');
const { readSheetWithHeaders } = require('./client_with_logs');
const { parseDate } = require('./transformer');
const crypto = require('crypto');

/**
 * Clase para gestionar estado de sincronización
 */
class SyncState {
    constructor() {
        this.currentOperation = null;
        this.phase = null;
        this.progress = {
            currentBatch: 0,
            totalBatches: 0,
            itemsProcessed: 0,
            totalItems: 0,
            progressPercent: 0
        };
        this.metrics = {
            presupuestosLeidos: 0,
            presupuestosBorrados: 0,
            presupuestosInsertados: 0,
            presupuestosActualizados: 0,
            detallesLeidos: 0,
            detallesBorrados: 0,
            detallesInsertados: 0,
            detallesActualizados: 0,
            omitidosPorCutoff: 0,
            omitidosPorSinCambios: 0,
            reintentos: 0,
            errores: []
        };
        this.startTime = null;
        this.endTime = null;
    }

    startOperation(operation, phase) {
        this.currentOperation = operation;
        this.phase = phase;
        this.startTime = Date.now();
        console.log(`[SYNC-STATE] 🚀 Iniciando: ${operation} - Fase: ${phase}`);
    }

    updateProgress(progress) {
        this.progress = { ...this.progress, ...progress };
        
        const percent = this.progress.progressPercent;
        const current = this.progress.currentBatch;
        const total = this.progress.totalBatches;
        
        console.log(`[SYNC-STATE] 📊 Progreso: ${percent}% (Lote ${current}/${total})`);
    }

    addError(error, context = {}) {
        this.metrics.errores.push({
            error: error.message || error,
            context,
            timestamp: new Date().toISOString()
        });
    }

    completeOperation(success = true) {
        this.endTime = Date.now();
        const duration = Math.round((this.endTime - this.startTime) / 1000);
        console.log(`[SYNC-STATE] ✅ Completado en ${duration}s - Éxito: ${success}`);
        return this.getSummary();
    }

    getSummary() {
        const duration = this.endTime ? 
            Math.round((this.endTime - this.startTime) / 1000) : 
            Math.round((Date.now() - this.startTime) / 1000);

        return {
            operation: this.currentOperation,
            phase: this.phase,
            duration: duration,
            metrics: this.metrics,
            progress: this.progress,
            quotaStats: quotaManager.getStats()
        };
    }
}

/**
 * Helpers para formato de datos
 */
function toSheetDateTimeAR(value) {
    const d = value ? new Date(value) : new Date();
    const f = new Intl.DateTimeFormat('es-AR', {
        timeZone: 'America/Argentina/Buenos_Aires',
        year: 'numeric', month: '2-digit', day: '2-digit',
        hour: '2-digit', minute: '2-digit', second: '2-digit',
        hour12: false
    }).formatToParts(d);
    const parts = Object.fromEntries(f.map(p => [p.type, p.value]));
    return `${parts.day}/${parts.month}/${parts.year} ${parts.hour}:${parts.minute}:${parts.second}`;
}

function toSheetDate(val) {
    if (!val) return '';
    const d = new Date(val);
    if (isNaN(d)) return String(val);
    const dd = String(d.getDate()).padStart(2, '0');
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    const yyyy = d.getFullYear();
    return `${dd}/${mm}/${yyyy}`;
}

function parseLastModified(value) {
    if (!value) return new Date(0);
    
    // Si es número (Excel serial date)
    if (typeof value === 'number') {
        const excelEpoch = new Date(1900, 0, 1);
        const days = value - 2;
        return new Date(excelEpoch.getTime() + days * 24 * 60 * 60 * 1000);
    }
    
    // Si es string, intentar parsear formato dd/mm/yyyy hh:mm:ss
    if (typeof value === 'string') {
        const ddmmyyyyRegex = /^(\d{1,2})\/(\d{1,2})\/(\d{4})\s+(\d{1,2}):(\d{2}):(\d{2})$/;
        const match = value.match(ddmmyyyyRegex);
        if (match) {
            const [, day, month, year, hour, minute, second] = match;
            return new Date(year, month - 1, day, hour, minute, second);
        }
    }
    
    return new Date(value);
}

/**
 * Comparar dos objetos presupuesto para detectar cambios
 */
function hasPresupuestoChanged(local, remote, headers) {
    if (!local || !remote) return true;
    
    // Comparar campos clave
    const fieldsToCompare = [
        { local: 'id_cliente', remote: headers[2] },
        { local: 'fecha', remote: headers[1], transform: (v) => toSheetDate(v) },
        { local: 'fecha_entrega', remote: headers[4], transform: (v) => toSheetDate(v) },
        { local: 'agente', remote: headers[3] },
        { local: 'tipo_comprobante', remote: headers[5] },
        { local: 'nota', remote: headers[6] },
        { local: 'estado', remote: headers[7] },
        { local: 'punto_entrega', remote: headers[11] },
        { local: 'descuento', remote: headers[12], transform: (v) => {
            const pct = v == null ? null : Number(v);
            return pct == null ? '' : (pct > 1 ? `${pct}%` : `${pct*100}%`);
        }}
    ];
    
    for (const field of fieldsToCompare) {
        let localValue = local[field.local];
        let remoteValue = remote[field.remote];
        
        if (field.transform) {
            localValue = field.transform(localValue);
        }
        
        // Normalizar valores para comparación
        localValue = String(localValue || '').trim();
        remoteValue = String(remoteValue || '').trim();
        
        if (localValue !== remoteValue) {
            return true;
        }
    }
    
    return false;
}

/**
 * Sincronización bidireccional tolerante a cuotas
 * @param {Object} config - Configuración de sincronización
 * @param {Object} db - Conexión a base de datos
 * @param {Function} onProgress - Callback para notificar progreso
 * @returns {Promise<Object>} Resumen de la sincronización
 */
async function ejecutarSincronizacionBidireccionalQuotaSafe(config, db, onProgress = null) {
    console.log('[SYNC-QUOTA-SAFE] 🚀 Iniciando sincronización bidireccional tolerante a cuotas...');
    
    const state = new SyncState();
    state.startOperation('Sincronización Bidireccional', 'Inicialización');
    
    // Resetear estadísticas del quota manager
    quotaManager.resetStats();
    
    try {
        // PASO 1: Validar cutoff_at
        const cutoffAt = config.cutoff_at;
        if (!cutoffAt) {
            throw new Error('cutoff_at no está configurado');
        }
        
        console.log('[SYNC-QUOTA-SAFE] ✅ cutoff_at:', cutoffAt);
        
        // PASO 2: Leer datos actuales de Sheets
        state.startOperation('Sincronización Bidireccional', 'Lectura de Sheets');
        
        console.log('[SYNC-QUOTA-SAFE] 📖 Leyendo datos de Google Sheets...');
        const [presupuestosSheets, detallesSheets] = await Promise.all([
            readSheetWithHeaders(config.hoja_id, 'A:P', 'Presupuestos'),
            readSheetWithHeaders(config.hoja_id, 'A:Q', 'DetallesPresupuestos')
        ]);
        
        state.metrics.presupuestosLeidos = presupuestosSheets.rows.length;
        state.metrics.detallesLeidos = detallesSheets.rows.length;
        
        console.log(`[SYNC-QUOTA-SAFE] ✅ Leídos: ${state.metrics.presupuestosLeidos} presupuestos, ${state.metrics.detallesLeidos} detalles`);
        
        // FASE 1: PUSH ANULACIONES
        state.startOperation('Sincronización Bidireccional', 'PUSH Anulaciones');
        console.log('[SYNC-QUOTA-SAFE] === FASE 1: PUSH ANULACIONES ===');
        
        const anulados = await pushAnulacionesConCuota(
            presupuestosSheets,
            config,
            db,
            state,
            onProgress
        );
        
        state.metrics.presupuestosActualizados += anulados;
        console.log(`[SYNC-QUOTA-SAFE] ✅ Anulados: ${anulados}`);
        
        // FASE 2: PUSH CAMBIOS LOCALES
        state.startOperation('Sincronización Bidireccional', 'PUSH Cambios Locales');
        console.log('[SYNC-QUOTA-SAFE] === FASE 2: PUSH CAMBIOS LOCALES ===');
        
        // Releer después de anulaciones
        const presupuestosActualizados = await readSheetWithHeaders(config.hoja_id, 'A:P', 'Presupuestos');
        
        const { insertados, modificados } = await pushCambiosLocalesConCuota(
            presupuestosActualizados,
            config,
            db,
            state,
            onProgress
        );
        
        state.metrics.presupuestosInsertados += insertados.size;
        state.metrics.presupuestosActualizados += modificados.size;
        
        console.log(`[SYNC-QUOTA-SAFE] ✅ Insertados: ${insertados.size}, Modificados: ${modificados.size}`);
        
        // FASE 3: PUSH DETALLES
        state.startOperation('Sincronización Bidireccional', 'PUSH Detalles');
        console.log('[SYNC-QUOTA-SAFE] === FASE 3: PUSH DETALLES ===');
        
        const idsParaSincronizar = new Set([...insertados, ...modificados]);
        
        if (idsParaSincronizar.size > 0) {
            const detallesSincronizados = await pushDetallesConCuota(
                idsParaSincronizar,
                config,
                db,
                state,
                onProgress
            );
            
            state.metrics.detallesInsertados += detallesSincronizados;
            console.log(`[SYNC-QUOTA-SAFE] ✅ Detalles sincronizados: ${detallesSincronizados}`);
        }
        
        // FASE 4: PULL CAMBIOS REMOTOS
        state.startOperation('Sincronización Bidireccional', 'PULL Cambios Remotos');
        console.log('[SYNC-QUOTA-SAFE] === FASE 4: PULL CAMBIOS REMOTOS ===');
        
        // Releer Sheets después de todos los pushes
        const [presupuestosFinales, detallesFinales] = await Promise.all([
            readSheetWithHeaders(config.hoja_id, 'A:P', 'Presupuestos'),
            readSheetWithHeaders(config.hoja_id, 'A:Q', 'DetallesPresupuestos')
        ]);
        
        const pullResult = await pullCambiosRemotosConCuota(
            presupuestosFinales,
            detallesFinales,
            config,
            db,
            idsParaSincronizar, // Excluir IDs ya modificados localmente
            state,
            onProgress
        );
        
        state.metrics.presupuestosInsertados += pullResult.recibidos;
        state.metrics.presupuestosActualizados += pullResult.actualizados;
        state.metrics.omitidosPorCutoff += pullResult.omitidosPorCutoff || 0;
        
        console.log(`[SYNC-QUOTA-SAFE] ✅ PULL: ${pullResult.recibidos} recibidos, ${pullResult.actualizados} actualizados`);
        
        // PASO FINAL: Actualizar cutoff_at
        const nuevoCutoff = new Date();
        await db.query(`
            UPDATE presupuestos_config 
            SET cutoff_at = $1
            WHERE activo = true
        `, [nuevoCutoff]);
        
        console.log('[SYNC-QUOTA-SAFE] ✅ cutoff_at actualizado a:', nuevoCutoff.toISOString());
        
        // Retornar resumen
        const summary = state.completeOperation(true);
        summary.cutoffAtActualizado = nuevoCutoff.toISOString();
        
        return summary;
        
    } catch (error) {
        console.error('[SYNC-QUOTA-SAFE] ❌ Error en sincronización:', error.message);
        state.addError(error);
        
        return state.completeOperation(false);
    }
}

/**
 * FASE 1: Push anulaciones locales a Sheets con cuota
 */
async function pushAnulacionesConCuota(presupuestosData, config, db, state, onProgress) {
    console.log('[PUSH-ANULACIONES] Buscando presupuestos anulados localmente...');
    
    const cutoffAt = config.cutoff_at;
    
    const rs = await db.query(`
        SELECT id_presupuesto_ext, fecha_actualizacion
        FROM public.presupuestos
        WHERE activo = false 
          AND COALESCE(id_presupuesto_ext,'') <> ''
          AND fecha_actualizacion >= $1
        ORDER BY fecha_actualizacion DESC
    `, [cutoffAt]);
    
    if (rs.rowCount === 0) {
        console.log('[PUSH-ANULACIONES] No hay presupuestos anulados para procesar');
        return 0;
    }
    
    console.log(`[PUSH-ANULACIONES] Encontrados ${rs.rowCount} presupuestos anulados`);
    
    // Crear mapa de filas en Sheets
    const rowById = new Map();
    presupuestosData.rows.forEach((r, i) => {
        const id = String(r[presupuestosData.headers[0]] || '').trim();
        if (id) {
            rowById.set(id, {
                rowIndex: i + 2,
                lastModified: r[presupuestosData.headers[13]],
                activo: r[presupuestosData.headers[14]]
            });
        }
    });
    
    // Preparar actualizaciones en lotes
    const anulaciones = [];
    
    for (const { id_presupuesto_ext, fecha_actualizacion } of rs.rows) {
        const id = String(id_presupuesto_ext).trim();
        const sheetData = rowById.get(id);
        
        if (!sheetData) continue;
        
        // Verificar si ya está anulado en Sheets
        const activoEnSheet = String(sheetData.activo || '').toLowerCase();
        if (activoEnSheet === 'false' || activoEnSheet === '0') {
            continue;
        }
        
        // Verificar LWW
        const localTimestamp = new Date(fecha_actualizacion);
        const sheetTimestamp = parseLastModified(sheetData.lastModified);
        
        if (sheetTimestamp > localTimestamp) {
            console.log(`[PUSH-ANULACIONES] Omitiendo ${id} - SHEET más reciente`);
            continue;
        }
        
        anulaciones.push({
            id,
            rowIndex: sheetData.rowIndex
        });
    }
    
    if (anulaciones.length === 0) {
        console.log('[PUSH-ANULACIONES] No hay anulaciones para aplicar');
        return 0;
    }
    
    // Procesar anulaciones en lotes con quota manager
    const { getSheets } = require('../../google/gsheetsClient');
    const sheets = await getSheets();
    const now = toSheetDateTimeAR(Date.now());
    
    const batchResult = await quotaManager.processBatch(
        anulaciones,
        async (item) => {
            // Preparar actualizaciones: Activo=false, Estado=Anulado, LastModified=now
            const data = [
                { range: `Presupuestos!O${item.rowIndex}:O${item.rowIndex}`, values: [[false]] },
                { range: `Presupuestos!H${item.rowIndex}:H${item.rowIndex}`, values: [['Anulado']] },
                { range: `Presupuestos!N${item.rowIndex}:N${item.rowIndex}`, values: [[now]] }
            ];
            
            await sheets.spreadsheets.values.batchUpdate({
                spreadsheetId: config.hoja_id,
                requestBody: { valueInputOption: 'USER_ENTERED', data }
            });
            
            console.log(`[PUSH-ANULACIONES] ✅ Anulado: ${item.id}`);
            return item.id;
        },
        {
            batchSize: 5,
            operationName: 'anular_presupuesto',
            onProgress: onProgress ? async (progress) => {
                state.updateProgress(progress);
                await onProgress({
                    fase: 'PUSH Anulaciones',
                    ...progress,
                    mensaje: `Anulando presupuestos (Lote ${progress.currentBatch}/${progress.totalBatches})`
                });
            } : null
        }
    );
    
    state.metrics.reintentos += quotaManager.getStats().totalRetries;
    
    return batchResult.success.length;
}

/**
 * FASE 2: Push cambios locales (nuevos + modificados) con cuota
 */
async function pushCambiosLocalesConCuota(presupuestosData, config, db, state, onProgress) {
    console.log('[PUSH-CAMBIOS] Detectando cambios locales...');
    
    const cutoffAt = config.cutoff_at;
    
    // Crear mapa de presupuestos remotos
    const remoteById = new Map();
    presupuestosData.rows.forEach((row, i) => {
        const id = String(row[presupuestosData.headers[0]] || '').trim();
        if (id) {
            remoteById.set(id, {
                row,
                rowIndex: i + 2,
                lastModified: row[presupuestosData.headers[13]]
            });
        }
    });
    
    // Obtener presupuestos locales modificados (detectar cambios en encabezado Y detalles)
    const rs = await db.query(`
        SELECT DISTINCT 
            p.id_presupuesto_ext, p.id_cliente, p.agente, p.fecha, p.fecha_entrega, 
            p.tipo_comprobante, p.nota, p.estado, p.informe_generado, p.cliente_nuevo_id, 
            p.punto_entrega, p.descuento, p.secuencia, p.activo, p.fecha_actualizacion,
            CASE WHEN MAX(d.fecha_actualizacion) >= $1 THEN true ELSE false END as tiene_detalles_modificados
        FROM presupuestos p
        LEFT JOIN presupuestos_detalles d ON d.id_presupuesto_ext = p.id_presupuesto_ext
        WHERE p.activo = true 
          AND (
            p.fecha_actualizacion >= $1
            OR d.fecha_actualizacion >= $1
          )
        GROUP BY p.id, p.id_presupuesto_ext, p.id_cliente, p.agente, p.fecha, p.fecha_entrega, 
                 p.tipo_comprobante, p.nota, p.estado, p.informe_generado, p.cliente_nuevo_id, 
                 p.punto_entrega, p.descuento, p.secuencia, p.activo, p.fecha_actualizacion
    `, [cutoffAt]);
    
    console.log(`[PUSH-CAMBIOS] Encontrados ${rs.rowCount} presupuestos con cambios`);
    
    // Clasificar: nuevos vs modificados vs sin cambios
    const nuevos = [];
    const modificados = [];
    let sinCambios = 0;
    
    for (const local of rs.rows) {
        const id = local.id_presupuesto_ext;
        const remote = remoteById.get(id);
        
        if (!remote) {
            // No existe en Sheets → NUEVO
            nuevos.push(local);
        } else {
            // Existe → verificar LWW y cambios reales (encabezado O detalles)
            const localTimestamp = new Date(local.fecha_actualizacion);
            const remoteTimestamp = parseLastModified(remote.lastModified);
            
            if (localTimestamp > remoteTimestamp) {
                // Local más reciente → verificar cambios reales en encabezado O detalles
                const cambioEnEncabezado = hasPresupuestoChanged(local, remote.row, presupuestosData.headers);
                const cambioEnDetalles = local.tiene_detalles_modificados;
                
                if (cambioEnEncabezado || cambioEnDetalles) {
                    modificados.push({ ...local, _rowIndex: remote.rowIndex });
                    console.log(`[PUSH-CAMBIOS] ✅ ${id} será sincronizado - Encabezado: ${cambioEnEncabezado}, Detalles: ${cambioEnDetalles}`);
                } else {
                    sinCambios++;
                }
            } else {
                sinCambios++;
            }
        }
    }
    
    console.log(`[PUSH-CAMBIOS] Nuevos: ${nuevos.length}, Modificados: ${modificados.length}, Sin cambios: ${sinCambios}`);
    
    state.metrics.omitidosPorSinCambios += sinCambios;
    
    const { getSheets } = require('../../google/gsheetsClient');
    const sheets = await getSheets();
    
    // Procesar NUEVOS con quota manager
    const insertadosSet = new Set();
    
    if (nuevos.length > 0) {
        console.log(`[PUSH-CAMBIOS] Insertando ${nuevos.length} presupuestos nuevos...`);
        
        const batchResult = await quotaManager.processBatch(
            nuevos,
            async (local) => {
                const pct = local.descuento == null ? null : Number(local.descuento);
                const pctStr = pct == null ? '' : (pct > 1 ? `${pct}%` : `${pct*100}%`);
                const lastModifiedAR = toSheetDateTimeAR(local.fecha_actualizacion || Date.now());
                
                const row = [
                    (local.id_presupuesto_ext || '').toString().trim(),
                    toSheetDate(local.fecha),
                    local.id_cliente || '',
                    local.agente || '',
                    toSheetDate(local.fecha_entrega),
                    local.tipo_comprobante || '',
                    local.nota || '',
                    local.estado || '',
                    local.informe_generado || '',
                    local.cliente_nuevo_id || '',
                    '',
                    local.punto_entrega || '',
                    pctStr,
                    lastModifiedAR,
                    true,
                    local.secuencia || ''
                ];
                
                await sheets.spreadsheets.values.append({
                    spreadsheetId: config.hoja_id,
                    range: 'Presupuestos!A1:P1',
                    valueInputOption: 'RAW',
                    insertDataOption: 'INSERT_ROWS',
                    requestBody: { values: [row], majorDimension: 'ROWS' }
                });
                
                console.log(`[PUSH-CAMBIOS] ✅ INSERT: ${local.id_presupuesto_ext}`);
                return local.id_presupuesto_ext;
            },
            {
                batchSize: 10,
                operationName: 'insertar_presupuesto',
                onProgress: onProgress ? async (progress) => {
                    state.updateProgress(progress);
                    await onProgress({
                        fase: 'PUSH Nuevos',
                        ...progress,
                        mensaje: `Insertando presupuestos nuevos (Lote ${progress.currentBatch}/${progress.totalBatches})`
                    });
                } : null
            }
        );
        
        batchResult.success.forEach(item => insertadosSet.add(item.result));
        state.metrics.reintentos += quotaManager.getStats().totalRetries;
    }
    
    // Procesar MODIFICADOS con quota manager
    const modificadosSet = new Set();
    
    if (modificados.length > 0) {
        console.log(`[PUSH-CAMBIOS] Actualizando ${modificados.length} presupuestos modificados...`);
        
        const batchResult = await quotaManager.processBatch(
            modificados,
            async (local) => {
                const pct = local.descuento == null ? null : Number(local.descuento);
                const pctStr = pct == null ? '' : (pct > 1 ? `${pct}%` : `${pct*100}%`);
                const lastModifiedAR = toSheetDateTimeAR(local.fecha_actualizacion || Date.now());
                
                const row = [
                    (local.id_presupuesto_ext || '').toString().trim(),
                    toSheetDate(local.fecha),
                    local.id_cliente || '',
                    local.agente || '',
                    toSheetDate(local.fecha_entrega),
                    local.tipo_comprobante || '',
                    local.nota || '',
                    local.estado || '',
                    local.informe_generado || '',
                    local.cliente_nuevo_id || '',
                    '',
                    local.punto_entrega || '',
                    pctStr,
                    lastModifiedAR,
                    true,
                    local.secuencia || ''
                ];
                
                await sheets.spreadsheets.values.update({
                    spreadsheetId: config.hoja_id,
                    range: `Presupuestos!A${local._rowIndex}:P${local._rowIndex}`,
                    valueInputOption: 'RAW',
                    requestBody: { values: [row], majorDimension: 'ROWS' }
                });
                
                console.log(`[PUSH-CAMBIOS] ✅ UPDATE: ${local.id_presupuesto_ext}`);
                return local.id_presupuesto_ext;
            },
            {
                batchSize: 10,
                operationName: 'actualizar_presupuesto',
                onProgress: onProgress ? async (progress) => {
                    state.updateProgress(progress);
                    await onProgress({
                        fase: 'PUSH Modificados',
                        ...progress,
                        mensaje: `Actualizando presupuestos (Lote ${progress.currentBatch}/${progress.totalBatches})`
                    });
                } : null
            }
        );
        
        batchResult.success.forEach(item => modificadosSet.add(item.result));
        state.metrics.reintentos += quotaManager.getStats().totalRetries;
    }
    
    return {
        insertados: insertadosSet,
        modificados: modificadosSet
    };
}

/**
 * FASE 3: Push detalles con cuota
 * CORREGIDO: Elimina detalles antiguos antes de insertar para presupuestos modificados
 */
async function pushDetallesConCuota(idsPresupuestos, config, db, state, onProgress) {
    console.log(`[PUSH-DETALLES] Sincronizando detalles para ${idsPresupuestos.size} presupuestos...`);
    
    const { getSheets } = require('../../google/gsheetsClient');
    const sheets = await getSheets();
    const idsPresupuestosArray = Array.from(idsPresupuestos);
    
    // PASO 1: ESTRATEGIA MEJORADA - Eliminar usando API de Sheets con filtro por lotes
    console.log('[PUSH-DETALLES] Eliminando detalles antiguos con estrategia mejorada...');
    
    // 1A. Leer TODOS los detalles actuales (con todas las columnas para identificación precisa)
    const detallesActuales = await sheets.spreadsheets.values.get({
        spreadsheetId: config.hoja_id,
        range: 'DetallesPresupuestos!A:Q'
    });
    
    const filasAEliminar = [];
    const detallesPorPresupuesto = new Map();
    
    if (detallesActuales.data.values && detallesActuales.data.values.length > 1) {
        // Identificar índice de columna IdPresupuesto (normalmente columna B, índice 1)
        const headers = detallesActuales.data.values[0];
        const idxIdPresup = headers.findIndex(h => {
            const normalized = (h || '').toString().toLowerCase().replace(/\s+/g, '');
            return normalized.includes('idpresupuesto') || normalized === 'idpresupuesto';
        });
        
        if (idxIdPresup === -1) {
            console.error('[PUSH-DETALLES] ❌ No se encontró columna IdPresupuesto');
            return 0;
        }
        
        console.log(`[PUSH-DETALLES] Columna IdPresupuesto encontrada en índice: ${idxIdPresup}`);
        
        // Procesar filas (empezando desde índice 1, saltando header)
        for (let i = 1; i < detallesActuales.data.values.length; i++) {
            const row = detallesActuales.data.values[i];
            const idPresup = (row[idxIdPresup] || '').toString().trim();
            
            if (idPresup && idsPresupuestosArray.includes(idPresup)) {
                filasAEliminar.push(i + 1); // +1 para convertir a 1-based (fila en Sheet)
                
                // Agrupar para log
                if (!detallesPorPresupuesto.has(idPresup)) {
                    detallesPorPresupuesto.set(idPresup, []);
                }
                detallesPorPresupuesto.get(idPresup).push(i + 1);
            }
        }
    }
    
    console.log(`[PUSH-DETALLES] Detalles a eliminar: ${filasAEliminar.length} filas`);
    detallesPorPresupuesto.forEach((filas, idPresup) => {
        console.log(`[PUSH-DETALLES]   - Presupuesto ${idPresup}: ${filas.length} detalles`);
    });
    
    // PASO 2: Eliminar filas antiguas en lotes (de abajo hacia arriba)
    if (filasAEliminar.length > 0) {
        const filasOrdenadas = filasAEliminar.sort((a, b) => b - a);
        const loteSize = 5;
        
        for (let i = 0; i < filasOrdenadas.length; i += loteSize) {
            const lote = filasOrdenadas.slice(i, i + loteSize);
            
            const batchResult = await quotaManager.processBatch(
                lote,
                async (fila) => {
                    // Obtener sheetId correcto para DetallesPresupuestos
                    const spreadsheet = await sheets.spreadsheets.get({
                        spreadsheetId: config.hoja_id
                    });
                    
                    const detallesSheet = spreadsheet.data.sheets.find(s => 
                        s.properties.title === 'DetallesPresupuestos'
                    );
                    
                    if (!detallesSheet) {
                        throw new Error('No se encontró la hoja DetallesPresupuestos');
                    }
                    
                    const sheetId = detallesSheet.properties.sheetId;
                    
                    await sheets.spreadsheets.batchUpdate({
                        spreadsheetId: config.hoja_id,
                        requestBody: {
                            requests: [{
                                deleteDimension: {
                                    range: {
                                        sheetId: sheetId,
                                        dimension: 'ROWS',
                                        startIndex: fila - 1, // CORRECCIÓN: convertir de 1-based a 0-based
                                        endIndex: fila // CORRECCIÓN: endIndex es exclusivo, entonces fila (sin -1)
                                    }
                                }
                            }]
                        }
                    });
                    
                    return fila;
                },
                {
                    batchSize: 5,
                    operationName: 'eliminar_detalle',
                    onProgress: onProgress ? async (progress) => {
                        state.updateProgress(progress);
                        await onProgress({
                            fase: 'PUSH Detalles - Eliminando antiguos',
                            ...progress,
                            mensaje: `Eliminando detalles antiguos (Lote ${progress.currentBatch}/${progress.totalBatches})`
                        });
                    } : null
                }
            );
            
            console.log(`[PUSH-DETALLES] ✅ Eliminadas ${batchResult.success.length} filas (lote ${Math.floor(i/loteSize) + 1})`);
        }
        
        state.metrics.detallesBorrados += filasAEliminar.length;
        console.log(`[PUSH-DETALLES] ✅ Total eliminadas: ${filasAEliminar.length} filas`);
    }
    
    // PASO 3: Obtener detalles de BD
    const rs = await db.query(`
        SELECT d.id, d.id_presupuesto_ext, d.articulo, d.cantidad, d.valor1, d.precio1,
               d.iva1, d.diferencia, d.camp1, d.camp2, d.camp3, d.camp4, d.camp5, d.camp6
        FROM public.presupuestos_detalles d
        WHERE d.id_presupuesto_ext = ANY($1)
        ORDER BY d.id_presupuesto_ext, d.id
    `, [idsPresupuestosArray]);
    
    if (rs.rowCount === 0) {
        console.log('[PUSH-DETALLES] No hay detalles para sincronizar');
        return 0;
    }
    
    console.log(`[PUSH-DETALLES] Sincronizando ${rs.rowCount} detalles...`);
    
    // PASO 4: Preparar detalles con MAP
    const detallesParaInsertar = [];
    
    for (const r of rs.rows) {
        // Generar o recuperar ID del MAP
        const existingMap = await db.query(`
            SELECT id_detalle_presupuesto 
            FROM public.presupuestos_detalles_map 
            WHERE local_detalle_id = $1
        `, [r.id]);
        
        let idDetalle;
        if (existingMap.rowCount > 0) {
            idDetalle = existingMap.rows[0].id_detalle_presupuesto;
        } else {
            // Generar nuevo ID
            const timestamp = Date.now() + Math.random() * 1000;
            const hash = crypto.createHash('sha1')
                .update(`${r.id_presupuesto_ext}|${r.articulo}|${r.cantidad}|${r.valor1}|${r.precio1}|${r.iva1}|${timestamp}`)
                .digest('hex');
            idDetalle = `${hash.slice(0, 8)}-${hash.slice(8, 12)}`;
            
            // Crear MAP
            await db.query(`
                INSERT INTO public.presupuestos_detalles_map
                (local_detalle_id, id_detalle_presupuesto, fuente, fecha_asignacion)
                VALUES ($1, $2, 'Local', CURRENT_TIMESTAMP AT TIME ZONE 'America/Argentina/Buenos_Aires')
                ON CONFLICT (local_detalle_id) DO UPDATE
                SET id_detalle_presupuesto = EXCLUDED.id_detalle_presupuesto,
                    fuente = 'Local',
                    fecha_asignacion = EXCLUDED.fecha_asignacion
            `, [r.id, idDetalle]);
        }
        
        detallesParaInsertar.push({ ...r, _idDetalle: idDetalle });
    }
    
    console.log(`[PUSH-DETALLES] Detalles a insertar: ${detallesParaInsertar.length}`);
    
    if (detallesParaInsertar.length === 0) {
        return 0;
    }
    
    // Insertar detalles en lotes con quota manager
    const num2 = v => (v == null || v === '') ? '' : Math.round(Number(v) * 100) / 100;
    const num3 = v => (v == null || v === '') ? '' : Math.round(Number(v) * 1000) / 1000;
    const asText = v => (v == null) ? '' : String(v).trim();
    const nowAR = toSheetDateTimeAR(Date.now());
    
    const batchResult = await quotaManager.processBatch(
        detallesParaInsertar,
        async (r) => {
            const row = [
                r._idDetalle,
                asText(r.id_presupuesto_ext),
                asText(r.articulo),
                num2(r.cantidad),
                num2(r.valor1),
                num2(r.precio1),
                num2(r.iva1),
                num2(r.diferencia),
                num2(r.camp1),
                num2(r.precio1),
                num3(r.camp2),
                num2(r.camp3),
                num2(r.camp4),
                num2(r.camp5),
                asText(r.camp6),
                nowAR,
                true
            ];
            
            await sheets.spreadsheets.values.append({
                spreadsheetId: config.hoja_id,
                range: 'DetallesPresupuestos!A1:Q1',
                valueInputOption: 'RAW',
                insertDataOption: 'INSERT_ROWS',
                requestBody: { values: [row], majorDimension: 'ROWS' }
            });
            
            return r._idDetalle;
        },
        {
            batchSize: 10,
            operationName: 'insertar_detalle',
            onProgress: onProgress ? async (progress) => {
                state.updateProgress(progress);
                await onProgress({
                    fase: 'PUSH Detalles',
                    ...progress,
                    mensaje: `Insertando detalles (Lote ${progress.currentBatch}/${progress.totalBatches})`
                });
            } : null
        }
    );
    
    state.metrics.reintentos += quotaManager.getStats().totalRetries;
    
    return batchResult.success.length;
}

/**
 * FASE 4: Pull cambios remotos con cuota
 * CORREGIDO: Sincroniza tanto encabezados como detalles
 */
async function pullCambiosRemotosConCuota(presupuestosSheets, detallesSheets, config, db, idsExcluidos, state, onProgress) {
    console.log('[PULL-CAMBIOS] Detectando cambios remotos...');
    
    const cutoffAt = config.cutoff_at;
    let recibidos = 0;
    let actualizados = 0;
    let omitidos = 0;
    let omitidosPorCutoff = 0;
    
    // Crear mapa de timestamps locales
    const localTimestamps = new Map();
    const rsLocal = await db.query(`
        SELECT id_presupuesto_ext, fecha_actualizacion, activo
        FROM public.presupuestos
    `);
    
    rsLocal.rows.forEach(row => {
        const id = (row.id_presupuesto_ext || '').toString().trim();
        const timestamp = new Date(row.fecha_actualizacion || 0);
        localTimestamps.set(id, { timestamp, activo: row.activo });
    });
    
    // Candidatos para pull
    const candidatos = [];
    const idsCambiadosSet = new Set();
    
    for (const row of presupuestosSheets.rows) {
        const id = (row[presupuestosSheets.headers[0]] || '').toString().trim();
        const sheetLastModified = row[presupuestosSheets.headers[13]];
        
        if (!id || !sheetLastModified) continue;
        
        // Excluir IDs modificados localmente
        if (idsExcluidos.has(id)) {
            omitidos++;
            continue;
        }
        
        const sheetTimestamp = parseLastModified(sheetLastModified);
        
        // Filtro cutoff_at
        if (sheetTimestamp <= cutoffAt) {
            omitidosPorCutoff++;
            continue;
        }
        
        const localData = localTimestamps.get(id);
        
        if (!localData) {
            // No existe localmente → NUEVO
            const activoValue = row[presupuestosSheets.headers[14]];
            const esInactivo = String(activoValue || '').toLowerCase() === 'false';
            
            if (!esInactivo) {
                candidatos.push({ row, action: 'insert', id });
                idsCambiadosSet.add(id);
            }
        } else if (localData.activo && sheetTimestamp > localData.timestamp) {
            // Existe y es más reciente → UPDATE
            candidatos.push({ row, action: 'update', id });
            idsCambiadosSet.add(id);
        } else {
            omitidos++;
        }
    }
    
    console.log(`[PULL-CAMBIOS] Candidatos: ${candidatos.length} (omitidos: ${omitidos}, por cutoff: ${omitidosPorCutoff})`);
    
    // No hay candidatos, retornar temprano
    if (candidatos.length === 0) {
        return { recibidos, actualizados, omitidos, omitidosPorCutoff };
    }
    
    // PASO 1: Procesar ENCABEZADOS (no usa quota porque son operaciones de BD local)
    for (const candidato of candidatos) {
        try {
            const presupuesto = procesarPresupuestoDesdeSheet(candidato.row, presupuestosSheets.headers);
            
            if (candidato.action === 'insert') {
                await insertarPresupuestoLocal(presupuesto, db);
                recibidos++;
                console.log(`[PULL-CAMBIOS] ✅ NUEVO encabezado: ${candidato.id}`);
            } else {
                await actualizarPresupuestoLocal(presupuesto, db);
                actualizados++;
                console.log(`[PULL-CAMBIOS] ✅ ACTUALIZADO encabezado: ${candidato.id}`);
            }
        } catch (error) {
            console.error('[PULL-CAMBIOS] Error procesando candidato:', error.message);
            state.addError(error, { id: candidato.id });
        }
    }
    
    console.log(`[PULL-CAMBIOS] ✅ Encabezados - Recibidos: ${recibidos}, Actualizados: ${actualizados}`);
    
    // PASO 2: Sincronizar DETALLES para presupuestos cambiados
    if (idsCambiadosSet.size > 0) {
        console.log(`[PULL-CAMBIOS] 🔄 Sincronizando detalles para ${idsCambiadosSet.size} presupuestos...`);
        console.log(`[PULL-CAMBIOS] IDs a sincronizar: ${Array.from(idsCambiadosSet).join(', ')}`);
        console.log(`[PULL-CAMBIOS] Total filas en DetallesPresupuestos: ${detallesSheets.rows.length}`);
        
        try {
            await pullDetallesDesdeSheets(detallesSheets, idsCambiadosSet, db, state);
            console.log(`[PULL-CAMBIOS] ✅ Detalles sincronizados para ${idsCambiadosSet.size} presupuestos`);
        } catch (error) {
            console.error('[PULL-CAMBIOS] ❌ Error sincronizando detalles:', error.message);
            console.error('[PULL-CAMBIOS] Stack trace:', error.stack);
            state.addError(error, { fase: 'pull_detalles' });
        }
    } else {
        console.log('[PULL-CAMBIOS] ⚠️ No hay presupuestos cambiados para sincronizar detalles');
    }
    
    return { recibidos, actualizados, omitidos, omitidosPorCutoff };
}

/**
 * Pull detalles desde Sheets para presupuestos específicos
 * Sincroniza: DELETE local + INSERT desde Sheets con MAP
 */
async function pullDetallesDesdeSheets(detallesSheets, idsPresupuestos, db, state) {
    console.log(`[PULL-DETALLES] Sincronizando detalles para ${idsPresupuestos.size} presupuestos...`);
    
    if (!detallesSheets || !detallesSheets.headers || !Array.isArray(detallesSheets.rows)) {
        console.warn('[PULL-DETALLES] ⚠️ Dataset de detalles inválido');
        return;
    }
    
    // Función para normalizar nombres de columnas
    const normalizeColumnName = (s) => {
        return (s || '').toString()
            .normalize('NFD')
            .replace(/[\u0300-\u036f]/g, '')
            .replace(/\s+/g, '')
            .toLowerCase();
    };
    
    // Crear mapa de encabezados
    const headerMap = new Map();
    detallesSheets.headers.forEach((name, i) => {
        headerMap.set(normalizeColumnName(name), i);
    });
    
    // Buscar columnas críticas
    const findColumnIndex = (...candidates) => {
        for (const candidate of candidates) {
            const normalized = normalizeColumnName(candidate);
            const index = headerMap.get(normalized);
            if (index !== undefined) {
                return index;
            }
        }
        return -1;
    };
    
    const idx = {
        idDetalle: findColumnIndex('IDDetallePresupuesto', 'IdDetallePresupuesto', 'ID Detalle Presupuesto'),
        idPresup: findColumnIndex('IDPresupuesto', 'IdPresupuesto', 'ID Presupuesto'),
        art: findColumnIndex('Articulo', 'Artículo', 'Article'),
        cant: findColumnIndex('Cantidad', 'Cant', 'Quantity'),
        valor1: findColumnIndex('Valor1', 'Valor 1', 'Valor'),
        precio1: findColumnIndex('Precio1', 'Precio 1', 'Precio'),
        iva1: findColumnIndex('IVA1', 'IVA 1', 'IVA'),
        diferencia: findColumnIndex('Diferencia', 'Diff'),
        camp1: findColumnIndex('Camp1', 'Camp 1'),
        camp2: findColumnIndex('Camp3', 'Camp 3'),
        camp3: findColumnIndex('Camp4', 'Camp 4'),
        camp4: findColumnIndex('Camp5', 'Camp 5'),
        camp5: findColumnIndex('Camp6', 'Camp 6'),
        camp6: findColumnIndex('Condicion', 'Condición')
    };
    
    console.log('[PULL-DETALLES] Índices de columnas:', idx);
    
    // Validar columnas críticas
    if (idx.idPresup === -1 || idx.art === -1) {
        console.error('[PULL-DETALLES] ❌ Columnas críticas faltantes');
        return;
    }
    
    const toNumber = (x) => {
        if (x === null || x === undefined || x === '') return null;
        const s = String(x).replace('%', '').replace(',', '.').trim();
        if (s === '') return null;
        const n = parseFloat(s);
        return Number.isFinite(n) ? n : null;
    };
    
    const cell = (row, index) => {
        if (index === -1) return null;
        return Array.isArray(row) ? row?.[index] : row?.[detallesSheets.headers[index]];
    };
    
    // Filtrar detalles relevantes
    const detallesParaSincronizar = [];
    const idsArray = Array.from(idsPresupuestos);
    
    detallesSheets.rows.forEach((row, i) => {
        const idPresup = String(cell(row, idx.idPresup) || '').trim();
        
        if (idsArray.includes(idPresup)) {
            const articulo = String(cell(row, idx.art) || '').trim();
            
            if (articulo) {
                detallesParaSincronizar.push({ row, idPresup, articulo });
            }
        }
    });
    
    console.log(`[PULL-DETALLES] Detalles encontrados en Sheets: ${detallesParaSincronizar.length}`);
    
    if (detallesParaSincronizar.length === 0) {
        console.log('[PULL-DETALLES] ⚠️ No hay detalles en Sheets para los presupuestos indicados');
        return;
    }
    
    // Ejecutar en transacción: DELETE + INSERT
    await db.query('BEGIN');
    
    try {
        // PASO 1: Eliminar detalles locales existentes
        const deleteResult = await db.query(`
            DELETE FROM public.presupuestos_detalles
            WHERE id_presupuesto_ext = ANY($1::text[])
        `, [idsArray]);
        
        console.log(`[PULL-DETALLES] 🗑️ Eliminados ${deleteResult.rowCount} detalles locales`);
        state.metrics.detallesBorrados += deleteResult.rowCount;
        
        // PASO 2: Insertar detalles desde Sheets
        let insertados = 0;
        
        for (const { row, idPresup, articulo } of detallesParaSincronizar) {
            try {
                // Obtener id_presupuesto local (FK)
                const presupLocal = await db.query(`
                    SELECT id FROM public.presupuestos 
                    WHERE id_presupuesto_ext = $1
                `, [idPresup]);
                
                if (presupLocal.rowCount === 0) {
                    console.warn(`[PULL-DETALLES] ⚠️ Presupuesto local no encontrado: ${idPresup}`);
                    continue;
                }
                
                const idPresupuestoLocal = presupLocal.rows[0].id;
                
                // Extraer valores con manejo seguro de nulos
                const n = (k) => toNumber(cell(row, k));
                const cantidad = n(idx.cant) ?? 0;
                const valor1 = n(idx.valor1) ?? 0;
                const precio1 = n(idx.precio1) ?? 0;
                const iva1 = n(idx.iva1) ?? 0;
                const diferencia = n(idx.diferencia) ?? 0;
                const camp1 = n(idx.camp1);
                const camp2 = n(idx.camp2);
                const camp3 = n(idx.camp3);
                const camp4 = n(idx.camp4);
                const camp5 = n(idx.camp5);
                const camp6Val = cell(row, idx.camp6);
                const camp6 = camp6Val !== null && camp6Val !== undefined ? String(camp6Val).trim() : null;
                
                // Obtener ID del detalle desde Sheets
                const idDetalleSheets = idx.idDetalle !== -1 ? 
                    String(cell(row, idx.idDetalle) || '').trim() : 
                    '';
                
                // Insertar detalle en local
                const insertResult = await db.query(`
                    INSERT INTO public.presupuestos_detalles
                    (id_presupuesto, id_presupuesto_ext, articulo, cantidad, valor1, precio1, iva1, diferencia,
                     camp1, camp2, camp3, camp4, camp5, camp6, fecha_actualizacion)
                    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, NOW())
                    RETURNING id
                `, [idPresupuestoLocal, idPresup, articulo, cantidad, valor1, precio1, iva1, diferencia,
                    camp1, camp2, camp3, camp4, camp5, camp6]);
                
                const localDetalleId = insertResult.rows[0].id;
                
                // Crear MAP solo si hay ID de Sheets válido
                if (idDetalleSheets) {
                    await db.query(`
                        INSERT INTO public.presupuestos_detalles_map 
                        (local_detalle_id, id_detalle_presupuesto, fuente, fecha_asignacion)
                        VALUES ($1, $2, 'AppSheet', CURRENT_TIMESTAMP AT TIME ZONE 'America/Argentina/Buenos_Aires')
                        ON CONFLICT (local_detalle_id) DO UPDATE
                        SET id_detalle_presupuesto = EXCLUDED.id_detalle_presupuesto,
                            fuente = 'AppSheet',
                            fecha_asignacion = EXCLUDED.fecha_asignacion
                    `, [localDetalleId, idDetalleSheets]);
                }
                
                insertados++;
                
                if (insertados <= 5) {
                    console.log(`[PULL-DETALLES] ✅ Detalle ${insertados}: ${idPresup} - ${articulo}`);
                }
                
            } catch (insertError) {
                console.error(`[PULL-DETALLES] ❌ Error insertando detalle:`, insertError.message);
                state.addError(insertError, { idPresup, articulo });
            }
        }
        
        await db.query('COMMIT');
        
        console.log(`[PULL-DETALLES] ✅ Insertados ${insertados} detalles`);
        state.metrics.detallesInsertados += insertados;
        
        // 📸 ACTUALIZAR SNAPSHOTS para presupuestos sincronizados (después del COMMIT)
        console.log(`[SNAPSHOT-MOD-SYNC] Iniciando actualización de snapshots para ${idsPresupuestos.size} presupuestos sincronizados...`);
        
        for (const id_presupuesto_ext of idsPresupuestos) {
            try {
                // Obtener id_presupuesto local
                const presupLocal = await db.query(`
                    SELECT id FROM public.presupuestos 
                    WHERE id_presupuesto_ext = $1 AND activo = true
                `, [id_presupuesto_ext]);
                
                if (presupLocal.rowCount === 0) {
                    console.log(`[SNAPSHOT-MOD-SYNC] ⚠️ Presupuesto no encontrado: ${id_presupuesto_ext}`);
                    continue;
                }
                
                const id_presupuesto = presupLocal.rows[0].id;
                
                // Reutilizar la misma función que usa la edición local
                const { actualizarSnapshotConDiferencias } = require('../../presupuestos/services/snapshotService');
                
                const resultadoSnapshot = await actualizarSnapshotConDiferencias(
                    id_presupuesto,
                    id_presupuesto_ext,
                    db
                );
                
                if (resultadoSnapshot.success && resultadoSnapshot.hasSnapshot && resultadoSnapshot.hasDifferences) {
                    console.log(`✅ [SNAPSHOT-MOD-SYNC] Snapshot actualizado para ${id_presupuesto_ext}`);
                    console.log(`📸 [SNAPSHOT-MOD-SYNC] Diferencias: ${resultadoSnapshot.diferencias_count}, Número impresión: ${resultadoSnapshot.numero_impresion}`);
                } else if (resultadoSnapshot.success && resultadoSnapshot.hasSnapshot && !resultadoSnapshot.hasDifferences) {
                    console.log(`ℹ️ [SNAPSHOT-MOD-SYNC] Presupuesto ${id_presupuesto_ext} sin cambios respecto al snapshot`);
                } else if (resultadoSnapshot.success && !resultadoSnapshot.hasSnapshot) {
                    console.log(`ℹ️ [SNAPSHOT-MOD-SYNC] Presupuesto ${id_presupuesto_ext} no tiene snapshot activo, SYNC no modifica snapshots`);
                } else {
                    console.error(`❌ [SNAPSHOT-MOD-SYNC] Error al actualizar snapshot para ${id_presupuesto_ext}: ${resultadoSnapshot.error}`);
                }
                
            } catch (snapshotError) {
                console.error(`❌ [SNAPSHOT-MOD-SYNC] Error en actualización de snapshot para ${id_presupuesto_ext} (no crítico):`, snapshotError.message);
                // No lanzar error - la sincronización debe continuar
            }
        }
        
        console.log(`[SNAPSHOT-MOD-SYNC] Proceso de actualización de snapshots completado`);
        
    } catch (error) {
        await db.query('ROLLBACK');
        console.error('[PULL-DETALLES] ❌ Error en transacción, rollback:', error.message);
        throw error;
    }
}

/**
 * Helpers para procesar presupuestos
 */
function procesarPresupuestoDesdeSheet(row, headers) {
    const activoValue = row[headers[14]];
    let activo = true;
    if (activoValue !== undefined && activoValue !== null && activoValue !== '') {
        const activoStr = activoValue.toString().toLowerCase();
        activo = !(activoStr === 'false' || activoStr === '0');
    }
    
    const lastModifiedValue = row[headers[13]];
    const lastModified = parseLastModified(lastModifiedValue);
    
    return {
        id_presupuesto_ext: (row[headers[0]] || '').toString().trim(),
        id_cliente: (row[headers[2]] || '').toString().trim(),
        fecha: parseDate(row[headers[1]]),
        fecha_entrega: parseDate(row[headers[4]]),
        agente: row[headers[3]] || null,
        tipo_comprobante: row[headers[5]] || null,
        nota: row[headers[6]] || null,
        estado: row[headers[7]] || 'pendiente',
        informe_generado: row[headers[8]] || null,
        cliente_nuevo_id: row[headers[9]] || null,
        punto_entrega: row[headers[11]] || null,
        descuento: parseFloat(row[headers[12]]) || 0,
        activo: activo,
        lastModified: lastModified.toISOString(),
        hoja_nombre: 'Presupuestos',
        hoja_url: null,
        usuario_id: 1
    };
}

async function insertarPresupuestoLocal(presupuesto, db) {
    console.log(`[SYNC-DEBUG] [PULL-CAMBIOS] Insertando NUEVO presupuesto desde Sheets para id_presupuesto_ext=${presupuesto.id_presupuesto_ext}`);
    
    const insertQuery = `
        INSERT INTO presupuestos 
        (id_presupuesto_ext, id_cliente, fecha, fecha_entrega, agente, tipo_comprobante,
         nota, estado, informe_generado, cliente_nuevo_id, punto_entrega, descuento,
         secuencia, activo, fecha_actualizacion, hoja_nombre, hoja_url, usuario_id)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18)
    `;
    
    console.log('[SYNC-DEBUG] [PULL-CAMBIOS] Valores para INSERT nuevo presupuesto:', {
        id_presupuesto_ext: presupuesto.id_presupuesto_ext,
        secuencia_forzada_local: 'Imprimir',
        estado: presupuesto.estado
    });
    
    await db.query(insertQuery, [
        presupuesto.id_presupuesto_ext,
        presupuesto.id_cliente,
        presupuesto.fecha,
        presupuesto.fecha_entrega,
        presupuesto.agente,
        presupuesto.tipo_comprobante,
        presupuesto.nota,
        presupuesto.estado,
        presupuesto.informe_generado,
        presupuesto.cliente_nuevo_id,
        presupuesto.punto_entrega,
        presupuesto.descuento,
        'Imprimir', // FORZAR secuencia = 'Imprimir' cuando viene de Sheets
        presupuesto.activo,
        presupuesto.lastModified,
        presupuesto.hoja_nombre,
        presupuesto.hoja_url,
        presupuesto.usuario_id
    ]);
    
    console.log(`[SYNC-DEBUG] [PULL-CAMBIOS] ✅ Presupuesto insertado con secuencia = 'Imprimir'`);
}

async function actualizarPresupuestoLocal(presupuesto, db) {
    console.log(`[SYNC-DEBUG] [PULL-CAMBIOS] Actualizando encabezado desde Sheets para id_presupuesto_ext=${presupuesto.id_presupuesto_ext}`);
    
    const updateQuery = `
        UPDATE presupuestos SET
            id_cliente = $2,
            fecha = $3,
            fecha_entrega = $4,
            agente = $5,
            tipo_comprobante = $6,
            nota = $7,
            estado = $8,
            informe_generado = $9,
            cliente_nuevo_id = $10,
            punto_entrega = $11,
            descuento = $12,
            secuencia = $13,
            activo = $14,
            fecha_actualizacion = $15
        WHERE id_presupuesto_ext = $1
    `;
    
    console.log('[SYNC-DEBUG] [PULL-CAMBIOS] Valores para UPDATE encabezado:', {
        id_presupuesto_ext: presupuesto.id_presupuesto_ext,
        secuencia_forzada_local: 'Imprimir',
        estado: presupuesto.estado,
        lastModified: presupuesto.lastModified
    });
    
    await db.query(updateQuery, [
        presupuesto.id_presupuesto_ext,     // $1
        presupuesto.id_cliente,             // $2
        presupuesto.fecha,                  // $3
        presupuesto.fecha_entrega,          // $4
        presupuesto.agente,                 // $5
        presupuesto.tipo_comprobante,       // $6
        presupuesto.nota,                   // $7
        presupuesto.estado,                 // $8
        presupuesto.informe_generado,       // $9
        presupuesto.cliente_nuevo_id,       // $10
        presupuesto.punto_entrega,          // $11
        presupuesto.descuento,              // $12
        'Imprimir',                         // $13 - FORZAR secuencia = 'Imprimir' cuando viene de Sheets
        presupuesto.activo,                 // $14
        presupuesto.lastModified            // $15
    ]);
    
    // VERIFICACIÓN POST-UPDATE
    const check = await db.query(
        'SELECT secuencia, estado FROM presupuestos WHERE id_presupuesto_ext = $1',
        [presupuesto.id_presupuesto_ext]
    );
    console.log('[SYNC-DEBUG] [PULL-CAMBIOS] Valores en BD después de UPDATE encabezado:', {
        id_presupuesto_ext: presupuesto.id_presupuesto_ext,
        secuencia: check.rows[0]?.secuencia,
        estado: check.rows[0]?.estado
    });
}

console.log('[SYNC-QUOTA-SAFE] ✅ Servicio de sincronización tolerante a cuotas configurado');

module.exports = {
    ejecutarSincronizacionBidireccionalQuotaSafe,
    SyncState
};
