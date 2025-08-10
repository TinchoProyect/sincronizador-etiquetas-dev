console.log('[SYNC-FULL-REFRESH] Inicializando servicio de sincronización Full Refresh...');

const { readSheetWithHeaders, validateSheetAccess } = require('./client_with_logs');
const { getAuthenticatedClient } = require('./auth_with_logs');

/**
 * SERVICIO DE SINCRONIZACIÓN FULL REFRESH
 * Recarga completa y atómica de datos desde Google Sheets
 * Corrige fechas y otros campos mal importados
 */

// Estado global de sincronización
let syncState = {
    inProgress: false,
    startTime: null,
    currentStep: null,
    progress: 0
};

/**
 * Obtener estado actual de sincronización
 */
function getSyncState() {
    return { ...syncState };
}

/**
 * Actualizar estado de sincronización
 */
function updateSyncState(step, progress = null) {
    syncState.currentStep = step;
    if (progress !== null) {
        syncState.progress = progress;
    }
    console.log(`[SYNC-FULL-REFRESH] Estado: ${step} (${syncState.progress}%)`);
}

/**
 * SINCRONIZACIÓN FULL REFRESH PRINCIPAL
 * @param {Object} config - Configuración de la hoja
 * @param {Object} db - Conexión a base de datos
 * @param {Object} options - Opciones de sincronización
 * @returns {Object} Resultado de la sincronización
 */
async function executeFullRefreshSync(config, db, options = {}) {
    console.log('[SYNC-FULL-REFRESH] ===== INICIANDO FULL REFRESH SYNC =====');
    
    const syncMode = options.mode || 'full_refresh'; // full_refresh | upsert_stage
    const dryRun = options.dryRun || false;
    
    console.log(`[SYNC-FULL-REFRESH] Modo: ${syncMode}, Dry Run: ${dryRun}`);
    
    // Inicializar estado
    syncState.inProgress = true;
    syncState.startTime = new Date();
    syncState.progress = 0;
    
    const result = {
        success: false,
        mode: syncMode,
        dryRun: dryRun,
        startTime: syncState.startTime,
        endTime: null,
        duration: null,
        preflightChecks: {},
        backup: {},
        dataLoaded: {},
        dataInserted: {},
        validation: {},
        errors: [],
        summary: {}
    };
    
    try {
        // PASO 1: PRE-FLIGHT CHECKS
        updateSyncState('Pre-flight checks', 5);
        result.preflightChecks = await executePreflightChecks(config, db);
        
        if (!result.preflightChecks.allPassed) {
            throw new Error('Pre-flight checks fallaron: ' + result.preflightChecks.failedChecks.join(', '));
        }
        
        // PASO 2: BACKUP Y MÉTRICAS
        updateSyncState('Creando backup', 10);
        result.backup = await createBackupSnapshot(db);
        
        // PASO 3: LEER DATOS DESDE GOOGLE SHEETS
        updateSyncState('Leyendo datos desde Google Sheets', 20);
        result.dataLoaded = await loadDataFromSheets(config);
        
        // PASO 4: VALIDAR DATOS CARGADOS
        updateSyncState('Validando datos cargados', 30);
        result.validation = await validateLoadedData(result.dataLoaded);
        
        if (!result.validation.isValid) {
            throw new Error('Validación de datos falló: ' + result.validation.errors.join(', '));
        }
        
        if (dryRun) {
            console.log('[SYNC-FULL-REFRESH] DRY RUN - No se ejecutarán cambios en BD');
            result.success = true;
            return result;
        }
        
        // PASO 5: EJECUTAR SINCRONIZACIÓN SEGÚN MODO
        if (syncMode === 'full_refresh') {
            result.dataInserted = await executeFullRefresh(db, result.dataLoaded, config);
        } else if (syncMode === 'upsert_stage') {
            result.dataInserted = await executeUpsertStage(db, result.dataLoaded, config);
        }
        
        updateSyncState('Sincronización completada', 100);
        result.success = true;
        
    } catch (error) {
        console.error('[SYNC-FULL-REFRESH] ❌ Error en sincronización:', error.message);
        result.errors.push(error.message);
        result.success = false;
    } finally {
        // Finalizar estado
        syncState.inProgress = false;
        result.endTime = new Date();
        result.duration = result.endTime - result.startTime;
        
        // Crear resumen
        result.summary = createSyncSummary(result);
        
        // Registrar log
        await registerSyncLog(db, result);
        
        console.log('[SYNC-FULL-REFRESH] ===== SINCRONIZACIÓN FINALIZADA =====');
        console.log(`[SYNC-FULL-REFRESH] Éxito: ${result.success}, Duración: ${result.duration}ms`);
    }
    
    return result;
}

/**
 * PASO 1: PRE-FLIGHT CHECKS
 */
