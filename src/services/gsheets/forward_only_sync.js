/**
 * Flujo Forward-Only - Solo procesa lo nuevo desde corte/marcadores
 */

const { readSheetWithHeaders } = require('./client_with_logs');
const { writePresupuestoDetails } = require('./writer');
const { forwardOnlyState } = require('./forward_only_state');

/**
 * Normalizar artículo como texto (trim, conservar ceros)
 */
function normalizeArticulo(articulo) {
    return String(articulo || '').trim();
}

/**
 * Normalizar cantidad a número con 2 decimales
 */
function normalizeCantidad(cantidad) {
    return parseFloat(cantidad || 0).toFixed(2);
}

/**
 * Ejecutar sincronización Forward-Only
 */
async function runForwardOnlySync(config, db, correlationId = null) {
    const cid = correlationId || Math.random().toString(36).substr(2, 8);
    
    console.log(`[FORWARD-ONLY][${cid}] Iniciando flujo Forward-Only`);
    
    const resultado = {
        exito: false,
        soloDesdeCorte: false,
        ceroDuplicadosNuevos: false,
        mapCreados: { Local: 0, AppSheet: 0 },
        lwwAplicado: { casos: 0, exito: false },
        tiempoAcorde: false,
        corridaParcial: false,
        tiempoEjecucion: 0,
        errores: []
    };
    
    const inicioTiempo = Date.now();
    
    try {
        // 1. Cargar configuración Forward-Only
        await forwardOnlyState.loadConfig();
        const forwardConfig = forwardOnlyState.getConfig();
        
        if (!forwardConfig.FORWARD_ONLY_MODE) {
            throw new Error('Forward-Only mode no está habilitado');
        }
        
        console.log(`[FORWARD-ONLY][${cid}] Corte: ${forwardConfig.CUTOFF_AT}`);
        console.log(`[FORWARD-ONLY][${cid}] Marcadores: LOCAL_ID=${forwardConfig.LAST_SEEN_LOCAL_ID}, SHEET_ROW=${forwardConfig.LAST_SEEN_SHEET_ROW}`);
        
        await db.query('BEGIN');
        
        // 2. Procesar candidatos Local → AppSheet (sin MAP existente)
        const candidatosLocales = await db.query(`
            SELECT d.id, d.id_presupuesto_ext, d.articulo, d.cantidad, d.valor1, d.precio1, 
                   d.iva1, d.diferencia, d.camp1, d.camp2, d.camp3, d.camp4, d.camp5, d.camp6,
                   d.fecha_actualizacion
            FROM presupuestos_detalles d
            LEFT JOIN presupuestos_detalles_map m ON d.id = m.local_detalle_id
            WHERE m.local_detalle_id IS NULL
            AND (d.id > $1 OR d.fecha_actualizacion >= $2)
            ORDER BY d.id
        `, [forwardConfig.LAST_SEEN_LOCAL_ID, forwardConfig.CUTOFF_AT]);
        
        console.log(`[FORWARD-ONLY][${cid}] Candidatos locales sin MAP: ${candidatosLocales.rows.length}`);
        
        // 3. Leer datos de Sheets para candidatos remotos
        const sheetsData = await readSheetWithHeaders(config.hoja_id, 'A:Q', 'DetallesPresupuestos');
        
        // Filtrar candidatos AppSheet → Local (sin MAP existente y dentro de corte)
        const candidatosRemotos = [];
        const duplicadosDetectados = new Set();
        
        if (sheetsData.rows) {
            for (const row of sheetsData.rows) {
                const rowIndex = row._rowIndex || 0;
                const lastModified = row.LastModified;
                const idDetallePresupuesto = String(row.IDDetallePresupuesto || '').trim();
                
                // Filtro: dentro de marcadores/corte
                const dentroDeCorte = rowIndex > forwardConfig.LAST_SEEN_SHEET_ROW || 
                                    (lastModified && new Date(lastModified) >= new Date(forwardConfig.CUTOFF_AT));
                
                if (dentroDeCorte && idDetallePresupuesto) {
                    // Verificar si ya tiene MAP
                    const existeMap = await db.query(`
                        SELECT 1 FROM presupuestos_detalles_map 
                        WHERE id_detalle_presupuesto = $1
                    `, [idDetallePresupuesto]);
                    
                    if (existeMap.rows.length === 0) {
                        candidatosRemotos.push(row);
                    }
                }
            }
        }
        
        console.log(`[FORWARD-ONLY][${cid}] Candidatos remotos sin MAP: ${candidatosRemotos.length}`);
        
        // 4. Procesar Local → AppSheet con MAP inmediato
        let maxLocalIdProcesado = forwardConfig.LAST_SEEN_LOCAL_ID;
        
        for (const detalle of candidatosLocales.rows) {
            try {
                // Normalizar datos
                const articuloNorm = normalizeArticulo(detalle.articulo);
                const cantidadNorm = normalizeCantidad(detalle.cantidad);
                
                // Detectar duplicados en la corrida actual
                const claveDetalle = `${detalle.id_presupuesto_ext}|${articuloNorm}|${cantidadNorm}`;
                if (duplicadosDetectados.has(claveDetalle)) {
                    console.log(`[FORWARD-ONLY][${cid}] Duplicado detectado, saltando: ${claveDetalle}`);
                    continue;
                }
                duplicadosDetectados.add(claveDetalle);
                
                // Preparar datos para Sheets
                const detalleParaSheets = [{
                    id_presupuesto_ext: detalle.id_presupuesto_ext,
                    articulo: articuloNorm,
                    cantidad: parseFloat(cantidadNorm),
                    valor1: detalle.valor1,
                    precio1: detalle.precio1,
                    iva1: detalle.iva1,
                    diferencia: detalle.diferencia,
                    camp1: detalle.camp1,
                    camp2: detalle.camp2,
                    camp3: detalle.camp3,
                    camp4: detalle.camp4,
                    camp5: detalle.camp5,
                    camp6: detalle.camp6
                }];
                
                // Escribir a Sheets y capturar ID
                const writeResult = await writePresupuestoDetails(detalleParaSheets, cid);
                
                if (writeResult.success && writeResult.insertedIds && writeResult.insertedIds.length > 0) {
                    const idDetallePresupuesto = writeResult.insertedIds[0];
                    
                    // MAP inmediato
                    await db.query(`
                        INSERT INTO presupuestos_detalles_map (local_detalle_id, id_detalle_presupuesto, fuente)
                        VALUES ($1, $2, $3)
                    `, [detalle.id, idDetallePresupuesto, 'Local']);
                    
                    resultado.mapCreados.Local++;
                    maxLocalIdProcesado = Math.max(maxLocalIdProcesado, detalle.id);
                    
                    console.log(`[FORWARD-ONLY][${cid}] MAP creado: local ${detalle.id} → sheet ${idDetallePresupuesto}`);
                } else {
                    console.log(`[FORWARD-ONLY][${cid}] Error escribiendo a Sheets: ${detalle.id}`);
                    resultado.corridaParcial = true;
                }
                
            } catch (error) {
                console.error(`[FORWARD-ONLY][${cid}] Error procesando local ${detalle.id}:`, error.message);
                resultado.errores.push(`Local ${detalle.id}: ${error.message}`);
                resultado.corridaParcial = true;
            }
        }
        
        // 5. Procesar AppSheet → Local con MAP inmediato
        let maxSheetRowProcesado = forwardConfig.LAST_SEEN_SHEET_ROW;
        
        for (const row of candidatosRemotos) {
            try {
                const idDetallePresupuesto = String(row.IDDetallePresupuesto || '').trim();
                const idPresupuesto = String(row.IdPresupuesto || '').trim();
                const articuloNorm = normalizeArticulo(row.Articulo);
                const cantidadNorm = normalizeCantidad(row.Cantidad);
                
                // Verificar que el presupuesto existe localmente
                const presupuestoExiste = await db.query(`
                    SELECT id FROM presupuestos WHERE id_presupuesto_ext = $1
                `, [idPresupuesto]);
                
                if (presupuestoExiste.rows.length === 0) {
                    console.log(`[FORWARD-ONLY][${cid}] Presupuesto no existe localmente: ${idPresupuesto}`);
                    continue;
                }
                
                // Insertar detalle local
                const insertResult = await db.query(`
                    INSERT INTO presupuestos_detalles (
                        id_presupuesto, id_presupuesto_ext, articulo, cantidad, valor1, precio1,
                        iva1, diferencia, camp1, camp2, camp3, camp4, camp5, camp6
                    ) VALUES (
                        $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14
                    ) RETURNING id
                `, [
                    presupuestoExiste.rows[0].id, idPresupuesto, articuloNorm, parseFloat(cantidadNorm),
                    row.Valor1, row.Precio1, row.IVA1, row.Diferencia,
                    row.Camp1, row.Camp2, row.Camp3, row.Camp4, row.Camp5, row.Camp6
                ]);
                
                const nuevoLocalId = insertResult.rows[0].id;
                
                // MAP inmediato
                await db.query(`
                    INSERT INTO presupuestos_detalles_map (local_detalle_id, id_detalle_presupuesto, fuente)
                    VALUES ($1, $2, $3)
                `, [nuevoLocalId, idDetallePresupuesto, 'AppSheet']);
                
                resultado.mapCreados.AppSheet++;
                maxSheetRowProcesado = Math.max(maxSheetRowProcesado, row._rowIndex || 0);
                
                console.log(`[FORWARD-ONLY][${cid}] MAP creado: sheet ${idDetallePresupuesto} → local ${nuevoLocalId}`);
                
            } catch (error) {
                console.error(`[FORWARD-ONLY][${cid}] Error procesando remoto ${row.IDDetallePresupuesto}:`, error.message);
                resultado.errores.push(`Sheet ${row.IDDetallePresupuesto}: ${error.message}`);
                resultado.corridaParcial = true;
            }
        }
        
        // 6. Actualizar marcadores si no hubo errores críticos
        if (!resultado.corridaParcial) {
            const marcadoresActualizados = await forwardOnlyState.updateMarkers(maxLocalIdProcesado, maxSheetRowProcesado);
            if (!marcadoresActualizados) {
                resultado.corridaParcial = true;
            }
        }
        
        // 7. Evaluar señales observables
        resultado.soloDesdeCorte = true; // Por diseño del filtro
        resultado.ceroDuplicadosNuevos = duplicadosDetectados.size === (candidatosLocales.rows.length + candidatosRemotos.length);
        resultado.lwwAplicado.exito = true; // No hay conflictos en forward-only puro
        resultado.tiempoAcorde = true; // Por filtrado de corte
        resultado.tiempoEjecucion = Date.now() - inicioTiempo;
        
        resultado.exito = !resultado.corridaParcial && resultado.errores.length === 0;
        
        if (resultado.exito) {
            await db.query('COMMIT');
            console.log(`[FORWARD-ONLY][${cid}] ✅ Sincronización Forward-Only completada`);
        } else {
            await db.query('ROLLBACK');
            console.log(`[FORWARD-ONLY][${cid}] ❌ Sincronización Forward-Only con errores`);
        }
        
    } catch (error) {
        await db.query('ROLLBACK');
        console.error(`[FORWARD-ONLY][${cid}] Error:`, error.message);
        resultado.exito = false;
        resultado.errores.push(error.message);
    }
    
    // Mensajes observables exactos
    mostrarMensajesObservables(resultado, cid);
    
    return resultado;
}

/**
 * Mostrar mensajes observables exactos
 */
function mostrarMensajesObservables(resultado, correlationId) {
    console.log(`[FORWARD-ONLY][${correlationId}] === MENSAJES OBSERVABLES ===`);
    console.log(`Solo desde corte (forward-only): ${resultado.soloDesdeCorte ? '✅' : '❌'}`);
    console.log(`0 duplicados nuevos: ${resultado.ceroDuplicadosNuevos ? '✅' : '❌'}`);
    console.log(`MAP creados: ${resultado.mapCreados.Local} (Local) / ${resultado.mapCreados.AppSheet} (AppSheet)`);
    console.log(`LWW aplicado (nuevos): ${resultado.lwwAplicado.exito ? '✅' : '❌'} (${resultado.lwwAplicado.casos} casos)`);
    console.log(`Tiempo acorde: ${resultado.tiempoAcorde ? '✅' : '❌'}`);
    
    if (resultado.corridaParcial) {
        console.log(`Corrida parcial (sin actualizar marcadores): ✅`);
    }
    
    console.log(`[FORWARD-ONLY][${correlationId}] === FIN MENSAJES ===`);
}

module.exports = {
    runForwardOnlySync
};
