console.log('[SYNC-FECHAS-FIX] Inicializando servicio de corrección de fechas...');

const { readSheetWithHeaders, validateSheetAccess } = require('./client_with_logs');
const { parseDate } = require('./transformer');

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
    
    try {
        // PASO 1: Validar acceso a Google Sheets
        console.log('[SYNC-FECHAS-FIX] Validando acceso a Google Sheets...');
        const acceso = await validateSheetAccess(config.hoja_id);
        if (!acceso.hasAccess) {
            throw new Error(`No se puede acceder a Google Sheets: ${acceso.error}`);
        }
        
        // PASO 2: Leer datos desde Google Sheets
        console.log('[SYNC-FECHAS-FIX] Leyendo datos desde Google Sheets...');
        const presupuestosData = await readSheetWithHeaders(config.hoja_id, 'A:M', 'Presupuestos');
        const detallesData = await readSheetWithHeaders(config.hoja_id, 'A:N', 'DetallesPresupuestos');
        
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
                    resultado.datosInsertados.presupuestos++;
                    
                    if (presupuesto._fechaCorregida) {
                        resultado.fechasCorregidas++;
                    }
                    if (presupuesto._fechaNula) {
                        resultado.fechasNulas++;
                    }
                    
                } catch (rowError) {
                    resultado.errores.push(`Presupuesto fila ${i + 2}: ${rowError.message}`);
                }
            }
            
            // Insertar detalles
            for (let i = 0; i < detallesData.rows.length; i++) {
                const row = detallesData.rows[i];
                
                try {
                    const detalle = procesarDetalle(row, detallesData.headers);
                    
                    if (!detalle.id_presupuesto_ext || !detalle.articulo) {
                        continue;
                    }
                    
                    const presupuestoId = presupuestosMap.get(detalle.id_presupuesto_ext);
                    if (!presupuestoId) {
                        resultado.errores.push(`Detalle fila ${i + 2}: Presupuesto ${detalle.id_presupuesto_ext} no encontrado`);
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
 * Procesar fila de presupuesto con corrección de fechas
 */
function procesarPresupuesto(row, headers, config) {
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
        _fechaCorregida: false,
        _fechaNula: false
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
function procesarDetalle(row, headers) {
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

console.log('[SYNC-FECHAS-FIX] ✅ Servicio de corrección de fechas configurado');

module.exports = {
    ejecutarCorreccionFechas
};