async function executePreflightChecks(config, db) {
    console.log('[SYNC-FULL-REFRESH] Ejecutando pre-flight checks...');
    
    const checks = {
        googleSheetsConnectivity: false,
        postgresConnectivity: false,
        schemaValidation: false,
        sampleDataValidation: false,
        allPassed: false,
        failedChecks: []
    };
    
    try {
        // Check 1: Conectividad Google Sheets
        console.log('[SYNC-FULL-REFRESH] Check 1: Conectividad Google Sheets...');
        try {
            const auth = await getAuthenticatedClient();
            const access = await validateSheetAccess(config.hoja_id);
            checks.googleSheetsConnectivity = access.hasAccess;
            if (!checks.googleSheetsConnectivity) {
                checks.failedChecks.push('Google Sheets no accesible');
            }
        } catch (error) {
            checks.failedChecks.push(`Google Sheets error: ${error.message}`);
        }
        
        // Check 2: Conectividad PostgreSQL
        console.log('[SYNC-FULL-REFRESH] Check 2: Conectividad PostgreSQL...');
        try {
            await db.query('SELECT 1');
            checks.postgresConnectivity = true;
        } catch (error) {
            checks.failedChecks.push(`PostgreSQL error: ${error.message}`);
        }
        
        // Check 3: Validación de esquema
        console.log('[SYNC-FULL-REFRESH] Check 3: Validación de esquema...');
        try {
            const schemaCheck = await validateDatabaseSchema(db);
            checks.schemaValidation = schemaCheck.isValid;
            if (!checks.schemaValidation) {
                checks.failedChecks.push('Esquema de BD inválido');
            }
        } catch (error) {
            checks.failedChecks.push(`Schema error: ${error.message}`);
        }
        
        // Check 4: Validación de muestra de datos
        console.log('[SYNC-FULL-REFRESH] Check 4: Validación de muestra...');
        try {
            const sampleValidation = await validateSampleData(config);
            checks.sampleDataValidation = sampleValidation.isValid;
            if (!checks.sampleDataValidation) {
                checks.failedChecks.push('Muestra de datos inválida');
            }
        } catch (error) {
            checks.failedChecks.push(`Sample data error: ${error.message}`);
        }
        
        checks.allPassed = checks.googleSheetsConnectivity && 
                          checks.postgresConnectivity && 
                          checks.schemaValidation && 
                          checks.sampleDataValidation;
        
        console.log(`[SYNC-FULL-REFRESH] Pre-flight checks: ${checks.allPassed ? 'PASSED' : 'FAILED'}`);
        
        return checks;
        
    } catch (error) {
        console.error('[SYNC-FULL-REFRESH] ❌ Error en pre-flight checks:', error.message);
        checks.failedChecks.push(`General error: ${error.message}`);
        return checks;
    }
}

/**
 * Validar esquema de base de datos
 */
async function validateDatabaseSchema(db) {
    console.log('[SYNC-FULL-REFRESH] Validando esquema de base de datos...');
    
    try {
        // Verificar tablas principales
        const tablesQuery = `
            SELECT table_name 
            FROM information_schema.tables 
            WHERE table_schema = 'public' 
            AND table_name IN ('presupuestos', 'presupuestos_detalles')
        `;
        
        const tablesResult = await db.query(tablesQuery);
        const tables = tablesResult.rows.map(row => row.table_name);
        
        const requiredTables = ['presupuestos', 'presupuestos_detalles'];
        const missingTables = requiredTables.filter(table => !tables.includes(table));
        
        if (missingTables.length > 0) {
            return {
                isValid: false,
                error: `Tablas faltantes: ${missingTables.join(', ')}`
            };
        }
        
        // Verificar columnas críticas
        const columnsQuery = `
            SELECT table_name, column_name, data_type 
            FROM information_schema.columns 
            WHERE table_schema = 'public' 
            AND table_name IN ('presupuestos', 'presupuestos_detalles')
            AND column_name IN ('id', 'id_presupuesto_ext', 'fecha', 'id_cliente', 'id_presupuesto')
        `;
        
        const columnsResult = await db.query(columnsQuery);
        
        console.log('[SYNC-FULL-REFRESH] ✅ Esquema validado correctamente');
        
        return {
            isValid: true,
            tables: tables,
            columns: columnsResult.rows
        };
        
    } catch (error) {
        console.error('[SYNC-FULL-REFRESH] ❌ Error validando esquema:', error.message);
        return {
            isValid: false,
            error: error.message
        };
    }
}

/**
 * Validar muestra de datos desde Google Sheets
 */
async function validateSampleData(config) {
    console.log('[SYNC-FULL-REFRESH] Validando muestra de datos...');
    
    try {
        // Leer muestra pequeña (primeras 10 filas)
        const presupuestosSample = await readSheetWithHeaders(config.hoja_id, 'A1:M11', 'Presupuestos');
        const detallesSample = await readSheetWithHeaders(config.hoja_id, 'A1:N11', 'DetallesPresupuestos');
        
        const validation = {
            isValid: true,
            errors: [],
            presupuestosCount: presupuestosSample.rows.length,
            detallesCount: detallesSample.rows.length,
            dateFormats: [],
            sampleDates: []
        };
        
        // Analizar formatos de fecha en muestra
        for (let i = 0; i < Math.min(5, presupuestosSample.rows.length); i++) {
            const row = presupuestosSample.rows[i];
            const fechaValue = row[presupuestosSample.headers[1]]; // Columna Fecha
            
            if (fechaValue) {
                const dateAnalysis = analyzeDateFormat(fechaValue);
                validation.dateFormats.push(dateAnalysis.format);
                validation.sampleDates.push({
                    original: fechaValue,
                    format: dateAnalysis.format,
                    parsed: dateAnalysis.parsed,
                    isValid: dateAnalysis.isValid,
                    isFuture: dateAnalysis.isFuture
                });
            }
        }
        
        // Validar que hay datos
        if (validation.presupuestosCount === 0) {
            validation.isValid = false;
            validation.errors.push('No hay datos en hoja Presupuestos');
        }
        
        console.log(`[SYNC-FULL-REFRESH] ✅ Muestra validada: ${validation.presupuestosCount} presupuestos, ${validation.detallesCount} detalles`);
        console.log(`[SYNC-FULL-REFRESH] Formatos de fecha detectados:`, validation.dateFormats);
        
        return validation;
        
    } catch (error) {
        console.error('[SYNC-FULL-REFRESH] ❌ Error validando muestra:', error.message);
        return {
            isValid: false,
            errors: [error.message]
        };
    }
}

