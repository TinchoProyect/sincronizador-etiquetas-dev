console.log('[SYNC-FECHAS-FIX] Inicializando servicio de corrección de fechas...');

const { readSheetWithHeaders, validateSheetAccess } = require('./client_with_logs');
const { parseDate } = require('./transformer');
const crypto = require('crypto');

// Función para normalizar LastModified a formato ISO-8601 UTC (igual que AppSheet)
const toUtcIso = (d) => new Date(d || Date.now()).toISOString();

/**
 * SERVICIO DE CORRECCIÓN DE FECHAS
 * Recarga completa y atómica con corrección definitiva de fechas DD/MM/YYYY
 */

/**
 * Ejecutar corrección completa de fechas
 * @param {Object} config - Configuración de la hoja
 * @param {Object} db - Conexión a base de datos
 * @returns {Object} Resultado de la operación
 */
async function ejecutarCorreccionFechas(config, db) {
    console.log('[SYNC-FECHAS-FIX] ===== INICIANDO CORRECCIÓN DE FECHAS =====');
    
    const resultado = {
        exito: false,
        inicioOperacion: new Date(),
        finOperacion: null,
        duracionMs: null,
        datosLeidos: {
            presupuestos: 0,
            detalles: 0
        },
        datosInsertados: {
            presupuestos: 0,
            detalles: 0
        },
        fechasCorregidas: 0,
        fechasNulas: 0,
        fechasFuturas: 0,
        ejemplosCorreccion: [],
        errores: []
    };
    
    // Contadores para métricas (scope de toda la función)
    let conteoActivoFalse = 0;
    let conteoSinLastModified = 0;
    
    try {
        // PASO 1: Validar acceso a Google Sheets
        console.log('[SYNC-FECHAS-FIX] Validando acceso a Google Sheets...');
        const acceso = await validateSheetAccess(config.hoja_id);
        if (!acceso.hasAccess) {
            throw new Error(`No se puede acceder a Google Sheets: ${acceso.error}`);
        }
        
        // PASO 2: Leer datos desde Google Sheets
        console.log('[SYNC-FECHAS-FIX] Leyendo datos desde Google Sheets...');
        let presupuestosData = await readSheetWithHeaders(config.hoja_id, 'A:O', 'Presupuestos');
        let detallesData = await readSheetWithHeaders(config.hoja_id, 'A:Q', 'DetallesPresupuestos');
        // ===== DEBUG READ (solo últimos 5) =====
                try {
                const lastN = 5;

                // Presupuestos
                const pRows = Array.isArray(presupuestosData?.rows) ? presupuestosData.rows : [];
                console.log('[DEBUG][PRES-READ] total=%s', pRows.length);
                pRows.slice(-lastN).forEach((r, k, arr) => {
                    const H = presupuestosData.headers;
                    console.log('[DEBUG][PRES-READ] %s/%s -> { id:%o, fecha:%o, id_cliente:%o, agente:%o, lastMod:%o, activo:%o }',
                    pRows.length - arr.length + k + 1, pRows.length,
                    r[H[0]], r[H[1]], r[H[2]], r[H[3]], r[H[13]], r[H[14]]
                    );
                });

                // Detalles
                const dRows = Array.isArray(detallesData?.rows) ? detallesData.rows : [];
                console.log('[DEBUG][DET-READ] total=%s', dRows.length);
                dRows.slice(-lastN).forEach((r, k, arr) => {
                    const H = detallesData.headers;
                    console.log('[DEBUG][DET-READ] %s/%s -> { idPres:%o, art:%o, cant:%o, val1:%o, precio1:%o, iva1:%o, camp1:%o, camp2:%o, camp3:%o, camp4:%o, camp5:%o, camp6:%o, lastMod:%o }',
                    dRows.length - arr.length + k + 1, dRows.length,
                    r[H[1]], r[H[2]], r[H[3]], r[H[4]], r[H[5]], r[H[6]],
                    r[H[9]], r[H[10]], r[H[11]], r[H[12]], r[H[13]], r[H[14]],
                    r[H[15]]
                    );
                });
                } catch(e) {
                console.warn('[DEBUG][READ] error mostrando muestra:', e?.message || e);
                }
                // ===== FIN DEBUG READ =====

        // 1) Traer IDs inactivos locales
        const rsInactivos = await db.query(`
          SELECT id_presupuesto_ext
          FROM public.presupuestos
          WHERE activo = false
        `);
        const inactivosSet = new Set(rsInactivos.rows.map(r => (r.id_presupuesto_ext || '').toString().trim()));

        // 2) Filtrar cabeceras del pull
        const idCol = presupuestosData.headers[0]; // 'IDPresupuesto'
        const presupuestosRowsFiltradas = presupuestosData.rows.filter(row => !inactivosSet.has((row[idCol] || '').toString().trim()));

        // 3) Filtrar detalles del pull en base a los que quedaron en cabeceras
        const idsCabeceraVigentes = new Set(presupuestosRowsFiltradas.map(row => (row[idCol] || '').toString().trim()));
        const idPresCol = detallesData.headers[1]; // 'IdPresupuesto'
        const detallesRowsFiltradas = detallesData.rows.filter(row => idsCabeceraVigentes.has((row[idPresCol] || '').toString().trim()));

        // 4) Reemplazar colecciones para el resto del flujo
        presupuestosData.rows = presupuestosRowsFiltradas;
        detallesData.rows = detallesRowsFiltradas;

        // Log de control
        console.log(`[SYNC-FECHAS-FIX] Excluidos por baja lógica local: ${inactivosSet.size} IDs. ` +
                    `Quedan ${presupuestosData.rows.length} presupuestos y ${detallesData.rows.length} detalles a insertar.`);
        
        // Push de ALTAS locales a Sheets
        const insertedIds = await pushAltasLocalesASheets(presupuestosData, config, db);
        await pushDetallesLocalesASheets(insertedIds, config, db);
        
        // Releer hojas para incorporar lo que se acaba de escribir
        presupuestosData = await readSheetWithHeaders(config.hoja_id, 'A:O', 'Presupuestos');
        detallesData = await readSheetWithHeaders(config.hoja_id, 'A:Q', 'DetallesPresupuestos');

        // Reaplicar filtro de inactivos locales
        const rsInactivos2 = await db.query(`
          SELECT id_presupuesto_ext
          FROM public.presupuestos
          WHERE activo = false
        `);
        const inactivosSet2 = new Set(rsInactivos2.rows.map(r => (r.id_presupuesto_ext || '').toString().trim()));
        const idCol2    = presupuestosData.headers[0];   // 'IDPresupuesto'
        const idPres2   = detallesData.headers[1];       // 'IdPresupuesto'
        presupuestosData.rows = presupuestosData.rows.filter(row => !inactivosSet2.has((row[idCol2] || '').toString().trim()));
        const idsCab2 = new Set(presupuestosData.rows.map(row => (row[idCol2] || '').toString().trim()));
        detallesData.rows = detallesData.rows.filter(row => idsCab2.has((row[idPres2] || '').toString().trim()));

        console.log(`[SYNC-FECHAS-FIX] Releído tras push. Quedan ${presupuestosData.rows.length} cabezeras y ${detallesData.rows.length} detalles.`);
        
        resultado.datosLeidos.presupuestos = presupuestosData.rows.length;
        resultado.datosLeidos.detalles = detallesData.rows.length;
        
        console.log(`[SYNC-FECHAS-FIX] Datos leídos: ${resultado.datosLeidos.presupuestos} presupuestos, ${resultado.datosLeidos.detalles} detalles`);
        
        // PASO 3: Procesar y validar fechas (muestra de 5 ejemplos)
        console.log('[SYNC-FECHAS-FIX] Analizando fechas en muestra...');
        const muestraFechas = analizarMuestraFechas(presupuestosData.rows, presupuestosData.headers);
        resultado.ejemplosCorreccion = muestraFechas.ejemplos;
        
        // PASO 4: Ejecutar recarga completa atómica
        console.log('[SYNC-FECHAS-FIX] Iniciando recarga completa atómica...');
        await db.query('BEGIN');
        
        try {
            // Borrar datos existentes (CASCADE elimina detalles)
            await db.query('DELETE FROM presupuestos');
            console.log('[SYNC-FECHAS-FIX] ✅ Datos existentes eliminados');
            
            // Insertar presupuestos con fechas corregidas
            const presupuestosMap = new Map();
            
            for (let i = 0; i < presupuestosData.rows.length; i++) {
                const row = presupuestosData.rows[i];
                
                try {
                    const presupuesto = procesarPresupuesto(row, presupuestosData.headers, config);
                    
                    if (!presupuesto.id_presupuesto_ext || !presupuesto.id_cliente) {
                        continue; // Saltar filas inválidas
                    }
                    
                    const insertQuery = `
                        INSERT INTO presupuestos 
                        (id_presupuesto_ext, id_cliente, fecha, fecha_entrega, agente, tipo_comprobante,
                         nota, estado, informe_generado, cliente_nuevo_id, punto_entrega, descuento,
                         activo, fecha_actualizacion, hoja_nombre, hoja_url, usuario_id)
                        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, COALESCE($13, true), COALESCE($14, NOW()), $15, $16, $17)
                        RETURNING id
                    `;
                    

                        // ===== DEBUG PRE-INSERT (PRESUPUESTO) — solo primeros 3 y últimos 3 =====
                                try {
                                const N = presupuestosData.rows.length;
                                if (i < 3 || i >= N - 3) {
                                    console.log('[DEBUG][PRES-INSERT] id=%o id_cliente=%o fecha=%o fecha_entrega=%o agente=%o tipo=%o estado=%o desc=%o activo=%o lastMod=%o',
                                    presupuesto.id_presupuesto_ext, presupuesto.id_cliente, presupuesto.fecha, presupuesto.fecha_entrega,
                                    presupuesto.agente, presupuesto.tipo_comprobante, presupuesto.estado, presupuesto.descuento,
                                    presupuesto.activo, presupuesto.lastModified
                                    );
                                }
                                } catch(e) { /* silencio */ }
                        // ===== FIN DEBUG PRE-INSERT (PRESUPUESTO) =====



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
                        presupuesto.activo,
                        presupuesto.lastModified,
                        presupuesto.hoja_nombre,
                        presupuesto.hoja_url,
                        presupuesto.usuario_id
                    ]);
                    
                    const newId = insertResult.rows[0].id;
                    presupuestosMap.set(presupuesto.id_presupuesto_ext, {
                        id: newId,
                        lastModified: presupuesto.lastModified
                    });
                    resultado.datosInsertados.presupuestos++;
                    
                    if (presupuesto._fechaCorregida) {
                        resultado.fechasCorregidas++;
                    }
                    if (presupuesto._fechaNula) {
                        resultado.fechasNulas++;
                    }
                    if (presupuesto._activoFalse) {
                        conteoActivoFalse++;
                    }
                    if (presupuesto._sinLastModified) {
                        conteoSinLastModified++;
                    }
                    
                } catch (rowError) {
                    resultado.errores.push(`Presupuesto fila ${i + 2}: ${rowError.message}`);
                }
            }
            
            // Insertar detalles
            for (let i = 0; i < detallesData.rows.length; i++) {
                const row = detallesData.rows[i];
                
                try {
                    const presupuestoInfo = presupuestosMap.get(row[detallesData.headers[1]]);
                    const presupuestoLastModified = presupuestoInfo ? presupuestoInfo.lastModified : null;
                    
                    const detalle = procesarDetalle(row, detallesData.headers, presupuestoLastModified);
                    
                    if (!detalle.id_presupuesto_ext || !detalle.articulo) {
                        continue;
                    }
                    
                    if (!presupuestoInfo) {
                        resultado.errores.push(`Detalle fila ${i + 2}: Presupuesto ${detalle.id_presupuesto_ext} no encontrado`);
                        continue;
                    }
                    
                    const insertQuery = `
                        INSERT INTO presupuestos_detalles 
                        (id_presupuesto, id_presupuesto_ext, articulo, cantidad, valor1, precio1,
                         iva1, diferencia, camp1, camp2, camp3, camp4, camp5, camp6, fecha_actualizacion)
                        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, COALESCE($15, $16, NOW()))
                    `;
                    
                    // ===== DEBUG PRE-INSERT (DETALLE) — solo últimos 5 =====
                            try {
                            const lastN = 5;
                            if (i >= detallesData.rows.length - lastN) {
                                console.log('[DEBUG][DET-INSERT] idPresDB=%o idPresExt=%o art=%o cant=%o val1=%o precio1=%o iva1=%o dif=%o c1=%o c2=%o c3=%o c4=%o c5=%o c6=%o lastModDet=%o lastModPres=%o',
                                presupuestoInfo.id, detalle.id_presupuesto_ext, detalle.articulo, detalle.cantidad, detalle.valor1,
                                detalle.precio1, detalle.iva1, detalle.diferencia, detalle.camp1, detalle.camp2, detalle.camp3,
                                detalle.camp4, detalle.camp5, detalle.camp6, detalle.lastModifiedDetalle, detalle.presupuestoLastModified
                                );
                            }
                            } catch(e) { /* silencio */ }
                    // ===== FIN DEBUG PRE-INSERT (DETALLE) =====



                    await db.query(insertQuery, [
                        presupuestoInfo.id,
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
                        detalle.camp6,
                        detalle.lastModifiedDetalle,
                        detalle.presupuestoLastModified
                    ]);
                    
                    resultado.datosInsertados.detalles++;
                    
                } catch (rowError) {
                    resultado.errores.push(`Detalle fila ${i + 2}: ${rowError.message}`);
                }
            }
            
            // PASO 5: Validaciones finales
            console.log('[SYNC-FECHAS-FIX] Ejecutando validaciones finales...');
            
            // Verificar fechas futuras
            const fechasFuturasQuery = `
                SELECT COUNT(*) as count 
                FROM presupuestos 
                WHERE fecha > CURRENT_DATE
            `;
            const fechasFuturasResult = await db.query(fechasFuturasQuery);
            resultado.fechasFuturas = parseInt(fechasFuturasResult.rows[0].count);
            
            if (resultado.fechasFuturas > 0) {
                throw new Error(`Se detectaron ${resultado.fechasFuturas} fechas futuras después de la corrección`);
            }
            
            // Verificar integridad referencial
            const huerfanosQuery = `
                SELECT COUNT(*) as count 
                FROM presupuestos_detalles pd 
                LEFT JOIN presupuestos p ON pd.id_presupuesto = p.id 
                WHERE p.id IS NULL
            `;
            const huerfanosResult = await db.query(huerfanosQuery);
            const huerfanos = parseInt(huerfanosResult.rows[0].count);
            
            if (huerfanos > 0) {
                throw new Error(`Se detectaron ${huerfanos} detalles huérfanos`);
            }
            
            // CONFIRMAR TRANSACCIÓN
            await db.query('COMMIT');
            console.log('[SYNC-FECHAS-FIX] ✅ Transacción confirmada');
            
            resultado.exito = true;
            
        } catch (dbError) {
            await db.query('ROLLBACK');
            console.error('[SYNC-FECHAS-FIX] ❌ Error en transacción, rollback ejecutado:', dbError.message);
            throw dbError;
        }
        
    } catch (error) {
        console.error('[SYNC-FECHAS-FIX] ❌ Error en corrección de fechas:', error.message);
        resultado.errores.push(error.message);
        resultado.exito = false;
    } finally {
        resultado.finOperacion = new Date();
        resultado.duracionMs = resultado.finOperacion - resultado.inicioOperacion;
        
        // Registrar log de operación
        await registrarLogOperacion(db, resultado);
        
        // Mostrar resumen
        mostrarResumenOperacion(resultado);
        
        // Log breve con conteos adicionales (protegido para no romper la respuesta)
        try {
            console.log(
                `[SYNC-FECHAS-FIX] Conteos adicionales: {total: ${resultado.datosInsertados.presupuestos}, ` +
                `conActivoFalse: ${conteoActivoFalse ?? 0}, sinLastModified: ${conteoSinLastModified ?? 0}}`
            );
        } catch (e) {
            console.warn('[SYNC-FECHAS-FIX] Omitiendo log de conteos:', e?.message);
        }
    }
    
    return resultado;
}

