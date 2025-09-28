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
        // PASO 0: Obtener configuración activa una sola vez
        console.log('[SYNC-FECHAS-FIX] Obteniendo configuración activa...');
        const configQuery = `
            SELECT hoja_url
            FROM presupuestos_config
            WHERE activo = true
            ORDER BY id DESC
            LIMIT 1
        `;
        const configResult = await db.query(configQuery);
        
        if (configResult.rows.length === 0) {
            throw new Error('No se encontró configuración activa en presupuestos_config');
        }
        
        const configHojaUrl = configResult.rows[0].hoja_url;
        console.log(`[SINCRO] Config hoja_url: ${configHojaUrl}`);
        
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
                    const presupuesto = procesarPresupuesto(row, presupuestosData.headers, config, configHojaUrl);
                    
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
            
            // PASO 5: Completar campos hoja_url y usuario_id para presupuestos procesados
            console.log('[SYNC-FECHAS-FIX] Completando campos hoja_url y usuario_id...');
            
            // Obtener IDs de los presupuestos procesados en esta sincronización
            const idsPresupuestosProcesados = Array.from(presupuestosMap.keys());
            console.log(`[SINCRO] IDs a completar: [${idsPresupuestosProcesados.join(', ')}]`);
            
            if (idsPresupuestosProcesados.length > 0) {
                // Obtener los IDs internos de la base de datos para los presupuestos procesados
                const idsInternosQuery = `
                    SELECT id FROM presupuestos 
                    WHERE id_presupuesto_ext = ANY($1::text[])
                `;
                const idsInternosResult = await db.query(idsInternosQuery, [idsPresupuestosProcesados]);
                const idsInternos = idsInternosResult.rows.map(row => row.id);
                
                // Completar hoja_url para los presupuestos que lo tengan NULL
                const updateHojaUrlQuery = `
                    UPDATE presupuestos 
                    SET hoja_url = $1 
                    WHERE hoja_url IS NULL 
                      AND id = ANY($2::int[])
                `;
                const hojaUrlResult = await db.query(updateHojaUrlQuery, [configHojaUrl, idsInternos]);
                
                // Completar usuario_id = 1 para los presupuestos que lo tengan NULL
                const updateUsuarioIdQuery = `
                    UPDATE presupuestos 
                    SET usuario_id = 1 
                    WHERE usuario_id IS NULL 
                      AND id = ANY($1::int[])
                `;
                const usuarioIdResult = await db.query(updateUsuarioIdQuery, [idsInternos]);
                
                console.log(`[SINCRO] Actualizados hoja_url: ${hojaUrlResult.rowCount} / usuario_id: ${usuarioIdResult.rowCount}`);
            }
            
            // PASO 6: Validaciones finales
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
function procesarPresupuesto(row, headers, config, configHojaUrl) {
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
        hoja_url: configHojaUrl, // Usar la URL obtenida de la configuración activa
        usuario_id: 1, // Asignar 1 por defecto como se solicitó
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
 * Push de cambios locales a Google Sheets (nuevos + modificados)
 * RETORNA: { insertedIds, modifiedIds } para distinguir nuevos vs modificados
 */
async function pushCambiosLocalesConTimestamp(presupuestosData, config, db) {
  try {
    const { getSheets } = require('../../google/gsheetsClient');
    const sheets = await getSheets();

    // Armar set de IDs remotos con lo que ya leíste de Sheets
    const idCol = presupuestosData.headers[0]; // "IDPresupuesto"
    const remoteIds = new Set(presupuestosData.rows.map(r => r[idCol]).filter(Boolean));

    // DETECTAR PRESUPUESTOS CON CAMBIOS (nuevos O con detalles modificados)
    const cutoffAt = config.cutoff_at;
    console.log('[PUSH-HEAD] Aplicando filtro cutoff_at:', cutoffAt);
    
    const { rows: locales } = await db.query(`
      SELECT DISTINCT p.id_presupuesto_ext, p.id_cliente, p.agente, p.fecha, p.fecha_entrega, 
             p.tipo_comprobante, p.nota, p.estado, p.informe_generado, p.cliente_nuevo_id, 
             p.punto_entrega, p.descuento, p.activo, p.fecha_actualizacion
      FROM presupuestos p
      LEFT JOIN presupuestos_detalles d ON d.id_presupuesto_ext = p.id_presupuesto_ext
      WHERE p.activo = true 
        AND (
          p.fecha_actualizacion > $1  -- Presupuesto modificado (ESTRICTO: solo posteriores)
          OR d.fecha_actualizacion > $1  -- Detalle modificado (ESTRICTO: solo posteriores)
        )
    `, [cutoffAt]);
    
    // SEPARAR: nuevos (INSERT) vs modificados (UPDATE)
    const toInsert = locales.filter(p => !remoteIds.has(p.id_presupuesto_ext));
    const toUpdate = locales.filter(p => remoteIds.has(p.id_presupuesto_ext));
    
    const insertedIds = new Set(toInsert.map(p => p.id_presupuesto_ext));
    const modifiedIds = new Set(toUpdate.map(p => p.id_presupuesto_ext));
    
    console.log('[PUSH-HEAD] nuevos=%d modificados=%d', insertedIds.size, modifiedIds.size);

    // INSERTAR NUEVOS
    if (toInsert.length > 0) {
      const data = toInsert.map(r => {
        const pct = r.descuento == null ? null : Number(r.descuento);
        const pctStr = pct == null ? '' : (pct > 1 ? `${pct}%` : `${pct*100}%`);
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

      await sheets.spreadsheets.values.append({
        spreadsheetId: config.hoja_id,
        range: 'Presupuestos!A1:O1',
        valueInputOption: 'RAW',
        insertDataOption: 'INSERT_ROWS',
        requestBody: { values: data, majorDimension: 'ROWS' }
      });

      // Log específico solicitado
      toInsert.forEach(p => {
        console.log(`[PUSH-HEAD] INSERT-OK: ${p.id_presupuesto_ext}`);
      });
    }

    // ACTUALIZAR MODIFICADOS (headers en Sheets)
    if (toUpdate.length > 0) {
      // Crear mapa de filas existentes en Sheets
      const sheetRowMap = new Map();
      presupuestosData.rows.forEach((row, index) => {
        const idPresupuesto = row[idCol];
        if (idPresupuesto) {
          sheetRowMap.set(idPresupuesto, index + 2); // +2 porque fila 1 es header
        }
      });

      for (const r of toUpdate) {
        const rowIndex = sheetRowMap.get(r.id_presupuesto_ext);
        if (rowIndex) {
          const pct = r.descuento == null ? null : Number(r.descuento);
          const pctStr = pct == null ? '' : (pct > 1 ? `${pct}%` : `${pct*100}%`);
          const lastModifiedAR = toSheetDateTimeAR(r.fecha_actualizacion || Date.now());
          
          const updatedRow = [
            (r.id_presupuesto_ext ?? '').toString().trim(),
            toSheetDate(r.fecha),
            r.id_cliente ?? '',
            r.agente ?? '',
            toSheetDate(r.fecha_entrega),
            r.tipo_comprobante ?? '',
            r.nota ?? '',
            r.estado ?? '',
            r.informe_generado ?? '',
            r.cliente_nuevo_id ?? '',
            '',
            r.punto_entrega ?? '',
            pctStr,
            lastModifiedAR,
            true
          ];

          await sheets.spreadsheets.values.update({
            spreadsheetId: config.hoja_id,
            range: `Presupuestos!A${rowIndex}:O${rowIndex}`,
            valueInputOption: 'RAW',
            requestBody: {
              values: [updatedRow],
              majorDimension: 'ROWS'
            }
          });

          console.log(`[PUSH-HEAD] UPDATE-OK: ${r.id_presupuesto_ext}`);
        }
      }
    }

    console.log('[PUSH-HEAD] ✅ Solo NUEVOS para detalles: %d', insertedIds.size);
    console.log('[PUSH-HEAD] ✅ Solo MODIFICADOS para replace-all: %d', modifiedIds.size);
    
    return { insertedIds, modifiedIds };
  } catch (e) {
    console.warn('[PUSH-HEAD] Error en push de cambios:', e?.message);
    return { insertedIds: new Set(), modifiedIds: new Set() };
  }
}

// Mantener función legacy para compatibilidad
async function pushAltasLocalesASheets(presupuestosData, config, db) {
  const result = await pushCambiosLocalesConTimestamp(presupuestosData, config, db);
  return result.insertedIds;
}

async function pushDetallesLocalesASheets(confirmedHeaderIds, config, db) {
  console.log('[DIAG-PUSH-DET] called opts=', { confirmedHeaderIds, config });
  console.log('[DIAG-PUSH-DET] mode=smart-replace (CORREGIDO), supportsReplace=true');

  console.log('[PUSH-DET] start', {
    count: confirmedHeaderIds?.size || 0,
    ids: Array.from(confirmedHeaderIds || [])
  });

  try {
    if (!confirmedHeaderIds || confirmedHeaderIds.size === 0) {
      console.log('[PUSH-DET] omitido: sin encabezados confirmados');
      return;
    }

    const idsConfirmados = Array.from(confirmedHeaderIds);
    console.log('[PUSH-DET] IDs confirmados en esta corrida:', idsConfirmados);

    // ===== PASO 0: DETECTAR PRESUPUESTOS MODIFICADOS VS NUEVOS (LÓGICA ROBUSTA) =====
    console.log('[PUSH-DET] === PASO 0: DETECTANDO MODIFICADOS VS NUEVOS (MÚLTIPLES INDICADORES) ===');
    
    // INDICADOR 1: Presupuestos que YA tienen entradas en MAP
    const presupuestosConMap = await db.query(`
      SELECT DISTINCT d.id_presupuesto_ext
      FROM presupuestos_detalles d
      INNER JOIN presupuestos_detalles_map m ON m.local_detalle_id = d.id
      WHERE d.id_presupuesto_ext = ANY($1)
    `, [idsConfirmados]);
    
    const idsConMap = new Set(presupuestosConMap.rows.map(r => r.id_presupuesto_ext));
    
    // INDICADOR 2: Presupuestos que YA existen en Sheets (desde pushCambiosLocalesConTimestamp)
    // Leer datos actuales de Sheets para verificar existencia
    const presupuestosSheets = await readSheetWithHeaders(config.hoja_id, 'A:O', 'Presupuestos');
    const idsEnSheets = new Set(
      presupuestosSheets.rows
        .map(row => (row[presupuestosSheets.headers[0]] || '').toString().trim())
        .filter(Boolean)
    );
    
    // LÓGICA COMBINADA: Es MODIFICADO si tiene MAP O si ya existe en Sheets
    const idsModificados = new Set([
      ...Array.from(idsConMap),
      ...idsConfirmados.filter(id => idsEnSheets.has(id))
    ]);
    
    const idsNuevos = new Set(idsConfirmados.filter(id => !idsModificados.has(id)));
    
    console.log(`[PUSH-DET] NUEVOS (sin MAP + sin Sheets): ${idsNuevos.size} → ${Array.from(idsNuevos).join(', ')}`);
    console.log(`[PUSH-DET] MODIFICADOS (con MAP O en Sheets): ${idsModificados.size} → ${Array.from(idsModificados).join(', ')}`);
    console.log(`[PUSH-DET] Indicadores: MAP=${idsConMap.size}, Sheets=${idsConfirmados.filter(id => idsEnSheets.has(id)).length}`);

    // ===== PASO 1: LIMPIAR DETALLES ANTIGUOS PARA PRESUPUESTOS MODIFICADOS =====
    if (idsModificados.size > 0) {
      console.log('[PUSH-DET] === PASO 1: LIMPIANDO DETALLES ANTIGUOS PARA MODIFICADOS ===');
      
      const { getSheets } = require('../../google/gsheetsClient');
      const sheets = await getSheets();
      
      // 1A. Leer detalles actuales de Sheets
      const detallesSheets = await readSheetWithHeaders(config.hoja_id, 'A:Q', 'DetallesPresupuestos');
      
      // 1B. Encontrar filas a eliminar
      const filasAEliminar = [];
      const idsModificadosArray = Array.from(idsModificados);
      
      detallesSheets.rows.forEach((row, index) => {
        const idPresupuesto = (row[detallesSheets.headers[1]] || '').toString().trim(); // Columna B: IdPresupuesto
        if (idsModificadosArray.includes(idPresupuesto)) {
          filasAEliminar.push(index + 2); // +2 porque fila 1 es header
        }
      });
      
      console.log(`[PUSH-DET] Encontradas ${filasAEliminar.length} filas a eliminar en Sheets`);
      
      // 1C. Eliminar filas en Sheets (de abajo hacia arriba)
      if (filasAEliminar.length > 0) {
        const filasOrdenadas = filasAEliminar.sort((a, b) => b - a);
        
        // Obtener el sheetId correcto para DetallesPresupuestos
        const spreadsheetInfo = await sheets.spreadsheets.get({
          spreadsheetId: config.hoja_id
        });
        
        const detallesSheet = spreadsheetInfo.data.sheets.find(sheet => 
          sheet.properties.title === 'DetallesPresupuestos'
        );
        
        if (!detallesSheet) {
          console.error('[PUSH-DET] ❌ No se encontró la hoja DetallesPresupuestos');
          throw new Error('Hoja DetallesPresupuestos no encontrada');
        }
        
        const detallesSheetId = detallesSheet.properties.sheetId;
        console.log(`[PUSH-DET] Usando sheetId correcto: ${detallesSheetId} para DetallesPresupuestos`);
        
        for (const fila of filasOrdenadas) {
          await sheets.spreadsheets.batchUpdate({
            spreadsheetId: config.hoja_id,
            requestBody: {
              requests: [{
                deleteDimension: {
                  range: {
                    sheetId: detallesSheetId,
                    dimension: 'ROWS',
                    startIndex: fila - 1,
                    endIndex: fila
                  }
                }
              }]
            }
          });
        }
        
        console.log(`[PUSH-DET] ✅ Eliminadas ${filasAEliminar.length} filas antiguas en Sheets`);
      }
      
      // 1D. Limpiar MAP para presupuestos modificados
      const deleteMapResult = await db.query(`
        DELETE FROM presupuestos_detalles_map 
        WHERE local_detalle_id IN (
          SELECT d.id 
          FROM presupuestos_detalles d 
          WHERE d.id_presupuesto_ext = ANY($1)
        )
      `, [idsModificadosArray]);
      
      console.log(`[PUSH-DET] ✅ Limpiadas ${deleteMapResult.rowCount} entradas del MAP`);
    }

    // ===== PASO 2: OBTENER TODOS LOS DETALLES ACTUALES PARA INSERTAR =====
    console.log('[PUSH-DET] === PASO 2: OBTENIENDO TODOS LOS DETALLES ACTUALES ===');
    
    // Obtener TODOS los detalles actuales (sin filtro cutoff_at para modificados)
    const rs = await db.query(
      `
      SELECT d.id, d.id_presupuesto_ext, d.articulo, d.cantidad, d.valor1, d.precio1,
             d.iva1, d.diferencia, d.camp1, d.camp2, d.camp3, d.camp4, d.camp5, d.camp6,
             d.fecha_actualizacion
      FROM public.presupuestos_detalles d
      WHERE d.id_presupuesto_ext = ANY($1)
      ORDER BY d.id_presupuesto_ext, d.id
      `,
      [idsConfirmados]
    );

    if (rs.rowCount === 0) {
      console.log('[PUSH-DET] sin detalles locales para IDs confirmados: %o', idsConfirmados);
      return;
    }
    
    console.log('[PUSH-DET] detallesSeleccionados count=%d (TODOS los detalles actuales)', rs.rows.length);

    // VALIDACIÓN DE SEGURIDAD: Verificar que todos los detalles pertenecen a IDs confirmados
    const idsConfirmadosSet = new Set(idsConfirmados);
    const detallesFueraDeConfirmados = rs.rows.filter(r => !idsConfirmadosSet.has(r.id_presupuesto_ext));
    
    if (detallesFueraDeConfirmados.length > 0) {
      console.error('[PUSH-DET] ABORT: ids fuera de confirmados');
      console.error('[PUSH-DET] Detalles fuera de confirmados:', detallesFueraDeConfirmados.map(r => ({
        id: r.id,
        id_presupuesto_ext: r.id_presupuesto_ext,
        articulo: r.articulo
      })));
      return;
    }

    // ===== PASO 2: CREAR MAP SOLO PARA DETALLES NUEVOS =====
    console.log('[PUSH-DET] === PASO 2: CREANDO MAP PARA DETALLES NUEVOS ===');

    // Función para generar ID con guión obligatorio y timestamp para unicidad
    const mkIdConGuion = (r, timestamp = Date.now()) => {
      const hash = crypto.createHash('sha1')
        .update(`${r.id_presupuesto_ext}|${r.articulo}|${r.cantidad}|${r.valor1}|${r.precio1}|${r.iva1}|${r.diferencia}|${r.camp1}|${r.camp2}|${r.camp3}|${r.camp4}|${r.camp5}|${r.camp6}|${timestamp}`)
        .digest('hex');
      // Formato: 8 caracteres + guión + 4 caracteres (ej: abc12345-6789)
      return `${hash.slice(0, 8)}-${hash.slice(8, 12)}`;
    };

    let mapCreados = 0;
    const detallesParaSheets = [];
    
    for (const r of rs.rows) {
      try {
        // Verificar si ya existe MAP para este detalle
        const existingMap = await db.query(`
          SELECT id_detalle_presupuesto 
          FROM public.presupuestos_detalles_map 
          WHERE local_detalle_id = $1
        `, [r.id]);
        
        let idDetallePresupuesto;
        let esNuevoMap = false;
        
        if (existingMap.rowCount > 0) {
          // Ya existe MAP, usar el ID existente
          idDetallePresupuesto = existingMap.rows[0].id_detalle_presupuesto;
          console.log('[MAP-EXISTS] local=%d sheet=%s', r.id, idDetallePresupuesto);
        } else {
          // Generar nuevo ID único con guión
          let intentos = 0;
          let idUnico = false;
          
          while (!idUnico && intentos < 50) {
            const timestamp = Date.now() + intentos * 1000;
            idDetallePresupuesto = mkIdConGuion(r, timestamp);
            
            // Verificar unicidad en MAP
            const checkUnique = await db.query(`
              SELECT 1 FROM public.presupuestos_detalles_map 
              WHERE id_detalle_presupuesto = $1
            `, [idDetallePresupuesto]);
            
            if (checkUnique.rowCount === 0) {
              idUnico = true;
            } else {
              intentos++;
            }
          }
          
          if (!idUnico) {
            // Fallback: usar ID simple con timestamp
            idDetallePresupuesto = `${r.id}-${Date.now().toString(36)}`;
            console.warn('[MAP-FALLBACK] local=%d sheet=%s (usando fallback)', r.id, idDetallePresupuesto);
          }
          
          // DETECTAR FUENTE CORRECTA: Para presupuestos en confirmedHeaderIds, siempre es 'Local'
          // porque estos presupuestos se están sincronizando DESDE local HACIA Sheets
          const fuente = 'Local';
          
          // Crear MAP con fuente correcta
          await db.query(`
            INSERT INTO public.presupuestos_detalles_map
            (local_detalle_id, id_detalle_presupuesto, fuente, fecha_asignacion)
            VALUES ($1, $2, $3, CURRENT_TIMESTAMP AT TIME ZONE 'America/Argentina/Buenos_Aires')
          `, [r.id, idDetallePresupuesto, fuente]);
          
          mapCreados++;
          esNuevoMap = true;
          console.log('[MAP-CREATE] local=%d sheet=%s', r.id, idDetallePresupuesto);
        }
        
        // Solo agregar a Sheets si es nuevo MAP o si el ID tiene guión (formato correcto)
        if (esNuevoMap || idDetallePresupuesto.includes('-')) {
          detallesParaSheets.push({
            ...r,
            _idDetallePresupuesto: idDetallePresupuesto
          });
        }
        
      } catch (mapError) {
        console.error('[MAP-ERROR] local=%d error=%s', r.id, mapError.message);
        console.warn('[MAP-SKIP] Saltando detalle %d por error en MAP', r.id);
      }
    }
    
    console.log(`[PUSH-DET] MAP upserts: ${mapCreados}`);
    
    // ===== PASO 3: SUBIR SOLO DETALLES NUEVOS A SHEETS =====
    console.log('[PUSH-DET] === PASO 3: SUBIENDO SOLO DETALLES NUEVOS A SHEETS ===');
    
    if (detallesParaSheets.length === 0) {
      console.log('[PUSH-DET] No hay detalles nuevos para subir a Sheets');
      console.log('[PUSH-DET] append a Sheets: 0');
      return;
    }

    const { getSheets } = require('../../google/gsheetsClient');
    const sheets = await getSheets();

    // Leer IDs existentes desde DetallesPresupuestos!A:A para evitar duplicados
    console.log('[PUSH-DET] Verificando duplicados en Sheets...');
    const existingResponse = await sheets.spreadsheets.values.get({
      spreadsheetId: config.hoja_id,
      range: 'DetallesPresupuestos!A:A'
    });
    
    const existingIds = new Set();
    if (existingResponse.data.values) {
      existingResponse.data.values.forEach((row, index) => {
        if (index > 0 && row[0]) { // Skip header row
          existingIds.add(row[0].toString().trim());
        }
      });
    }
    console.log('[PUSH-DET] IDs existentes en Sheets:', existingIds.size);
    
    const nowAR = toSheetDateTimeAR(Date.now());
    const num2 = v => (v == null || v === '') ? '' : Math.round(Number(v) * 100) / 100;
    const num3 = v => (v == null || v === '') ? '' : Math.round(Number(v) * 1000) / 1000;
    const asText = v => (v == null) ? '' : String(v).trim();

    // DEDUPLICACIÓN MEJORADA: Verificar tanto por ID como por combinación presupuesto+artículo
    const detallesNuevos = [];
    
    for (const r of detallesParaSheets) {
      const idExiste = existingIds.has(r._idDetallePresupuesto);
      
      if (idExiste) {
        console.log('[PUSH-DET] Skip duplicado por ID: %s (ya existe en Sheets)', r._idDetallePresupuesto);
        continue;
      }
      
      // Verificación adicional: no duplicar por presupuesto+artículo
      const yaAgregado = detallesNuevos.some(existing => 
        existing.id_presupuesto_ext === r.id_presupuesto_ext && 
        existing.articulo === r.articulo
      );
      
      if (yaAgregado) {
        console.log('[PUSH-DET] Skip duplicado por presupuesto+artículo: %s-%s', r.id_presupuesto_ext, r.articulo);
        continue;
      }
      
      detallesNuevos.push(r);
      console.log('[PUSH-DET] Agregando detalle: %s para presupuesto %s', r._idDetallePresupuesto, r.id_presupuesto_ext);
    }

    if (detallesNuevos.length === 0) {
      console.log('[PUSH-DET] Todos los detalles ya existen en Sheets (después de deduplicación)');
      console.log('[PUSH-DET] append a Sheets: 0');
      return;
    }

    // Mapear solo detalles nuevos para Google Sheets - MAPEO CORRECTO según documentación
    const values = detallesNuevos.map(r => [
      r._idDetallePresupuesto,        // A  IDDetallePresupuesto (del MAP)
      asText(r.id_presupuesto_ext),   // B  IdPresupuesto
      asText(r.articulo),             // C  Articulo
      num2(r.cantidad),               // D  Cantidad
      num2(r.valor1),                 // E  Valor1
      num2(r.precio1),                // F  Precio1
      num2(r.iva1),                   // G  IVA1
      num2(r.diferencia),             // H  Diferencia
      num2(r.camp1),                  // I  Camp1 (camp1 local → Camp1 Sheets)
      num2(r.precio1),                // J  Camp2 (mismo valor que precio1 según documentación)
      num3(r.camp2),                  // K  Camp3 (camp2 local → Camp3 Sheets - PORCENTAJE)
      num2(r.camp3),                  // L  Camp4 (camp3 local → Camp4 Sheets)
      num2(r.camp4),                  // M  Camp5 (camp4 local → Camp5 Sheets)
      num2(r.camp5),                  // N  Camp6 (camp5 local → Camp6 Sheets)
      asText(r.camp6),                // O  Condicion (camp6 local → Condicion Sheets - TEXT)
      nowAR,                          // P  LastModified
      true                            // Q  Activo
    ]);

    console.log('[PUSH-DET] Subiendo %d detalles nuevos a Sheets', values.length);
    
    // Log de muestra de lo que se va a subir
    if (values.length > 0) {
      console.log('[PUSH-DET] Muestra de detalles a subir:');
      values.slice(0, 3).forEach((row, i) => {
        console.log(`[PUSH-DET]   ${i+1}. ID=${row[0]}, IdPres=${row[1]}, Art=${row[2]}, Cant=${row[3]}`);
      });
    }

    // Subir a Sheets
    await sheets.spreadsheets.values.append({
      spreadsheetId: config.hoja_id,
      range: 'DetallesPresupuestos!A1:Q1',
      valueInputOption: 'RAW',
      insertDataOption: 'INSERT_ROWS',
      requestBody: { values, majorDimension: 'ROWS' }
    });

    console.log(`[PUSH-DET] append a Sheets: ${values.length}`);
    console.log('[PUSH-DET] done', { filasAgregadas: values.length });

    // Verificación final
    const tailRead = await sheets.spreadsheets.values.get({
      spreadsheetId: config.hoja_id,
      range: 'DetallesPresupuestos!A:Q'
    });
    const body = tailRead.data.values || [];
    console.log('[PUSH-DET][SHEET] últimas 3 filas agregadas:', body.slice(-3).map(row => ({
      id: row[0],
      idPres: row[1], 
      articulo: row[2],
      cantidad: row[3]
    })));
    
  } catch (e) {
    console.error('[SYNC-FECHAS-FIX] Error en pushDetallesLocalesASheets:', e?.message);
    console.error('[SYNC-FECHAS-FIX] Stack trace:', e?.stack);
    throw e;
  }
}

/**
 * Sincronizar detalles modificados localmente a Google Sheets
 * Detecta por fecha_actualizacion y actualiza filas existentes o hace append
 * IMPLEMENTA FILTROS CUTOFF_AT: Solo procesa detalles >= cutoff_at
 */
async function pushDetallesModificadosASheets(config, db) {
  console.log('[DIAG-UPD-DET] Iniciando sincronización de detalles modificados con filtros cutoff_at...');
  
  try {
    const { getSheets } = require('../../google/gsheetsClient');
    const sheets = await getSheets();
    
    // 1. Leer detalles actuales de Sheets
    const detallesSheets = await readSheetWithHeaders(config.hoja_id, 'A:Q', 'DetallesPresupuestos');
    
    // 2. APLICAR FILTRO CUTOFF_AT: Solo detalles modificados >= cutoff_at
    const cutoffAt = config.cutoff_at;
    console.log('[DIAG-UPD-DET] Aplicando filtro cutoff_at:', cutoffAt);
    
    const rs = await db.query(`
      SELECT d.id_presupuesto_ext, d.articulo, d.cantidad, d.valor1, d.precio1,
             d.iva1, d.diferencia, d.camp1, d.camp2, d.camp3, d.camp4, d.camp5, d.camp6,
             d.fecha_actualizacion
      FROM public.presupuestos_detalles d
      INNER JOIN public.presupuestos p ON p.id_presupuesto_ext = d.id_presupuesto_ext
      WHERE p.activo = true 
        AND d.fecha_actualizacion > $1  -- ESTRICTO: solo posteriores a última sync
      ORDER BY d.fecha_actualizacion DESC
    `, [cutoffAt]);
    
    if (rs.rows.length === 0) {
      console.log('[DIAG-UPD-DET] No hay detalles modificados >= cutoff_at');
      return;
    }
    
    console.log(`[DIAG-UPD-DET] Encontrados ${rs.rows.length} detalles modificados >= cutoff_at`);
    
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
    pushDetallesModificadosASheets,
    pushCambiosLocalesConTimestamp
};