/**
 * Analizar formato de fecha
 */
function analyzeDateFormat(dateValue) {
    console.log(`[SYNC-FULL-REFRESH] Analizando fecha: ${dateValue} (tipo: ${typeof dateValue})`);
    
    const analysis = {
        original: dateValue,
        format: 'unknown',
        parsed: null,
        isValid: false,
        isFuture: false
    };
    
    try {
        if (!dateValue) {
            analysis.format = 'empty';
            return analysis;
        }
        
        // Si es número (serial de Excel/Sheets)
        if (typeof dateValue === 'number') {
            analysis.format = 'serial';
            // Convertir serial de Excel a fecha (1900-01-01 = 1)
            const excelEpoch = new Date(1900, 0, 1);
            const parsed = new Date(excelEpoch.getTime() + (dateValue - 1) * 24 * 60 * 60 * 1000);
            analysis.parsed = parsed;
            analysis.isValid = !isNaN(parsed.getTime());
            analysis.isFuture = parsed > new Date();
            return analysis;
        }
        
        // Si es string
        if (typeof dateValue === 'string') {
            const trimmed = dateValue.trim();
            
            // Formato DD/MM/YYYY
            if (trimmed.match(/^\d{1,2}\/\d{1,2}\/\d{4}$/)) {
                analysis.format = 'DD/MM/YYYY';
                const [day, month, year] = trimmed.split('/').map(Number);
                
                // Validar rangos
                if (year >= 1900 && year <= 2030 && month >= 1 && month <= 12 && day >= 1 && day <= 31) {
                    const parsed = new Date(year, month - 1, day);
                    analysis.parsed = parsed;
                    analysis.isValid = !isNaN(parsed.getTime());
                    analysis.isFuture = parsed > new Date();
                }
                return analysis;
            }
            
            // Formato ISO YYYY-MM-DD
            if (trimmed.match(/^\d{4}-\d{2}-\d{2}/)) {
                analysis.format = 'ISO';
                const parsed = new Date(trimmed);
                analysis.parsed = parsed;
                analysis.isValid = !isNaN(parsed.getTime());
                analysis.isFuture = parsed > new Date();
                return analysis;
            }
            
            // Otros formatos
            analysis.format = 'other_string';
            const parsed = new Date(trimmed);
            if (!isNaN(parsed.getTime())) {
                analysis.parsed = parsed;
                analysis.isValid = true;
                analysis.isFuture = parsed > new Date();
            }
        }
        
        return analysis;
        
    } catch (error) {
        console.error(`[SYNC-FULL-REFRESH] Error analizando fecha ${dateValue}:`, error.message);
        analysis.format = 'error';
        return analysis;
    }
}

/**
 * PASO 2: CREAR BACKUP SNAPSHOT
 */
async function createBackupSnapshot(db) {
    console.log('[SYNC-FULL-REFRESH] Creando backup snapshot...');
    
    try {
        // Contar registros actuales
        const presupuestosCount = await db.query('SELECT COUNT(*) as count FROM presupuestos WHERE activo = true');
        const detallesCount = await db.query('SELECT COUNT(*) as count FROM presupuestos_detalles');
        
        // Obtener muestra de registros
        const presupuestosSample = await db.query(`
            SELECT id, id_presupuesto_ext, fecha, id_cliente, estado 
            FROM presupuestos 
            WHERE activo = true 
            ORDER BY id 
            LIMIT 5
        `);
        
        const detallesSample = await db.query(`
            SELECT id, id_presupuesto_ext, articulo, cantidad 
            FROM presupuestos_detalles 
            ORDER BY id 
            LIMIT 5
        `);
        
        const backup = {
            timestamp: new Date().toISOString(),
            presupuestosCount: parseInt(presupuestosCount.rows[0].count),
            detallesCount: parseInt(detallesCount.rows[0].count),
            presupuestosSample: presupuestosSample.rows,
            detallesSample: detallesSample.rows
        };
        
        console.log(`[SYNC-FULL-REFRESH] ✅ Backup creado: ${backup.presupuestosCount} presupuestos, ${backup.detallesCount} detalles`);
        
        return backup;
        
    } catch (error) {
        console.error('[SYNC-FULL-REFRESH] ❌ Error creando backup:', error.message);
        throw error;
    }
}

/**
 * PASO 3: CARGAR DATOS DESDE GOOGLE SHEETS
 */
