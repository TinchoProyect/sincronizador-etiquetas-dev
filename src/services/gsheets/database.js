console.log('[DATABASE] Inicializando servicio de base de datos...');

/**
 * Servicio de Base de Datos para Sincronización
 * Maneja operaciones UPSERT para presupuestos y detalles
 */

/**
 * UPSERT de presupuesto individual
 * @param {Object} presupuesto - Datos de presupuesto transformados y validados
 * @param {Object} db - Conexión a base de datos
 * @returns {Object} Resultado de la operación
 */
async function upsertPresupuesto(presupuesto, db) {
    console.log(`[DATABASE] UPSERT presupuesto: ${presupuesto.id_ext}`);
    
    try {
        const query = `
            INSERT INTO public.presupuestos (
                id_ext, fecha, cliente, agente, fecha_entrega, 
                factura_efectivo, nota, estado, informe_generado, 
                cliente_nuevo_id, estado_imprime_pdf, punto_entrega, descuento
            )
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
            ON CONFLICT (id_ext) 
            DO UPDATE SET 
                fecha = EXCLUDED.fecha,
                cliente = EXCLUDED.cliente,
                agente = EXCLUDED.agente,
                fecha_entrega = EXCLUDED.fecha_entrega,
                factura_efectivo = EXCLUDED.factura_efectivo,
                nota = EXCLUDED.nota,
                estado = EXCLUDED.estado,
                informe_generado = EXCLUDED.informe_generado,
                cliente_nuevo_id = EXCLUDED.cliente_nuevo_id,
                estado_imprime_pdf = EXCLUDED.estado_imprime_pdf,
                punto_entrega = EXCLUDED.punto_entrega,
                descuento = EXCLUDED.descuento,
                fecha_actualizacion = NOW()
            RETURNING id, id_ext, 
                CASE WHEN xmax = 0 THEN 'INSERTED' ELSE 'UPDATED' END as operation;
        `;
        
        const values = [
            presupuesto.id_ext,
            presupuesto.fecha,
            presupuesto.cliente,
            presupuesto.agente,
            presupuesto.fecha_entrega,
            presupuesto.factura_efectivo,
            presupuesto.nota,
            presupuesto.estado,
            presupuesto.informe_generado,
            presupuesto.cliente_nuevo_id,
            presupuesto.estado_imprime_pdf,
            presupuesto.punto_entrega,
            presupuesto.descuento
        ];
        
        const result = await db.query(query, values);
        const row = result.rows[0];
        
        console.log(`[DATABASE] ✅ Presupuesto ${row.operation}: ${row.id_ext} (ID: ${row.id})`);
        
        return {
            success: true,
            operation: row.operation,
            id: row.id,
            id_ext: row.id_ext,
            data: row
        };
        
    } catch (error) {
        console.error(`[DATABASE] ❌ Error UPSERT presupuesto ${presupuesto.id_ext}:`, error.message);
        
        return {
            success: false,
            operation: 'ERROR',
            id_ext: presupuesto.id_ext,
            error: error.message,
            sqlState: error.code,
            detail: error.detail
        };
    }
}

/**
 * UPSERT de detalle individual
 * @param {Object} detalle - Datos de detalle transformados y validados
 * @param {Object} db - Conexión a base de datos
 * @returns {Object} Resultado de la operación
 */
