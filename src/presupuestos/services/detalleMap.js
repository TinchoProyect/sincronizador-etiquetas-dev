console.log('[MAP] Inicializando servicio de mapeo de detalles...');

/**
 * Servicio de Mapeo de Detalles
 * Relaciona IDs locales de detalles con IDDetallePresupuesto de Sheets/AppSheet
 * Usa tabla: public.presupuestos_detalles_map
 */

/**
 * Obtener IDDetallePresupuesto por ID local
 * @param {number} localDetalleId - ID local del detalle
 * @returns {Promise<string|null>} IDDetallePresupuesto o null si no existe
 */
async function getIdByLocal(localDetalleId, db) {
    console.log(`[MAP] Buscando IDDetallePresupuesto para local ID: ${localDetalleId}`);
    
    try {
        const query = `
            SELECT id_detalle_presupuesto 
            FROM public.presupuestos_detalles_map 
            WHERE local_detalle_id = $1
        `;
        
        const result = await db.query(query, [localDetalleId]);
        
        if (result.rows.length > 0) {
            const idDetalle = result.rows[0].id_detalle_presupuesto;
            console.log(`[MAP] ✅ Encontrado mapeo: local ${localDetalleId} → ${idDetalle}`);
            return idDetalle;
        } else {
            console.log(`[MAP] ⚠️ No existe mapeo para local ID: ${localDetalleId}`);
            return null;
        }
        
    } catch (error) {
        console.error(`[MAP] ❌ Error buscando mapeo para local ID ${localDetalleId}:`, error.message);
        throw new Error(`Error en getIdByLocal: ${error.message}`);
    }
}

/**
 * Obtener ID local por IDDetallePresupuesto
 * @param {string} idDetalle - IDDetallePresupuesto de Sheets/AppSheet
 * @returns {Promise<number|null>} ID local o null si no existe
 */
async function getLocalById(idDetalle, db) {
    console.log(`[MAP] Buscando ID local para IDDetallePresupuesto: ${idDetalle}`);
    
    try {
        const query = `
            SELECT local_detalle_id 
            FROM public.presupuestos_detalles_map 
            WHERE id_detalle_presupuesto = $1
        `;
        
        const result = await db.query(query, [idDetalle]);
        
        if (result.rows.length > 0) {
            const localId = result.rows[0].local_detalle_id;
            console.log(`[MAP] ✅ Encontrado mapeo: ${idDetalle} → local ${localId}`);
            return localId;
        } else {
            console.log(`[MAP] ⚠️ No existe mapeo para IDDetallePresupuesto: ${idDetalle}`);
            return null;
        }
        
    } catch (error) {
        console.error(`[MAP] ❌ Error buscando mapeo para IDDetallePresupuesto ${idDetalle}:`, error.message);
        throw new Error(`Error en getLocalById: ${error.message}`);
    }
}

/**
 * Establecer mapeo entre ID local e IDDetallePresupuesto
 * @param {number} localDetalleId - ID local del detalle
 * @param {string} idDetalle - IDDetallePresupuesto de Sheets/AppSheet
 * @param {string} fuente - 'Local' o 'AppSheet'
 * @returns {Promise<void>}
 */
async function setMap(localDetalleId, idDetalle, fuente, db) {
    console.log(`[MAP] Estableciendo mapeo: local ${localDetalleId} ↔ ${idDetalle} (fuente: ${fuente})`);
    
    try {
        // Validar parámetros
        if (!localDetalleId || typeof localDetalleId !== 'number') {
            throw new Error(`localDetalleId inválido: ${localDetalleId}`);
        }
        
        if (!idDetalle || typeof idDetalle !== 'string' || idDetalle.trim() === '') {
            throw new Error(`idDetalle inválido: ${idDetalle}`);
        }
        
        if (!fuente || !['Local', 'AppSheet'].includes(fuente)) {
            throw new Error(`fuente inválida: ${fuente}. Debe ser 'Local' o 'AppSheet'`);
        }
        
        const query = `
            INSERT INTO public.presupuestos_detalles_map 
            (local_detalle_id, id_detalle_presupuesto, fuente, fecha_asignacion)
            VALUES ($1, $2, $3, NOW())
            ON CONFLICT (local_detalle_id) 
            DO UPDATE SET 
                id_detalle_presupuesto = EXCLUDED.id_detalle_presupuesto,
                fuente = EXCLUDED.fuente,
                fecha_asignacion = NOW()
            RETURNING local_detalle_id, id_detalle_presupuesto, fuente
        `;
        
        const result = await db.query(query, [localDetalleId, idDetalle.trim(), fuente]);
        const row = result.rows[0];
        
        console.log(`[MAP] ✅ Mapeo establecido: local ${row.local_detalle_id} ↔ ${row.id_detalle_presupuesto} (${row.fuente})`);
        
    } catch (error) {
        // Verificar si es error de constraint único en id_detalle_presupuesto
        if (error.code === '23505' && error.constraint === 'presupuestos_detalles_map_id_detalle_presupuesto_key') {
            console.error(`[MAP] ❌ CONFLICT: IDDetallePresupuesto ${idDetalle} ya existe en otro mapeo`);
            console.error(`[MAP] ❌ No se puede mapear local ${localDetalleId} → ${idDetalle}`);
            throw new Error(`IDDetallePresupuesto ${idDetalle} ya está mapeado a otro detalle local`);
        }
        
        console.error(`[MAP] ❌ Error estableciendo mapeo local ${localDetalleId} → ${idDetalle}:`, error.message);
        throw new Error(`Error en setMap: ${error.message}`);
    }
}