/**
 * Analizar muestra de fechas para logging
 */
function analizarMuestraFechas(rows, headers) {
    console.log('[SYNC-FECHAS-FIX] Analizando muestra de fechas...');
    
    const ejemplos = [];
    const idsEjemplo = ['101d4e1a', '3fb5b0b5', 'a7cbccc8']; // IDs mencionados por el usuario
    
    // Buscar ejemplos específicos primero
    for (const row of rows) {
        const idPresupuesto = row[headers[0]];
        if (idsEjemplo.includes(idPresupuesto) && ejemplos.length < 5) {
            const fechaOriginal = row[headers[1]];
            const fechaParseada = parseDate(fechaOriginal);
            
            ejemplos.push({
                id_presupuesto_ext: idPresupuesto,
                valorCrudo: fechaOriginal,
                tipoOriginal: typeof fechaOriginal,
                fechaParseada: fechaParseada,
                fechaGuardada: fechaParseada || 'NULL'
            });
        }
    }
    
    // Completar con otros ejemplos si es necesario
    let contador = 0;
    for (const row of rows) {
        if (ejemplos.length >= 5) break;
        
        const idPresupuesto = row[headers[0]];
        const fechaOriginal = row[headers[1]];
        
        if (!idsEjemplo.includes(idPresupuesto) && fechaOriginal && contador < 2) {
            const fechaParseada = parseDate(fechaOriginal);
            
            ejemplos.push({
                id_presupuesto_ext: idPresupuesto,
                valorCrudo: fechaOriginal,
                tipoOriginal: typeof fechaOriginal,
                fechaParseada: fechaParseada,
                fechaGuardada: fechaParseada || 'NULL'
            });
            contador++;
        }
    }
    
    return { ejemplos };
}