async function upsertDetalle(detalle, db) {
    console.log(`[DATABASE] UPSERT detalle: ${detalle.id_presupuesto_ext} - ${detalle.articulo}`);
    
    try {
        // PASO 1: Obtener el ID interno del presupuesto
        const presupuestoQuery = `
            SELECT id FROM public.presupuestos WHERE id_ext = $1
        `;
        const presupuestoResult = await db.query(presupuestoQuery, [detalle.id_presupuesto_ext]);
        
        if (presupuestoResult.rows.length === 0) {
            throw new Error(`Presupuesto padre no encontrado: ${detalle.id_presupuesto_ext}`);
        }
        
        const id_presupuesto = presupuestoResult.rows[0].id;
        
        // PASO 2: UPSERT del detalle
        const query = `
            INSERT INTO public.presupuestos_detalles (
                id_presupuesto, id_presupuesto_ext, articulo, cantidad,
                valor1, precio1, iva1, diferencia, camp1, camp2, camp3, camp4, camp5, camp6
            )
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
            ON CONFLICT (id_presupuesto_ext, articulo) 
            DO UPDATE SET 
                id_presupuesto = EXCLUDED.id_presupuesto,
                cantidad = EXCLUDED.cantidad,
                valor1 = EXCLUDED.valor1,
                precio1 = EXCLUDED.precio1,
                iva1 = EXCLUDED.iva1,
                diferencia = EXCLUDED.diferencia,
                camp1 = EXCLUDED.camp1,
                camp2 = EXCLUDED.camp2,
                camp3 = EXCLUDED.camp3,
                camp4 = EXCLUDED.camp4,
                camp5 = EXCLUDED.camp5,
                camp6 = EXCLUDED.camp6,
                fecha_actualizacion = NOW()
            RETURNING id, id_presupuesto_ext, articulo,
                CASE WHEN xmax = 0 THEN 'INSERTED' ELSE 'UPDATED' END as operation;
        `;
        
        const values = [
            id_presupuesto,
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
        ];
        
        const result = await db.query(query, values);
        const row = result.rows[0];
        
        console.log(`[DATABASE] ✅ Detalle ${row.operation}: ${row.id_presupuesto_ext} - ${row.articulo} (ID: ${row.id})`);
        
        return {
            success: true,
            operation: row.operation,
            id: row.id,
            id_presupuesto_ext: row.id_presupuesto_ext,
            articulo: row.articulo,
            data: row
        };
        
    } catch (error) {
        console.error(`[DATABASE] ❌ Error UPSERT detalle ${detalle.id_presupuesto_ext} - ${detalle.articulo}:`, error.message);
        
        return {
            success: false,
            operation: 'ERROR',
            id_presupuesto_ext: detalle.id_presupuesto_ext,
            articulo: detalle.articulo,
            error: error.message,
            sqlState: error.code,
            detail: error.detail
        };
    }
}

/**
 * UPSERT lote de presupuestos
 * @param {Array} presupuestos - Array de presupuestos
 * @param {Object} db - Conexión a base de datos
 * @returns {Object} Resultado del lote
 */
async function upsertPresupuestos(presupuestos, db) {
    console.log(`[DATABASE] UPSERT lote de ${presupuestos.length} presupuestos...`);
    
    const results = [];
    const errors = [];
    let insertedCount = 0;
    let updatedCount = 0;
    
    for (let i = 0; i < presupuestos.length; i++) {
        try {
            const result = await upsertPresupuesto(presupuestos[i], db);
            
            if (result.success) {
                results.push(result);
                
                if (result.operation === 'INSERTED') {
                    insertedCount++;
                } else if (result.operation === 'UPDATED') {
                    updatedCount++;
                }
            } else {
                errors.push({
                    index: i,
                    presupuesto: presupuestos[i],
                    result: result
                });
            }
            
        } catch (error) {
            console.error(`[DATABASE] ❌ Error crítico en presupuesto índice ${i}:`, error.message);
            errors.push({
                index: i,
                presupuesto: presupuestos[i],
                result: {
                    success: false,
                    error: error.message
                }
            });
        }
    }
    
    const summary = {
        total: presupuestos.length,
        successful: results.length,
        failed: errors.length,
        inserted: insertedCount,
        updated: updatedCount,
        results: results,
        errors: errors
    };
    
    console.log(`[DATABASE] ✅ Lote presupuestos completado: ${summary.successful}/${summary.total} exitosos`);
    console.log(`[DATABASE] - Insertados: ${summary.inserted}, Actualizados: ${summary.updated}, Errores: ${summary.failed}`);
    
    return summary;
}

/**
 * UPSERT lote de detalles
 * @param {Array} detalles - Array de detalles
 * @param {Object} db - Conexión a base de datos
 * @returns {Object} Resultado del lote
 */