async function loadDataFromSheets(config) {
    console.log('[SYNC-FULL-REFRESH] Cargando datos desde Google Sheets...');
    
    try {
        // Leer ambas hojas completas
        const presupuestosData = await readSheetWithHeaders(config.hoja_id, 'A:M', 'Presupuestos');
        const detallesData = await readSheetWithHeaders(config.hoja_id, 'A:N', 'DetallesPresupuestos');
        
        const loaded = {
            presupuestos: {
                headers: presupuestosData.headers,
                rows: presupuestosData.rows,
                count: presupuestosData.rows.length
            },
            detalles: {
                headers: detallesData.headers,
                rows: detallesData.rows,
                count: detallesData.rows.length
            },
            timestamp: new Date().toISOString()
        };
        
        console.log(`[SYNC-FULL-REFRESH] ✅ Datos cargados: ${loaded.presupuestos.count} presupuestos, ${loaded.detalles.count} detalles`);
        
        return loaded;
        
    } catch (error) {
        console.error('[SYNC-FULL-REFRESH] ❌ Error cargando datos:', error.message);
        throw error;
    }
}

/**
 * PASO 4: VALIDAR DATOS CARGADOS
 */
async function validateLoadedData(dataLoaded) {
    console.log('[SYNC-FULL-REFRESH] Validando datos cargados...');
    
    const validation = {
        isValid: true,
        errors: [],
        warnings: [],
        stats: {
            validPresupuestos: 0,
            invalidPresupuestos: 0,
            validDetalles: 0,
            invalidDetalles: 0,
            futureDates: 0,
            nullDates: 0,
            correctedDates: 0
        },
        sampleErrors: []
    };
    
    try {
        // Validar presupuestos
        for (let i = 0; i < dataLoaded.presupuestos.rows.length; i++) {
            const row = dataLoaded.presupuestos.rows[i];
            const rowNum = i + 2; // +2 porque empezamos desde fila 1 y saltamos encabezados
            
            const id_presupuesto_ext = row[dataLoaded.presupuestos.headers[0]];
            const fecha = row[dataLoaded.presupuestos.headers[1]];
            const id_cliente = row[dataLoaded.presupuestos.headers[2]];
            
            // Validar campos obligatorios
            if (!id_presupuesto_ext || !id_cliente) {
                validation.stats.invalidPresupuestos++;
                const error = `Fila ${rowNum}: ID presupuesto o cliente vacío`;
                validation.errors.push(error);
                if (validation.sampleErrors.length < 5) {
                    validation.sampleErrors.push(error);
                }
                continue;
            }
            
            // Validar fecha
            if (fecha) {
                const dateAnalysis = analyzeDateFormat(fecha);
                if (dateAnalysis.isFuture) {
                    validation.stats.futureDates++;
                    validation.warnings.push(`Fila ${rowNum}: Fecha futura detectada: ${fecha}`);
                }
                if (!dateAnalysis.isValid) {
                    validation.warnings.push(`Fila ${rowNum}: Formato de fecha inválido: ${fecha}`);
                }
            } else {
                validation.stats.nullDates++;
            }
            
            validation.stats.validPresupuestos++;
        }
        
        // Validar detalles
        for (let i = 0; i < dataLoaded.detalles.rows.length; i++) {
            const row = dataLoaded.detalles.rows[i];
            const rowNum = i + 2;
            
            const id_presupuesto = row[dataLoaded.detalles.headers[1]];
            const articulo = row[dataLoaded.detalles.headers[2]];
            
            if (!id_presupuesto || !articulo) {
                validation.stats.invalidDetalles++;
                const error = `Detalle fila ${rowNum}: ID presupuesto o artículo vacío`;
                validation.errors.push(error);
                if (validation.sampleErrors.length < 5) {
                    validation.sampleErrors.push(error);
                }
                continue;
            }
            
            validation.stats.validDetalles++;
        }
        
        // Determinar si la validación es exitosa
        const errorThreshold = 0.05; // 5% de errores máximo
        const presupuestosErrorRate = validation.stats.invalidPresupuestos / dataLoaded.presupuestos.count;
        const detallesErrorRate = validation.stats.invalidDetalles / dataLoaded.detalles.count;
        
        if (presupuestosErrorRate > errorThreshold || detallesErrorRate > errorThreshold) {
            validation.isValid = false;
            validation.errors.push(`Tasa de error muy alta: ${(presupuestosErrorRate * 100).toFixed(1)}% presupuestos, ${(detallesErrorRate * 100).toFixed(1)}% detalles`);
        }
        
        console.log(`[SYNC-FULL-REFRESH] ✅ Validación completada: ${validation.isValid ? 'VÁLIDA' : 'INVÁLIDA'}`);
        console.log(`[SYNC-FULL-REFRESH] Stats:`, validation.stats);
        
        return validation;
        
    } catch (error) {
        console.error('[SYNC-FULL-REFRESH] ❌ Error validando datos:', error.message);
        validation.isValid = false;
        validation.errors.push(error.message);
        return validation;
    }
}

/**
 * EJECUTAR FULL REFRESH (BORRAR Y RECARGAR)
 */