/**
 * Helper para parsear LastModified
 */
function parseLastModified(value) {
    if (!value || value === '') return null;
    
    try {
        // Intentar parseo directo con new Date()
        const date = new Date(value);
        if (!isNaN(date.getTime())) {
            return date.toISOString();
        }
        
        // Intentar formato dd/mm/yyyy hh:mm[:ss]
        const ddmmyyyyRegex = /^(\d{1,2})\/(\d{1,2})\/(\d{4})\s+(\d{1,2}):(\d{2})(?::(\d{2}))?$/;
        const match = value.match(ddmmyyyyRegex);
        
        if (match) {
            const [, day, month, year, hour, minute, second = '00'] = match;
            const parsedDate = new Date(year, month - 1, day, hour, minute, second);
            
            if (!isNaN(parsedDate.getTime())) {
                return parsedDate.toISOString();
            }
        }
        
        return null;
    } catch (error) {
        return null;
    }
}

/**
 * Procesar fila de presupuesto con corrección de fechas
 */
function procesarPresupuesto(row, headers, config) {
    // Procesar columna Activo (columna O = headers[14])
    const activoValue = row[headers[14]];
    let activo = true; // default
    if (activoValue !== undefined && activoValue !== null && activoValue !== '') {
        const activoStr = activoValue.toString().toLowerCase();
        if (activoStr === 'false' || activoStr === '0') {
            activo = false;
        } else if (activoStr === 'true' || activoStr === '1') {
            activo = true;
        }
        // Si es otro valor, mantener default true
    }
    
    // Procesar columna LastModified (columna N = headers[13])
    const lastModifiedValue = row[headers[13]];
    const lastModified = parseLastModified(lastModifiedValue);
    
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
        activo: activo,
        lastModified: lastModified,
        hoja_nombre: 'Presupuestos',
        hoja_url: config.hoja_url,
        usuario_id: config.usuario_id || null,
        _fechaCorregida: false,
        _fechaNula: false,
        _activoFalse: !activo,
        _sinLastModified: !lastModified
    };
    
    // Procesar fecha principal
    const fechaOriginal = row[headers[1]];
    if (fechaOriginal) {
        const fechaParseada = parseDate(fechaOriginal);
        if (fechaParseada) {
            presupuesto.fecha = fechaParseada;
            presupuesto._fechaCorregida = true;
        } else {
            presupuesto._fechaNula = true;
        }
    } else {
        presupuesto._fechaNula = true;
    }
    
    // Procesar fecha de entrega
    const fechaEntregaOriginal = row[headers[4]];
    if (fechaEntregaOriginal && fechaEntregaOriginal !== '1970-01-01') {
        presupuesto.fecha_entrega = parseDate(fechaEntregaOriginal);
    }
    
    return presupuesto;
}