async function upsertDetalles(detalles, db) {
    console.log(`[DATABASE] UPSERT lote de ${detalles.length} detalles...`);
    
    const results = [];
    const errors = [];
    let insertedCount = 0;
    let updatedCount = 0;
    
    for (let i = 0; i < detalles.length; i++) {
        try {
            const result = await upsertDetalle(detalles[i], db);
            
            if (result.success) {
                results.push(result);
                
                if (result.operation === 'INSERTED') {
                    insertedCount++;
                } else if (result.operation === 'UPDATED') {
                    updatedCount++;
                }
            } else {
                errors.push({
                    index: i,
                    detalle: detalles[i],
                    result: result
                });
            }
            
        } catch (error) {
            console.error(`[DATABASE] ❌ Error crítico en detalle índice ${i}:`, error.message);
            errors.push({
                index: i,
                detalle: detalles[i],
                result: {
                    success: false,
                    error: error.message
                }
            });
        }
    }
    
    const summary = {
        total: detalles.length,
        successful: results.length,
        failed: errors.length,
        inserted: insertedCount,
        updated: updatedCount,
        results: results,
        errors: errors
    };
    
    console.log(`[DATABASE] ✅ Lote detalles completado: ${summary.successful}/${summary.total} exitosos`);
    console.log(`[DATABASE] - Insertados: ${summary.inserted}, Actualizados: ${summary.updated}, Errores: ${summary.failed}`);
    
    return summary;
}

/**
 * Verificar existencia de presupuesto
 * @param {string} id_ext - ID externo del presupuesto
 * @param {Object} db - Conexión a base de datos
 * @returns {Object} Información del presupuesto si existe
 */
async function checkPresupuestoExists(id_ext, db) {
    console.log(`[DATABASE] Verificando existencia de presupuesto: ${id_ext}`);
    
    try {
        const query = `
            SELECT id, id_ext, fecha, estado, fecha_actualizacion
            FROM public.presupuestos 
            WHERE id_ext = $1
        `;
        
        const result = await db.query(query, [id_ext]);
        
        if (result.rows.length > 0) {
            const presupuesto = result.rows[0];
            console.log(`[DATABASE] ✅ Presupuesto existe: ${id_ext} (ID: ${presupuesto.id})`);
            
            return {
                exists: true,
                data: presupuesto
            };
        } else {
            console.log(`[DATABASE] ⚠️ Presupuesto no existe: ${id_ext}`);
            
            return {
                exists: false,
                data: null
            };
        }
        
    } catch (error) {
        console.error(`[DATABASE] ❌ Error verificando presupuesto ${id_ext}:`, error.message);
        
        return {
            exists: false,
            data: null,
            error: error.message
        };
    }
}

/**
 * Obtener estadísticas de presupuestos
 * @param {Object} db - Conexión a base de datos
 * @returns {Object} Estadísticas de la base de datos
 */
async function getPresupuestosStats(db) {
    console.log('[DATABASE] Obteniendo estadísticas de presupuestos...');
    
    try {
        const queries = {
            totalPresupuestos: 'SELECT COUNT(*) as count FROM public.presupuestos',
            totalDetalles: 'SELECT COUNT(*) as count FROM public.presupuestos_detalles',
            presupuestosPorEstado: `
                SELECT estado, COUNT(*) as count 
                FROM public.presupuestos 
                WHERE estado IS NOT NULL 
                GROUP BY estado 
                ORDER BY count DESC
            `,
            ultimaActualizacion: `
                SELECT MAX(fecha_actualizacion) as ultima_actualizacion 
                FROM public.presupuestos 
                WHERE fecha_actualizacion IS NOT NULL
            `
        };
        
        const results = {};
        
        for (const [key, query] of Object.entries(queries)) {
            const result = await db.query(query);
            results[key] = result.rows;
        }
        
        const stats = {
            totalPresupuestos: results.totalPresupuestos[0]?.count || 0,
            totalDetalles: results.totalDetalles[0]?.count || 0,
            presupuestosPorEstado: results.presupuestosPorEstado,
            ultimaActualizacion: results.ultimaActualizacion[0]?.ultima_actualizacion,
            timestamp: new Date().toISOString()
        };
        
        console.log(`[DATABASE] ✅ Estadísticas obtenidas:`);
        console.log(`[DATABASE] - Total presupuestos: ${stats.totalPresupuestos}`);
        console.log(`[DATABASE] - Total detalles: ${stats.totalDetalles}`);
        console.log(`[DATABASE] - Última actualización: ${stats.ultimaActualizacion}`);
        
        return stats;
        
    } catch (error) {
        console.error('[DATABASE] ❌ Error obteniendo estadísticas:', error.message);
        throw new Error(`Error en estadísticas: ${error.message}`);
    }
}