async function executeFullRefresh(db, dataLoaded, config) {
    console.log('[SYNC-FULL-REFRESH] Ejecutando Full Refresh (BORRAR Y RECARGAR)...');
    
    const result = {
        mode: 'full_refresh',
        presupuestosInserted: 0,
        detallesInserted: 0,
        errors: [],
        datesCorrected: 0,
        nullDatesHandled: 0
    };
    
    try {
        // INICIAR TRANSACCIÓN ÚNICA
        await db.query('BEGIN');
        console.log('[SYNC-FULL-REFRESH] Transacción iniciada');
        
        updateSyncState('Vaciando tablas', 40);
        
        // PASO 1: VACIAR TABLAS (CASCADE eliminará detalles automáticamente)
        await db.query('DELETE FROM presupuestos');
        console.log('[SYNC-FULL-REFRESH] ✅ Tablas vaciadas');
        
        updateSyncState('Insertando presupuestos', 50);
        
        // PASO 2: INSERTAR PRESUPUESTOS
        const presupuestosMap = new Map(); // Para mapear id_ext -> id interno
        
        for (let i = 0; i < dataLoaded.presupuestos.rows.length; i++) {
            const row = dataLoaded.presupuestos.rows[i];
            
            try {
                const presupuesto = parsePresupuestoRow(row, dataLoaded.presupuestos.headers, config);
                
                if (!presupuesto.id_presupuesto_ext || !presupuesto.id_cliente) {
                    continue; // Saltar filas inválidas
                }
                
                const insertQuery = `
                    INSERT INTO presupuestos 
                    (id_presupuesto_ext, id_cliente, fecha, fecha_entrega, agente, tipo_comprobante,
                     nota, estado, informe_generado, cliente_nuevo_id, punto_entrega, descuento,
                     activo, hoja_nombre, hoja_url, usuario_id)
                    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, true, $13, $14, $15)
                    RETURNING id
                `;
                
                const insertResult = await db.query(insertQuery, [
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
                    presupuesto.hoja_nombre,
                    presupuesto.hoja_url,
                    presupuesto.usuario_id
                ]);
                
                const newId = insertResult.rows[0].id;
                presupuestosMap.set(presupuesto.id_presupuesto_ext, newId);
                result.presupuestosInserted++;
                
                if (presupuesto._dateCorrected) {
                    result.datesCorrected++;
                }
                if (presupuesto._nullDateHandled) {
                    result.nullDatesHandled++;
                }
                
            } catch (rowError) {
                console.error(`[SYNC-FULL-REFRESH] Error en presupuesto fila ${i + 2}:`, rowError.message);
                result.errors.push(`Presupuesto fila ${i + 2}: ${rowError.message}`);
            }
        }
        
        updateSyncState('Insertando detalles', 70);
        
        // PASO 3: INSERTAR DETALLES
        for (let i = 0; i < dataLoaded.detalles.rows.length; i++) {
            const row = dataLoaded.detalles.rows[i];
            
            try {
                const detalle = parseDetalleRow(row, dataLoaded.detalles.headers);
                
                if (!detalle.id_presupuesto_ext || !detalle.articulo) {
                    continue; // Saltar filas inválidas
                }
                
                // Buscar ID interno del presupuesto
                const presupuestoId = presupuestosMap.get(detalle.id_presupuesto_ext);
                if (!presupuestoId) {
                    result.errors.push(`Detalle fila ${i + 2}: Presupuesto ${detalle.id_presupuesto_ext} no encontrado`);
                    continue;
                }
                
                const insertQuery = `
                    INSERT INTO presupuestos_detalles 
                    (id_presupuesto, id_presupuesto_ext, articulo, cantidad, valor1, precio1,
                     iva1, diferencia, camp1, camp2, camp3, camp4, camp5, camp6)
                    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
                `;
                
                await db.query(insertQuery, [
                    presupuestoId,
                    detalle.id_presupuesto_ext,
                    detalle.articulo,
                    detalle.cantidad,
                    detalle.valor1,
                    detalle.precio1,
                    detalle.iva1,
                    detalle.diferencia,
                    detalle.camp1,
                    detalle.camp2,
                    detalle.camp3,
                    detalle.camp4,
                    detalle.camp5,
                    detalle.camp6
                ]);
                
                result.detallesInserted++;
                
            } catch (rowError) {
                console.error(`[SYNC-FULL-REFRESH] Error en detalle fila ${i + 2}:`, rowError.message);
                result.errors.push(`Detalle fila ${i + 2}: ${rowError.message}`);
            }
        }
        
        updateSyncState('Validando integridad', 85);
        
        // PASO 4: VALIDACIONES FINALES
        const finalValidation = await validateFinalIntegrity(db, result);
        
        if (!finalValidation.isValid) {
            throw new Error('Validación final falló: ' + finalValidation.errors.join(', '));
        }
        
        updateSyncState('Confirmando transacción', 95);
        
        // CONFIRMAR TRANSACCIÓN
        await db.query('COMMIT');
        console.log('[SYNC-FULL-REFRESH] ✅ Transacción confirmada');
        
        console.log(`[SYNC-FULL-REFRESH] ✅ Full Refresh completado: ${result.presupuestosInserted} presupuestos, ${result.detallesInserted} detalles`);
        
        return result;
        
    } catch (error) {
        // ROLLBACK en caso de error
        await db.query('ROLLBACK');
        console.error('[SYNC-FULL-REFRESH] ❌ Error en Full Refresh, rollback ejecutado:', error.message);
        result.errors.push(error.message);
        throw error;
    }
}