/**
 * Procesar fila de detalle
 */
function procesarDetalle(row, headers, presupuestoLastModified = null) {
    // Procesar columna LastModified de detalle (columna P = headers[15])
    const lastModifiedDetalleValue = row[headers[15]];
    const lastModifiedDetalle = parseLastModified(lastModifiedDetalleValue);
    
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
        camp6: parseFloat(row[headers[14]]) || 0,
        lastModifiedDetalle: lastModifiedDetalle,
        presupuestoLastModified: presupuestoLastModified
    };
}

/**
 * Registrar log de operación
 */
async function registrarLogOperacion(db, resultado) {
    try {
        const insertLogQuery = `
            INSERT INTO presupuestos_sync_log 
            (registros_procesados, registros_nuevos, registros_actualizados, 
             errores, fecha_sync, exitoso, usuario_id, duracion_segundos)
            VALUES ($1, $2, $3, $4, NOW(), $5, $6, $7)
            RETURNING id
        `;
        
        const erroresText = resultado.errores.length > 0 ? resultado.errores.join('\n') : null;
        const duracionSegundos = Math.round(resultado.duracionMs / 1000);
        
        await db.query(insertLogQuery, [
            resultado.datosLeidos.presupuestos + resultado.datosLeidos.detalles,
            resultado.datosInsertados.presupuestos + resultado.datosInsertados.detalles,
            0, // No hay actualizaciones en full refresh
            erroresText,
            resultado.exito,
            null, // usuario_id
            duracionSegundos
        ]);
        
        console.log('[SYNC-FECHAS-FIX] ✅ Log de operación registrado');
        
    } catch (error) {
        console.error('[SYNC-FECHAS-FIX] ❌ Error registrando log:', error.message);
    }
}