/**
 * Limpiar registros huérfanos
 * @param {Object} db - Conexión a base de datos
 * @returns {Object} Resultado de la limpieza
 */
async function cleanOrphanRecords(db) {
    console.log('[DATABASE] Limpiando registros huérfanos...');
    
    try {
        // Encontrar detalles sin presupuesto padre
        const orphanQuery = `
            SELECT pd.id, pd.id_presupuesto_ext, pd.articulo
            FROM public.presupuestos_detalles pd
            LEFT JOIN public.presupuestos p ON pd.id_presupuesto_ext = p.id_ext
            WHERE p.id IS NULL
        `;
        
        const orphanResult = await db.query(orphanQuery);
        const orphanCount = orphanResult.rows.length;
        
        if (orphanCount > 0) {
            console.log(`[DATABASE] ⚠️ Encontrados ${orphanCount} detalles huérfanos`);
            
            // Opcional: eliminar huérfanos (comentado por seguridad)
            /*
            const deleteQuery = `
                DELETE FROM public.presupuestos_detalles
                WHERE id IN (
                    SELECT pd.id
                    FROM public.presupuestos_detalles pd
                    LEFT JOIN public.presupuestos p ON pd.id_presupuesto_ext = p.id_ext
                    WHERE p.id IS NULL
                )
            `;
            
            const deleteResult = await db.query(deleteQuery);
            console.log(`[DATABASE] ✅ Eliminados ${deleteResult.rowCount} registros huérfanos`);
            */
        } else {
            console.log('[DATABASE] ✅ No se encontraron registros huérfanos');
        }
        
        return {
            orphansFound: orphanCount,
            orphansDeleted: 0, // Cambiar si se habilita eliminación
            orphanDetails: orphanResult.rows
        };
        
    } catch (error) {
        console.error('[DATABASE] ❌ Error limpiando huérfanos:', error.message);
        throw new Error(`Error en limpieza: ${error.message}`);
    }
}

/**
 * Crear índices optimizados para sincronización
 * @param {Object} db - Conexión a base de datos
 * @returns {Object} Resultado de creación de índices
 */
async function createOptimizedIndexes(db) {
    console.log('[DATABASE] Creando índices optimizados...');
    
    const indexes = [
        {
            name: 'idx_presupuestos_id_ext',
            query: 'CREATE INDEX IF NOT EXISTS idx_presupuestos_id_ext ON public.presupuestos(id_ext)'
        },
        {
            name: 'idx_detalles_presupuesto_ext',
            query: 'CREATE INDEX IF NOT EXISTS idx_detalles_presupuesto_ext ON public.presupuestos_detalles(id_presupuesto_ext)'
        },
        {
            name: 'idx_detalles_articulo',
            query: 'CREATE INDEX IF NOT EXISTS idx_detalles_articulo ON public.presupuestos_detalles(articulo)'
        },
        {
            name: 'idx_detalles_composite',
            query: 'CREATE INDEX IF NOT EXISTS idx_detalles_composite ON public.presupuestos_detalles(id_presupuesto_ext, articulo)'
        },
        {
            name: 'idx_presupuestos_fecha_actualizacion',
            query: 'CREATE INDEX IF NOT EXISTS idx_presupuestos_fecha_actualizacion ON public.presupuestos(fecha_actualizacion)'
        }
    ];
    
    const results = [];
    
    for (const index of indexes) {
        try {
            await db.query(index.query);
            results.push({
                name: index.name,
                success: true
            });
            console.log(`[DATABASE] ✅ Índice creado: ${index.name}`);
        } catch (error) {
            results.push({
                name: index.name,
                success: false,
                error: error.message
            });
            console.error(`[DATABASE] ❌ Error creando índice ${index.name}:`, error.message);
        }
    }
    
    const summary = {
        total: indexes.length,
        successful: results.filter(r => r.success).length,
        failed: results.filter(r => !r.success).length,
        results: results
    };
    
    console.log(`[DATABASE] ✅ Índices procesados: ${summary.successful}/${summary.total} exitosos`);
    
    return summary;
}

console.log('[DATABASE] ✅ Servicio de base de datos configurado');

module.exports = {
    upsertPresupuesto,
    upsertDetalle,
    upsertPresupuestos,
    upsertDetalles,
    checkPresupuestoExists,
    getPresupuestosStats,
    cleanOrphanRecords,
    createOptimizedIndexes
};