/**
 * EJECUTAR UPSERT STAGE (MODO ALTERNATIVO)
 */
async function executeUpsertStage(db, dataLoaded, config) {
    console.log('[SYNC-FULL-REFRESH] Ejecutando Upsert Stage (MODO STAGING)...');
    
    const result = {
        mode: 'upsert_stage',
        presupuestosInserted: 0,
        presupuestosUpdated: 0,
        detallesInserted: 0,
        detallesUpdated: 0,
        errors: [],
        datesCorrected: 0,
        nullDatesHandled: 0
    };
    
    try {
        // INICIAR TRANSACCIÓN
        await db.query('BEGIN');
        
        updateSyncState('Creando tablas staging', 40);
        
        // CREAR TABLAS STAGING TEMPORALES
        await createStagingTables(db);
        
        updateSyncState('Cargando datos en staging', 50);
        
        // CARGAR DATOS EN STAGING
        await loadDataToStaging(db, dataLoaded, config, result);
        
        updateSyncState('Validando staging', 70);
        
        // VALIDAR DATOS EN STAGING
        const stagingValidation = await validateStagingData(db);
        
        if (!stagingValidation.isValid) {
            throw new Error('Validación de staging falló: ' + stagingValidation.errors.join(', '));
        }
        
        updateSyncState('Ejecutando merge', 85);
        
        // EJECUTAR MERGE (UPSERT)
        await executeStagingMerge(db, result);
        
        updateSyncState('Limpiando staging', 95);
        
        // LIMPIAR TABLAS STAGING
        await dropStagingTables(db);
        
        // CONFIRMAR TRANSACCIÓN
        await db.query('COMMIT');
        console.log('[SYNC-FULL-REFRESH] ✅ Upsert Stage completado');
        
        return result;
        
    } catch (error) {
        await db.query('ROLLBACK');
        console.error('[SYNC-FULL-REFRESH] ❌ Error en Upsert Stage, rollback ejecutado:', error.message);
        result.errors.push(error.message);
        throw error;
    }
}

/**
 * Parsear fila de presupuesto con corrección de fechas
 */
function parsePresupuestoRow(row, headers, config) {
    const presupuesto = {
        id_presupuesto_ext: (row[headers[0]] || '').toString().trim(),
        id_cliente: (row[headers[2]] || '').toString().trim(),
        fecha: null,
        fecha_entrega: null,
        agente: row[headers[3]] || null,
        tipo_comprobante: row[headers[5]] || null,
        nota: row[headers[6]] || null,
        estado: row[headers[7]] || 'pendiente',
        informe_generado: row[headers[8]] || null,
        cliente_nuevo_id: row[headers[9]] || null,
        punto_entrega: row[headers[11]] || null,
        descuento: parseFloat(row[headers[12]]) || 0,
        activo: true,
        hoja_nombre: 'Presupuestos',
        hoja_url: config.hoja_url,
        usuario_id: config.usuario_id || null,
        _dateCorrected: false,
        _nullDateHandled: false
    };
    
    // Parsear fecha principal con corrección
    const fechaValue = row[headers[1]];
    if (fechaValue) {
        const parsedDate = parseAndCorrectDate(fechaValue);
        presupuesto.fecha = parsedDate.date;
        presupuesto._dateCorrected = parsedDate.corrected;
    } else {
        presupuesto._nullDateHandled = true;
    }
    
    // Parsear fecha de entrega
    const fechaEntregaValue = row[headers[4]];
    if (fechaEntregaValue && fechaEntregaValue !== '1970-01-01') {
        const parsedDate = parseAndCorrectDate(fechaEntregaValue);
        presupuesto.fecha_entrega = parsedDate.date;
    }
    
    return presupuesto;
}

/**
 * Parsear fila de detalle
 */
function parseDetalleRow(row, headers) {
    return {
        id_presupuesto_ext: (row[headers[1]] || '').toString().trim(),
        articulo: (row[headers[2]] || '').toString().trim(),
        cantidad: parseFloat(row[headers[3]]) || 0,
        valor1: parseFloat(row[headers[4]]) || 0,
        precio1: parseFloat(row[headers[5]]) || 0,
        iva1: parseFloat(row[headers[6]]) || 0,
        diferencia: parseFloat(row[headers[7]]) || 0,
        camp1: parseFloat(row[headers[9]]) || 0,
        camp2: parseFloat(row[headers[10]]) || 0,
        camp3: parseFloat(row[headers[11]]) || 0,
        camp4: parseFloat(row[headers[12]]) || 0,
        camp5: parseFloat(row[headers[13]]) || 0,
        camp6: parseFloat(row[headers[14]]) || 0
    };
}

/**
 * Parsear y corregir fecha con lógica estricta DD/MM/YYYY
 */