/**
 * Eliminar mapeo por ID local
 * @param {number} localDetalleId - ID local del detalle
 * @returns {Promise<void>}
 */
async function deleteMapForLocal(localDetalleId, db) {
    console.log(`[MAP] Eliminando mapeo para local ID: ${localDetalleId}`);
    
    try {
        if (!localDetalleId || typeof localDetalleId !== 'number') {
            throw new Error(`localDetalleId inválido: ${localDetalleId}`);
        }
        
        const query = `
            DELETE FROM public.presupuestos_detalles_map 
            WHERE local_detalle_id = $1
            RETURNING local_detalle_id, id_detalle_presupuesto
        `;
        
        const result = await db.query(query, [localDetalleId]);
        
        if (result.rows.length > 0) {
            const row = result.rows[0];
            console.log(`[MAP] ✅ Mapeo eliminado: local ${row.local_detalle_id} ↔ ${row.id_detalle_presupuesto}`);
        } else {
            console.log(`[MAP] ⚠️ No existía mapeo para local ID: ${localDetalleId}`);
        }
        
    } catch (error) {
        console.error(`[MAP] ❌ Error eliminando mapeo para local ID ${localDetalleId}:`, error.message);
        throw new Error(`Error en deleteMapForLocal: ${error.message}`);
    }
}

/**
 * Obtener estadísticas del mapeo
 * @returns {Promise<Object>} Estadísticas del mapeo
 */
async function getMapStats(db) {
    console.log('[MAP] Obteniendo estadísticas de mapeo...');
    
    try {
        const queries = {
            totalMapeos: 'SELECT COUNT(*) as count FROM public.presupuestos_detalles_map',
            porFuente: `
                SELECT fuente, COUNT(*) as count 
                FROM public.presupuestos_detalles_map 
                GROUP BY fuente 
                ORDER BY count DESC
            `,
            ultimaAsignacion: `
                SELECT MAX(fecha_asignacion) as ultima_asignacion 
                FROM public.presupuestos_detalles_map
            `,
            huerfanos: `
                SELECT COUNT(*) as count 
                FROM public.presupuestos_detalles_map m
                LEFT JOIN public.presupuestos_detalles d ON m.local_detalle_id = d.id
                WHERE d.id IS NULL
            `
        };
        
        const results = {};
        
        for (const [key, query] of Object.entries(queries)) {
            const result = await db.query(query);
            results[key] = result.rows;
        }
        
        const stats = {
            totalMapeos: results.totalMapeos[0]?.count || 0,
            porFuente: results.porFuente,
            ultimaAsignacion: results.ultimaAsignacion[0]?.ultima_asignacion,
            huerfanos: results.huerfanos[0]?.count || 0,
            timestamp: new Date().toISOString()
        };
        
        console.log(`[MAP] ✅ Estadísticas obtenidas:`);
        console.log(`[MAP] - Total mapeos: ${stats.totalMapeos}`);
        console.log(`[MAP] - Huérfanos: ${stats.huerfanos}`);
        console.log(`[MAP] - Última asignación: ${stats.ultimaAsignacion}`);
        
        return stats;
        
    } catch (error) {
        console.error('[MAP] ❌ Error obteniendo estadísticas:', error.message);
        throw new Error(`Error en getMapStats: ${error.message}`);
    }
}

/**
 * Limpiar mapeos huérfanos (sin detalle local correspondiente)
 * @returns {Promise<number>} Cantidad de mapeos eliminados
 */
async function cleanOrphanMaps(db) {
    console.log('[MAP] Limpiando mapeos huérfanos...');
    
    try {
        const query = `
            DELETE FROM public.presupuestos_detalles_map 
            WHERE local_detalle_id NOT IN (
                SELECT id FROM public.presupuestos_detalles
            )
            RETURNING local_detalle_id, id_detalle_presupuesto
        `;
        
        const result = await db.query(query);
        const eliminados = result.rows.length;
        
        if (eliminados > 0) {
            console.log(`[MAP] ✅ Eliminados ${eliminados} mapeos huérfanos`);
            result.rows.forEach(row => {
                console.log(`[MAP] - Eliminado: local ${row.local_detalle_id} ↔ ${row.id_detalle_presupuesto}`);
            });
        } else {
            console.log('[MAP] ✅ No se encontraron mapeos huérfanos');
        }
        
        return eliminados;
        
    } catch (error) {
        console.error('[MAP] ❌ Error limpiando mapeos huérfanos:', error.message);
        throw new Error(`Error en cleanOrphanMaps: ${error.message}`);
    }
}

console.log('[MAP] ✅ Servicio de mapeo de detalles configurado');

module.exports = {
    getIdByLocal,
    getLocalById,
    setMap,
    deleteMapForLocal,
    getMapStats,
    cleanOrphanMaps
};