/**
 * Mostrar resumen de operación
 */
function mostrarResumenOperacion(resultado) {
    console.log('[SYNC-FECHAS-FIX] ===== RESUMEN DE CORRECCIÓN DE FECHAS =====');
    console.log(`[SYNC-FECHAS-FIX] Éxito: ${resultado.exito ? 'SÍ' : 'NO'}`);
    console.log(`[SYNC-FECHAS-FIX] Duración: ${Math.round(resultado.duracionMs / 1000)} segundos`);
    console.log(`[SYNC-FECHAS-FIX] Datos leídos: ${resultado.datosLeidos.presupuestos} presupuestos, ${resultado.datosLeidos.detalles} detalles`);
    console.log(`[SYNC-FECHAS-FIX] Datos insertados: ${resultado.datosInsertados.presupuestos} presupuestos, ${resultado.datosInsertados.detalles} detalles`);
    console.log(`[SYNC-FECHAS-FIX] Fechas corregidas: ${resultado.fechasCorregidas}`);
    console.log(`[SYNC-FECHAS-FIX] Fechas nulas: ${resultado.fechasNulas}`);
    console.log(`[SYNC-FECHAS-FIX] Fechas futuras (debe ser 0): ${resultado.fechasFuturas}`);
    console.log(`[SYNC-FECHAS-FIX] Errores: ${resultado.errores.length}`);
    
    if (resultado.ejemplosCorreccion.length > 0) {
        console.log('[SYNC-FECHAS-FIX] Ejemplos de corrección aplicada:');
        resultado.ejemplosCorreccion.forEach((ejemplo, index) => {
            console.log(`[SYNC-FECHAS-FIX]   ${index + 1}. ID: ${ejemplo.id_presupuesto_ext}`);
            console.log(`[SYNC-FECHAS-FIX]      Valor crudo: ${ejemplo.valorCrudo} (${ejemplo.tipoOriginal})`);
            console.log(`[SYNC-FECHAS-FIX]      Fecha parseada: ${ejemplo.fechaParseada}`);
            console.log(`[SYNC-FECHAS-FIX]      Fecha guardada: ${ejemplo.fechaGuardada}`);
        });
    }
    
    if (resultado.errores.length > 0 && resultado.errores.length <= 5) {
        console.log('[SYNC-FECHAS-FIX] Errores detectados:');
        resultado.errores.forEach((error, index) => {
            console.log(`[SYNC-FECHAS-FIX]   ${index + 1}. ${error}`);
        });
    } else if (resultado.errores.length > 5) {
        console.log(`[SYNC-FECHAS-FIX] ${resultado.errores.length} errores detectados (mostrando primeros 3):`);
        resultado.errores.slice(0, 3).forEach((error, index) => {
            console.log(`[SYNC-FECHAS-FIX]   ${index + 1}. ${error}`);
        });
    }
    
    console.log('[SYNC-FECHAS-FIX] ===== FIN RESUMEN =====');
}

// Fecha y hora como las ves en Sheets/AppSheet (AR): dd/mm/aaaa HH:MM:SS
function toSheetDateTimeAR(value) {
  const d = value ? new Date(value) : new Date();
  // Forzamos zona horaria de Argentina para que coincida con AppSheet/Sheets
  const f = new Intl.DateTimeFormat('es-AR', {
    timeZone: 'America/Argentina/Buenos_Aires',
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
    hour12: false
  }).formatToParts(d);
  const parts = Object.fromEntries(f.map(p => [p.type, p.value]));
  return `${parts.day}/${parts.month}/${parts.year} ${parts.hour}:${parts.minute}:${parts.second}`;
}

// helper simple para fechas en Sheets (d/m/yyyy)
function toSheetDate(val) {
  if (!val) return '';
  const d = new Date(val);
  if (isNaN(d)) {
    // si ya viene en texto d/m/yyyy, lo dejamos
    return String(val);
  }
  const dd = String(d.getDate()).padStart(2, '0');
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const yyyy = d.getFullYear();
  return `${dd}/${mm}/${yyyy}`;
}