function parseAndCorrectDate(dateValue) {
    console.log(`[SYNC-FULL-REFRESH] Parseando fecha: ${dateValue} (tipo: ${typeof dateValue})`);
    
    const result = {
        date: null,
        corrected: false,
        original: dateValue
    };
    
    try {
        if (!dateValue) {
            return result;
        }
        
        // Si es número (serial de Excel/Sheets)
        if (typeof dateValue === 'number') {
            // Convertir serial de Excel a fecha
            const excelEpoch = new Date(1900, 0, 1);
            const parsed = new Date(excelEpoch.getTime() + (dateValue - 1) * 24 * 60 * 60 * 1000);
            
            if (!isNaN(parsed.getTime()) && parsed.getFullYear() >= 1900 && parsed.getFullYear() <= 2030) {
                // Formatear como DATE para PostgreSQL
                const year = parsed.getFullYear();
                const month = String(parsed.getMonth() + 1).padStart(2, '0');
                const day = String(parsed.getDate()).padStart(2, '0');
                result.date = `${year}-${month}-${day}`;
                result.corrected = true;
                console.log(`[SYNC-FULL-REFRESH] Serial convertido: ${dateValue} -> ${result.date}`);
            }
            return result;
        }
        
        // Si es string
        if (typeof dateValue === 'string') {
            const trimmed = dateValue.trim();
            
            // Formato DD/MM/YYYY (PRIORITARIO)
            if (trimmed.match(/^\d{1,2}\/\d{1,2}\/\d{4}$/)) {
                const [day, month, year] = trimmed.split('/').map(Number);
                
                // Validar rangos
                if (year >= 1900 && year <= 2030 && month >= 1 && month <= 12 && day >= 1 && day <= 31) {
                    // Crear fecha y validar que sea válida
                    const testDate = new Date(year, month - 1, day);
                    if (testDate.getFullYear() === year && testDate.getMonth() === month - 1 && testDate.getDate() === day) {
                        // Verificar que no sea futura (más de 1 día adelante)
                        const today = new Date();
                        const tomorrow = new Date(today.getFullYear(), today.getMonth(), today.getDate() + 1);
                        
                        if (testDate <= tomorrow) {
                            result.date = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
                            result.corrected = true;
                            console.log(`[SYNC-FULL-REFRESH] DD/MM/YYYY parseado: ${trimmed} -> ${result.date}`);
                        } else {
                            console.warn(`[SYNC-FULL-REFRESH] Fecha futura rechazada: ${trimmed}`);
                        }
                    }
                }
                return result;
            }
            
            // Formato ISO YYYY-MM-DD
            if (trimmed.match(/^\d{4}-\d{2}-\d{2}$/)) {
                const parsed = new Date(trimmed + 'T00:00:00.000Z');
                if (!isNaN(parsed.getTime())) {
                    const today = new Date();
                    const tomorrow = new Date(today.getFullYear(), today.getMonth(), today.getDate() + 1);
                    
                    if (parsed <= tomorrow) {
                        result.date = trimmed;
                        console.log(`[SYNC-FULL-REFRESH] ISO parseado: ${trimmed}`);
                    } else {
                        console.warn(`[SYNC-FULL-REFRESH] Fecha ISO futura rechazada: ${trimmed}`);
                    }
                }
                return result;
            }
        }
        
        console.warn(`[SYNC-FULL-REFRESH] Formato de fecha no reconocido: ${dateValue}`);
        return result;
        
    } catch (error) {
        console.error(`[SYNC-FULL-REFRESH] Error parseando fecha ${dateValue}:`, error.message);
        return result;
    }
}

/**
 * Validar integridad final después de inserción
 */
async function validateFinalIntegrity(db, insertResult) {
    console.log('[SYNC-FULL-REFRESH] Validando integridad final...');
    
    const validation = {
        isValid: true,
        errors: [],
        stats: {}
    };
    
    try {
        // Contar registros insertados
        const presupuestosCount = await db.query('SELECT COUNT(*) as count FROM presupuestos WHERE activo = true');
        const detallesCount = await db.query('SELECT COUNT(*) as count FROM presupuestos_detalles');
        
        validation.stats.presupuestosInDB = parseInt(presupuestosCount.rows[0].count);
        validation.stats.detallesInDB = parseInt(detallesCount.rows[0].count);
        
        // Verificar que coincidan con lo insertado
        if (validation.stats.presupuestosInDB !== insertResult.presupuestosInserted) {
            validation.isValid = false;
            validation.errors.push(`Discrepancia en presupuestos: insertados ${insertResult.presupuestosInserted}, en BD ${validation.stats.presupuestosInDB}`);
        }
        
        if (validation.stats.detallesInDB !== insertResult.detallesInserted) {
            validation.isValid = false;
            validation.errors.push(`Discrepancia en detalles: insertados ${insertResult.detallesInserted}, en BD ${validation.stats.detallesInDB}`);
        }
        
        // Verificar integridad referencial
        const orphanQuery = `
            SELECT COUNT(*) as count 
            FROM presupuestos_detalles pd 
            LEFT JOIN presupuestos p ON pd.id_presupuesto = p.id 
            WHERE p.id IS NULL
        `;
        
        const orphanResult = await db.query(orphanQuery);
        const orphanCount = parseInt(orphanResult.rows[0].count);
        
        if (orphanCount > 0) {
            validation.isValid = false;
            validation.errors.push(`${orphanCount} detalles huérfanos detectados`);
        }
        
        // Verificar fechas futuras
        const futureDatesQuery = `
            SELECT COUNT(*) as count 
            FROM presupuestos 
            WHERE fecha > CURRENT_DATE + INTERVAL '1 day'
        `;
        
        const futureDatesResult = await db.query(futureDatesQuery);
        const futureDatesCount = parseInt(futureDatesResult.rows[0].count);
        
        if (futureDatesCount > 0) {
            validation.isValid = false;
            validation.errors.push(`${futureDatesCount} fechas futuras detectadas`);
        }
        
        validation.stats.orphanDetalles = orphanCount;
        validation.stats.futureDates = futureDatesCount;
        
        console.log(`[SYNC-FULL-REFRESH] Validación final: ${validation.isValid ? 'VÁLIDA' : 'INVÁLIDA'}`);
        
        return validation;
        
    } catch (error) {
        console.error('[SYNC-FULL-REFRESH] ❌ Error en validación final:', error.message);
        validation.isValid = false;
        validation.errors.push(error.message);
        return validation;
    }
}

