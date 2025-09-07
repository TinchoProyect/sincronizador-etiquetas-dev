console.log('[SYNC-FECHAS-FIX] Inicializando servicio de corrección de fechas...');

const { readSheetWithHeaders, validateSheetAccess } = require('./client_with_logs');
const { parseDate } = require('./transformer');
const crypto = require('crypto');

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
 * Push de ALTAS locales a Google Sheets (alineado A:O, fechas ok, % ok)
 */
async function pushAltasLocalesASheets(presupuestosData, config, db) {
  try {
    const { getSheets } = require('../../google/gsheetsClient');
    const sheets = await getSheets();

    // IDs que ya existen en Sheets (col A)
    const sheetIds = new Set(
      presupuestosData.rows.map(r => (r[presupuestosData.headers[0]] || '').toString().trim())
    );

    // Activos locales
    const rs = await db.query(`
      SELECT id_presupuesto_ext, id_cliente, fecha, fecha_entrega, agente, tipo_comprobante,
             nota, estado, informe_generado, cliente_nuevo_id, punto_entrega, descuento
      FROM public.presupuestos
      WHERE activo = true
    `);

    // Solo los que no están en Sheets
    const aInsertar = rs.rows.filter(r => !sheetIds.has((r.id_presupuesto_ext || '').toString().trim()));
    if (aInsertar.length === 0) return;

    const nowIso = new Date().toISOString();

    // Mapeo EXACTO A..O (15 columnas)
    const data = aInsertar.map(r => {
      const pct = r.descuento == null ? null : Number(r.descuento);
      const pctStr = pct == null ? '' : (pct > 1 ? `${pct}%` : `${pct*100}%`);
      
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
        nowIso,                                             // N  LastModified
        true                                                // O  Activo
      ];
    });

    // IMPORTANTE: anclamos al encabezado A1:O1
    await sheets.spreadsheets.values.append({
      spreadsheetId: config.hoja_id,
      range: 'Presupuestos!A1:O1',
      valueInputOption: 'USER_ENTERED',
      insertDataOption: 'INSERT_ROWS',
      requestBody: { values: data, majorDimension: 'ROWS' }
    });

    console.log(`[SYNC-FECHAS-FIX] Push de ALTAS a Sheets: ${aInsertar.length} encabezados agregados.`);
    
    const insertedIds = new Set(aInsertar.map(r => (r.id_presupuesto_ext ?? '').toString().trim()));
    return insertedIds;
  } catch (e) {
    console.warn('[SYNC-FECHAS-FIX] No se pudieron empujar ALTAS locales a Sheets:', e?.message);
    return new Set();
  }
}

async function pushDetallesLocalesASheets(insertedIds, config, db) {
  try {
    if (!insertedIds || insertedIds.size === 0) return;
    const ids = Array.from(insertedIds);
    const { getSheets } = require('../../google/gsheetsClient');
    const sheets = await getSheets();

    // Traer detalles locales de esas cabeceras nuevas
    const rs = await db.query(`
      SELECT d.id_presupuesto_ext, d.articulo, d.cantidad, d.valor1, d.precio1,
             d.iva1, d.diferencia, d.camp1, d.camp2, d.camp3, d.camp4, d.camp5, d.camp6
      FROM public.presupuestos_detalles d
      WHERE d.id_presupuesto_ext = ANY($1)
    `, [ids]);

    if (rs.rows.length === 0) return;

    const num   = v => (v == null || v === '') ? '' : Number(v);
    const asText  = v => (v == null) ? '' : String(v).trim();
    const mkId  = r => crypto.createHash('sha1')
      .update(`${r.id_presupuesto_ext}|${r.articulo}|${r.cantidad}|${r.valor1}|${r.precio1}|${r.iva1}|${r.diferencia}|${r.camp1}|${r.camp2}|${r.camp3}|${r.camp4}|${r.camp5}|${r.camp6}`)
      .digest('hex').slice(0, 8);

    const values = rs.rows.map(r => {
      const row = [
        mkId(r),                   // A  IDDetallePresupuesto
        asText(r.id_presupuesto_ext), // B  IdPresupuesto
        asText(r.articulo),        // C  Articulo
        num(r.cantidad),           // D  Cantidad
        num(r.valor1),             // E  Valor1
        num(r.precio1),            // F  Precio1
        num(r.iva1),               // G  IVA1
        num(r.diferencia),         // H  Diferencia
        num(r.camp3),              // I  Camp1  (¡cruce!)
        num(r.camp1),              // J  Camp2  (¡cruce!)
        num(r.camp2),              // K  Camp3  (0,21 debe ir acá)
        // Camp4 en Sheets debe venir de camp3 (local)
        num(r.camp3),              // L  Camp4
        // Camp5 (columna M en Sheets) debe venir de camp4 local
        num(r.camp4),              // M  Camp5
        // Camp6 (columna N en Sheets) debe venir de camp5 local
        num(r.camp5),              // N  Camp6
        '',                        // O  Condicion
        new Date().toISOString(),  // P  LastModified
        true                       // Q  Activo
      ];
      
      console.log('[PUSH-DET] camp4<=camp3', { local_camp3: r.camp3, sheet_camp4: row[11] });
      return row;
    });

    const tail = values[values.length - 1];
    console.log('[PUSH-DET][CHECK] Camp5<=camp4', {
      local_camp4: rs.rows[rs.rows.length - 1]?.camp4,
      sheet_camp5: tail?.[12] // usa índice 12 si no hay headers
    });

    const last = values[values.length - 1];
    console.log('[PUSH-DET][CHECK] Camp6<=camp5', {
      local_camp5: rs.rows[rs.rows.length - 1]?.camp5,
      sheet_camp6: last?.[13]
    });

    const TAIL = 5;
    // Últimas 5 del local (D..N)
    const last5Local = rs.rows.slice(-TAIL).map(r => ({
      cantidad: r.cantidad, valor1: r.valor1, precio1: r.precio1, iva1: r.iva1,
      diferencia: r.diferencia, camp1: r.camp1, camp2: r.camp2,
      camp3: r.camp3, camp4: r.camp4, camp5: r.camp5, camp6: r.camp6
    }));
    console.log('[PUSH-DET][LOCAL] últimas 5 D..N:', last5Local);

    // Últimas 5 mapeadas para Sheets (D..N por índices)
    const last5Map = values.slice(-TAIL).map(v => ({
      cantidad: v[3], valor1: v[4], precio1: v[5], iva1: v[6],
      diferencia: v[7], camp1: v[8], camp2: v[9],
      camp3: v[10], camp4: v[11], camp5: v[12], camp6: v[13]
    }));
    console.log('[PUSH-DET][MAP] últimas 5 D..N:', last5Map);

    await sheets.spreadsheets.values.append({
      spreadsheetId: config.hoja_id,
      range: 'DetallesPresupuestos!A1:Q1',
      valueInputOption: 'USER_ENTERED',
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

console.log('[SYNC-FECHAS-FIX] ✅ Servicio de corrección de fechas configurado');

module.exports = {
    ejecutarCorreccionFechas
};