/**
 * Push de ALTAS locales a Google Sheets (append-only sin necesita_sync_sheets)
 */
async function pushAltasLocalesASheets(presupuestosData, config, db) {
  try {
    const { getSheets } = require('../../google/gsheetsClient');
    const sheets = await getSheets();

    // Armar set de IDs remotos con lo que ya leíste de Sheets
    const idCol = presupuestosData.headers[0]; // "IDPresupuesto" ya existe en el log
    const remoteIds = new Set(presupuestosData.rows.map(r => r[idCol]).filter(Boolean));

    // Seleccionar candidatos locales (sin flags extra) y filtrar en JS
    const { rows: locales } = await db.query(`
      SELECT id_presupuesto_ext, id_cliente, agente, fecha, fecha_entrega, tipo_comprobante,
             nota, estado, informe_generado, cliente_nuevo_id, punto_entrega, descuento,
             activo, fecha_actualizacion
      FROM presupuestos
      WHERE activo = true
    `);
    
    const toInsert = locales.filter(p => !remoteIds.has(p.id_presupuesto_ext));
    const insertedIds = new Set(toInsert.map(p => p.id_presupuesto_ext));
    console.log('[SYNC-BTN] phase=push-upserts count=%d', insertedIds.size);
    console.log('[DIAG-PUSH-DET] sampleInserted=%o', Array.from(insertedIds).slice(0,5));

    if (toInsert.length === 0) return insertedIds;

    // Usar el writer/mapeo existente tal cual está para hacer append de toInsert a Presupuestos!A:O
    const data = toInsert.map(r => {
      const pct = r.descuento == null ? null : Number(r.descuento);
      const pctStr = pct == null ? '' : (pct > 1 ? `${pct}%` : `${pct*100}%`);
      
      // Normalizar LastModified a formato AppSheet Argentina
      const lastModifiedAR = toSheetDateTimeAR(r.fecha_actualizacion || Date.now());
      
      return [
        (r.id_presupuesto_ext ?? '').toString().trim(),     // A  IDPresupuesto
        toSheetDate(r.fecha),                               // B  Fecha
        r.id_cliente ?? '',                                 // C  IDCliente
        r.agente ?? '',                                     // D  Agente
        toSheetDate(r.fecha_entrega),                       // E  Fecha de entrega
        r.tipo_comprobante ?? '',                           // F  Factura/Efectivo
        r.nota ?? '',                                       // G  Nota
        r.estado ?? '',                                     // H  Estado
        r.informe_generado ?? '',                           // I  InformeGenerado
        r.cliente_nuevo_id ?? '',                           // J  ClienteNuevID
        '',                                                 // K  Estado/ImprimePDF (quedará vacío)
        r.punto_entrega ?? '',                              // L  PuntoEntrega
        pctStr,                                             // M  Descuento
        lastModifiedAR,                                     // N  LastModified (formato AppSheet AR)
        true                                                // O  Activo
      ];
    });

    // Append a Presupuestos!A:O con config.hoja_id
    await sheets.spreadsheets.values.append({
      spreadsheetId: config.hoja_id,
      range: 'Presupuestos!A1:O1',
      valueInputOption: 'RAW',
      insertDataOption: 'INSERT_ROWS',
      requestBody: { values: data, majorDimension: 'ROWS' }
    });

    console.log(`[SYNC-FECHAS-FIX] Push de ALTAS a Sheets: ${toInsert.length} encabezados agregados.`);
    
    return insertedIds;
  } catch (e) {
    console.warn('[SYNC-FECHAS-FIX] No se pudieron empujar ALTAS locales a Sheets:', e?.message);
    return new Set();
  }
}