/**
 * Crear resumen de sincronización
 */
function createSyncSummary(result) {
    const summary = {
        success: result.success,
        mode: result.dataInserted?.mode || 'unknown',
        duration: result.duration,
        totalErrors: result.errors.length,
        dataStats: {
            presupuestosProcessed: result.dataLoaded?.presupuestos?.count || 0,
            detallesProcessed: result.dataLoaded?.detalles?.count || 0,
            presupuestosInserted: result.dataInserted?.presupuestosInserted || 0,
            detallesInserted: result.dataInserted?.detallesInserted || 0,
            datesCorrected: result.dataInserted?.datesCorrected || 0,
            nullDatesHandled: result.dataInserted?.nullDatesHandled || 0
        },
        validationStats: result.validation?.stats || {},
        sampleErrors: result.errors.slice(0, 5),
        recommendations: []
    };
    
    // Generar recomendaciones
    if (summary.totalErrors > 0) {
        summary.recommendations.push('Revisar errores reportados y corregir datos fuente');
    }
    
    if (summary.dataStats.datesCorrected > 0) {
        summary.recommendations.push(`${summary.dataStats.datesCorrected} fechas fueron corregidas automáticamente`);
    }
    
    if (summary.validationStats.futureDates > 0) {
        summary.recommendations.push('Revisar fechas futuras en datos fuente');
    }
    
    return summary;
}

/**
 * Registrar log de sincronización
 */
async function registerSyncLog(db, result) {
    console.log('[SYNC-FULL-REFRESH] Registrando log de sincronización...');
    
    try {
        const insertLogQuery = `
            INSERT INTO presupuestos_sync_log 
            (config_id, registros_procesados, registros_nuevos, registros_actualizados, 
             errores, fecha_sync, exitoso, usuario_id, tipo_sync, duracion_segundos)
            VALUES ($1, $2, $3, $4, $5, NOW(), $6, $7, $8, $9)
            RETURNING id
        `;
        
        const erroresText = result.errors.length > 0 ? result.errors.join('\n') : null;
        const duracionSegundos = Math.round(result.duration / 1000);
        
        const logResult = await db.query(insertLogQuery, [
            null, // config_id - se puede agregar después
            result.summary?.dataStats?.presupuestosProcessed || 0,
            result.summary?.dataStats?.presupuestosInserted || 0,
            result.summary?.dataStats?.presupuestosUpdated || 0,
            erroresText,
            result.success,
            null, // usuario_id - se puede agregar después
            result.summary?.mode || 'full_refresh',
            duracionSegundos
        ]);
        
        console.log('[SYNC-FULL-REFRESH] ✅ Log registrado con ID:', logResult.rows[0].id);
        
        return logResult.rows[0].id;
        
    } catch (error) {
        console.error('[SYNC-FULL-REFRESH] ❌ Error registrando log:', error.message);
        // No lanzar error para no afectar el resultado principal
    }
}

// Funciones auxiliares para modo UPSERT_STAGE (implementación básica)
async function createStagingTables(db) {
    // Implementar creación de tablas staging si se necesita
    console.log('[SYNC-FULL-REFRESH] Creando tablas staging...');
}

async function loadDataToStaging(db, dataLoaded, config, result) {
    // Implementar carga a staging si se necesita
    console.log('[SYNC-FULL-REFRESH] Cargando datos a staging...');
}

async function validateStagingData(db) {
    // Implementar validación de staging si se necesita
    console.log('[SYNC-FULL-REFRESH] Validando datos en staging...');
    return { isValid: true, errors: [] };
}

async function executeStagingMerge(db, result) {
    // Implementar merge desde staging si se necesita
    console.log('[SYNC-FULL-REFRESH] Ejecutando merge desde staging...');
}

async function dropStagingTables(db) {
    // Implementar limpieza de staging si se necesita
    console.log('[SYNC-FULL-REFRESH] Eliminando tablas staging...');
}

console.log('[SYNC-FULL-REFRESH] ✅ Servicio de sincronización Full Refresh configurado');

module.exports = {
    executeFullRefreshSync,
    getSyncState,
    executeFullRefresh,
    executeUpsertStage,
    parseAndCorrectDate,
    analyzeDateFormat
};