async function pushDetallesLocalesASheets(insertedIds, config, db) {
  console.log('[DIAG-PUSH-DET] called opts=', { insertedIds, config });
  console.log('[DIAG-PUSH-DET] mode=append-only (actual), supportsReplace=false');

  try {
    if (!insertedIds || insertedIds.size === 0) return;
    const ids = Array.from(insertedIds);
    const { getSheets } = require('../../google/gsheetsClient');
    const sheets = await getSheets();
    const nowAR = toSheetDateTimeAR(Date.now());

    // Traer detalles locales de esas cabeceras nuevas
    const rs = await db.query(
      `
      SELECT d.id_presupuesto_ext, d.articulo, d.cantidad, d.valor1, d.precio1,
             d.iva1, d.diferencia, d.camp1, d.camp2, d.camp3, d.camp4, d.camp5, d.camp6
      FROM public.presupuestos_detalles d
      WHERE d.id_presupuesto_ext = ANY($1)
      `,
      [ids]
    );
    if (rs.rows.length === 0) return;

    const num2 = v => (v == null || v === '') ? '' : Math.round(Number(v) * 100) / 100;   // 2 decimales
    const num3 = v => (v == null || v === '') ? '' : Math.round(Number(v) * 1000) / 1000; // 3 decimales (camp2 %)
    const asText = v => (v == null) ? '' : String(v).trim();
    const mkId = r => crypto.createHash('sha1')
      .update(`${r.id_presupuesto_ext}|${r.articulo}|${r.cantidad}|${r.valor1}|${r.precio1}|${r.iva1}|${r.diferencia}|${r.camp1}|${r.camp2}|${r.camp3}|${r.camp4}|${r.camp5}|${r.camp6}`)
      .digest('hex').slice(0, 8);

    // Mapeo EXACTO DetallesPresupuestos A:Q (SHIFT IZQUIERDA de los CAMP*)
    // I: Camp1  <= camp1 (local)
    // J: Camp2  <= camp2 (local, % con 3 decimales)
    // K: Camp3  <= camp3 (local)
    // L: Camp4  <= camp4 (local)
    // M: Camp5  <= camp5 (local)
    // N: Camp6  <= camp6 (local)
    // O: Condicion (sin fuente local -> vacío)
    const values = rs.rows.map(r => {
      const row = [
        mkId(r),                        // A  IDDetallePresupuesto
        asText(r.id_presupuesto_ext),   // B  IdPresupuesto
        asText(r.articulo),             // C  Articulo
        num2(r.cantidad),               // D  Cantidad
        num2(r.valor1),                 // E  Valor1
        num2(r.precio1),                // F  Precio1
        num2(r.iva1),                   // G  IVA1
        num2(r.diferencia),             // H  Diferencia
        num2(r.camp1),                  // I  Camp1   (J→I)
        num3(r.camp2),                  // J  Camp2   (K→J)  *** % ***
        num2(r.camp3),                  // K  Camp3   (L→K)
        num2(r.camp4),                  // L  Camp4   (M→L)
        num2(r.camp5),                  // M  Camp5   (N→M)
        num2(r.camp6),                  // N  Camp6   (O→N)
        '',                             // O  Condicion (queda vacío)
        nowAR,                          // P  LastModified (AppSheet AR)
        true                            // Q  Activo
      ];

      console.log('[PUSH-DET][SHIFT OK]', {
        id: row[1], art: row[2],
        I_c1: row[8],  J_c2: row[9],   K_c3: row[10],
        L_c4: row[11], M_c5: row[12],  N_c6: row[13], O_cond: row[14]
      });
      return row;
    });

    await sheets.spreadsheets.values.append({
      spreadsheetId: config.hoja_id,
      range: 'DetallesPresupuestos!A1:Q1',
      valueInputOption: 'RAW',
      insertDataOption: 'INSERT_ROWS',
      requestBody: { values, majorDimension: 'ROWS' }
    });

    console.log(`[SYNC-FECHAS-FIX] Push de DETALLES a Sheets: ${values.length} filas agregadas para ${ids.length} cabeceras.`);

    // Lectura rápida y log de cola
    const tailRead = await sheets.spreadsheets.values.get({
      spreadsheetId: config.hoja_id,
      range: 'DetallesPresupuestos!A:Q'
    });
    const body = tailRead.data.values || [];
    console.log('[PUSH-DET][SHEET] últimas 5 A..Q:', body.slice(-5));
  } catch (e) {
    console.warn('[SYNC-FECHAS-FIX] No se pudieron empujar DETALLES locales a Sheets:', e?.message);
  }
}

/**
 * Sincronizar detalles modificados localmente a Google Sheets
 * Detecta por fecha_actualizacion y actualiza filas existentes o hace append
 */
async function pushDetallesModificadosASheets(config, db) {
  console.log('[DIAG-UPD-DET] Iniciando sincronización de detalles modificados...');
  
  try {
    const { getSheets } = require('../../google/gsheetsClient');
    const sheets = await getSheets();
    
    // 1. Leer detalles actuales de Sheets
    const detallesSheets = await readSheetWithHeaders(config.hoja_id, 'A:Q', 'DetallesPresupuestos');
    
    // 2. Detectar detalles modificados localmente (últimas 24 horas)
    const rs = await db.query(`
      SELECT d.id_presupuesto_ext, d.articulo, d.cantidad, d.valor1, d.precio1,
             d.iva1, d.diferencia, d.camp1, d.camp2, d.camp3, d.camp4, d.camp5, d.camp6,
             d.fecha_actualizacion
      FROM public.presupuestos_detalles d
      INNER JOIN public.presupuestos p ON p.id_presupuesto_ext = d.id_presupuesto_ext
      WHERE p.activo = true 
      AND d.fecha_actualizacion >= NOW() - INTERVAL '24 hours'
      ORDER BY d.fecha_actualizacion DESC
    `);
    
    if (rs.rows.length === 0) {
      console.log('[DIAG-UPD-DET] No hay detalles modificados en las últimas 24 horas');
      return;
    }
    
    console.log(`[DIAG-UPD-DET] Encontrados ${rs.rows.length} detalles modificados localmente`);
    
    // 3. Crear mapas para búsqueda eficiente
    const num2 = v => (v == null || v === '') ? '' : Math.round(Number(v) * 100) / 100;
    const num3 = v => (v == null || v === '') ? '' : Math.round(Number(v) * 1000) / 1000;
    const asText = v => (v == null) ? '' : String(v).trim();
    const nowAR = toSheetDateTimeAR(Date.now());
    
    const mkId = r => crypto.createHash('sha1')
      .update(`${r.id_presupuesto_ext}|${r.articulo}|${r.cantidad}|${r.valor1}|${r.precio1}|${r.iva1}|${r.diferencia}|${r.camp1}|${r.camp2}|${r.camp3}|${r.camp4}|${r.camp5}|${r.camp6}`)
      .digest('hex').slice(0, 8);
    
    // Crear mapa de filas existentes en Sheets por IDDetallePresupuesto
    const sheetRowMap = new Map();
    detallesSheets.rows.forEach((row, index) => {
      const idDetalle = row[detallesSheets.headers[0]]; // Columna A: IDDetallePresupuesto
      if (idDetalle) {
        sheetRowMap.set(idDetalle, index + 2); // +2 porque fila 1 es header
      }
    });
    
    let actualizados = 0;
    let insertados = 0;
    const sampleRows = [];
    
    // 4. Procesar cada detalle modificado con LOGS DETALLADOS
    for (const r of rs.rows) {
      const idDetalle = mkId(r);
      const existingRowIndex = sheetRowMap.get(idDetalle);
      
      // LOG DETALLADO: Valores originales de BD local
      console.log(`[DIAG-UPD-DET] ORIGINAL BD: id=${r.id_presupuesto_ext} art=${r.articulo}`);
      console.log(`[DIAG-UPD-DET] VALORES BD: precio1=${r.precio1} iva1=${r.iva1} camp1=${r.camp1} camp2=${r.camp2} camp3=${r.camp3} camp4=${r.camp4} camp5=${r.camp5} camp6=${r.camp6}`);
      
      // MAPEO EXACTO COPIADO DE pushDetallesLocalesASheets (que funciona)
      const mappedRow = [
        idDetalle,                      // A  IDDetallePresupuesto
        asText(r.id_presupuesto_ext),   // B  IdPresupuesto
        asText(r.articulo),             // C  Articulo
        num2(r.cantidad),               // D  Cantidad
        num2(r.valor1),                 // E  Valor1
        num2(r.precio1),                // F  Precio1
        num2(r.iva1),                   // G  IVA1
        num2(r.diferencia),             // H  Diferencia
        num2(r.camp1),                  // I  Camp1   (J→I)
        num3(r.camp2),                  // J  Camp2   (K→J)  *** % ***
        num2(r.camp3),                  // K  Camp3   (L→K)
        num2(r.camp4),                  // L  Camp4   (M→L)
        num2(r.camp5),                  // M  Camp5   (N→M)
        num2(r.camp6),                  // N  Camp6   (O→N)
        '',                             // O  Condicion (queda vacío)
        nowAR,                          // P  LastModified (AppSheet AR)
        true                            // Q  Activo
      ];
      
      // LOG DETALLADO: Valores después del mapeo
      console.log(`[DIAG-UPD-DET] MAPEADO: F=${mappedRow[5]} G=${mappedRow[6]} I=${mappedRow[8]} J=${mappedRow[9]} K=${mappedRow[10]} L=${mappedRow[11]} M=${mappedRow[12]} N=${mappedRow[13]}`);
      console.log(`[DIAG-UPD-DET] FUNCIONES: num2(${r.precio1})=${num2(r.precio1)} num2(${r.iva1})=${num2(r.iva1)} num2(${r.camp1})=${num2(r.camp1)} num3(${r.camp2})=${num3(r.camp2)}`);
      
      if (existingRowIndex) {
        console.log(`[DIAG-UPD-DET] ACTUALIZANDO fila ${existingRowIndex} para ${r.id_presupuesto_ext}`);
        // Actualizar fila existente
        await sheets.spreadsheets.values.update({
          spreadsheetId: config.hoja_id,
          range: `DetallesPresupuestos!A${existingRowIndex}:Q${existingRowIndex}`,
          valueInputOption: 'USER_ENTERED',
          requestBody: {
            values: [mappedRow],
            majorDimension: 'ROWS'
          }
        });
        actualizados++;
        console.log(`[DIAG-UPD-DET] ✅ ACTUALIZADO fila ${existingRowIndex}`);
      } else {
        console.log(`[DIAG-UPD-DET] INSERTANDO nueva fila para ${r.id_presupuesto_ext}`);
        // Insertar nueva fila
        await sheets.spreadsheets.values.append({
          spreadsheetId: config.hoja_id,
          range: 'DetallesPresupuestos!A1:Q1',
          valueInputOption: 'USER_ENTERED',
          insertDataOption: 'INSERT_ROWS',
          requestBody: {
            values: [mappedRow],
            majorDimension: 'ROWS'
          }
        });
        insertados++;
        console.log(`[DIAG-UPD-DET] ✅ INSERTADO nueva fila`);
      }
      
      // Guardar muestra para logs
      if (sampleRows.length < 3) {
        sampleRows.push({
          id: r.id_presupuesto_ext,
          articulo: r.articulo,
          precio1_original: r.precio1,
          precio1_mapeado: mappedRow[5],
          camp1_original: r.camp1,
          camp1_mapeado: mappedRow[8],
          camp2_original: r.camp2,
          camp2_mapeado: mappedRow[9],
          action: existingRowIndex ? 'UPDATE' : 'INSERT'
        });
      }
    }
    
    console.log(`[DIAG-UPD-DET] actualizados=${actualizados} insertados=${insertados} sample=${JSON.stringify(sampleRows)}`);
    
  } catch (error) {
    console.error('[DIAG-UPD-DET] Error sincronizando detalles modificados:', error.message);
  }
}


console.log('[SYNC-FECHAS-FIX] ✅ Servicio de corrección de fechas configurado');

module.exports = {
    ejecutarCorreccionFechas,
    pushAltasLocalesASheets,
    pushDetallesLocalesASheets,
    pushDetallesModificadosASheets
};
