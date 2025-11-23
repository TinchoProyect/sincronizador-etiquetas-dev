/**
 * SERVICIO DE SNAPSHOTS DE PRESUPUESTOS
 * Gestiona la comparación y actualización de snapshots cuando se modifican presupuestos
 */

console.log('📸 [SNAPSHOT-SERVICE] Servicio de snapshots inicializado');

/**
 * Actualizar snapshot con diferencias cuando se modifica un presupuesto
 * @param {number} id_presupuesto - ID interno del presupuesto
 * @param {string} id_presupuesto_ext - ID externo del presupuesto
 * @param {object} db - Pool de conexión a la base de datos
 * @returns {Promise<object>} - Resultado de la operación
 */
async function actualizarSnapshotConDiferencias(id_presupuesto, id_presupuesto_ext, db) {
    console.log(`📸 [SNAPSHOT-MOD] Inicio actualización snapshot por modificación local (id_presupuesto=${id_presupuesto}, id_presupuesto_ext=${id_presupuesto_ext})`);
    
    try {
        // 1. Buscar snapshot activo
        const snapshotQuery = `
            SELECT 
                id,
                id_presupuesto,
                id_presupuesto_ext,
                snapshot_detalles,
                secuencia_en_snapshot,
                fecha_snapshot,
                motivo,
                numero_impresion
            FROM presupuestos_snapshots
            WHERE id_presupuesto = $1 AND activo = true
            ORDER BY fecha_snapshot DESC
            LIMIT 1
        `;
        
        const snapshotResult = await db.query(snapshotQuery, [id_presupuesto]);
        
        if (snapshotResult.rows.length === 0) {
            console.log(`📸 [SNAPSHOT-MOD] No existe snapshot activo, no se aplican diferencias`);
            return {
                success: true,
                hasSnapshot: false,
                message: 'Presupuesto aún no fue impreso'
            };
        }
        
        const snapshot = snapshotResult.rows[0];
        console.log(`📸 [SNAPSHOT-MOD] Snapshot activo encontrado, calculando diferencias...`);
        console.log(`📸 [SNAPSHOT-MOD] Snapshot id=${snapshot.id}, ext=${snapshot.id_presupuesto_ext}`);
        
        // 2. Obtener estado actual del presupuesto (foto actual)
        const presupuestoQuery = `
            SELECT 
                p.id,
                p.id_presupuesto_ext,
                p.secuencia
            FROM presupuestos p
            WHERE p.id = $1 AND p.activo = true
        `;
        
        const presupuestoResult = await db.query(presupuestoQuery, [id_presupuesto]);
        
        if (presupuestoResult.rows.length === 0) {
            console.log(`❌ [SNAPSHOT-CHECK] Presupuesto no encontrado en BD`);
            return {
                success: false,
                error: 'Presupuesto no encontrado'
            };
        }
        
        const presupuesto = presupuestoResult.rows[0];
        
        // 3. Obtener detalles actuales del presupuesto
        const detallesQuery = `
            SELECT 
                pd.articulo,
                pd.cantidad,
                pd.valor1,
                pd.precio1,
                COALESCE(NULLIF(TRIM(a.nombre), ''), pd.articulo) as descripcion
            FROM presupuestos_detalles pd
            LEFT JOIN articulos a ON a.codigo_barras = pd.articulo
            WHERE pd.id_presupuesto = $1
            ORDER BY pd.articulo
        `;
        
        const detallesResult = await db.query(detallesQuery, [id_presupuesto]);
        const detallesActuales = detallesResult.rows;
        
        console.log(`📸 [SNAPSHOT-MOD] Recalculando diferencias (id_presupuesto=${id_presupuesto}, numero_impresion=${snapshot.numero_impresion})`);
        console.log(`📸 [SNAPSHOT-MOD] Detalles snapshot (foto impresa): ${snapshot.snapshot_detalles.length} items`);
        console.log(`📸 [SNAPSHOT-MOD] Detalles actuales (BD): ${detallesActuales.length} items`);
        
        // Log detallado de los detalles para debug
        console.log(`📸 [SNAPSHOT-MOD] Snapshot detalles (primeros 3):`, JSON.stringify(snapshot.snapshot_detalles.slice(0, 3), null, 2));
        console.log(`📸 [SNAPSHOT-MOD] Detalles actuales (primeros 3):`, JSON.stringify(detallesActuales.slice(0, 3), null, 2));
        
        // 4. Comparar y calcular diferencias - SIEMPRE RECALCULAR DESDE CERO
        const diferencias = calcularDiferencias(snapshot.snapshot_detalles, detallesActuales);
        
        console.log(`📸 [SNAPSHOT-MOD] Diferencias encontradas: ${diferencias.length} cambios`);
        if (diferencias.length > 0) {
            console.log(`📸 [SNAPSHOT-MOD] Detalle de diferencias:`, JSON.stringify(diferencias, null, 2));
        }
        
        if (diferencias.length === 0) {
            console.log(`📸 [SNAPSHOT-MOD] Sin cambios reales, diferencias_detalles limpiadas`);
            
            // Actualizar snapshot para limpiar diferencias_detalles si ya no hay cambios
            const clearDifQuery = `
                UPDATE presupuestos_snapshots
                SET 
                    diferencias_detalles = NULL,
                    fecha_snapshot = NOW()
                WHERE id = $1
                RETURNING id
            `;
            
            await db.query(clearDifQuery, [snapshot.id]);
            
            return {
                success: true,
                hasSnapshot: true,
                hasDifferences: false,
                message: 'No hay cambios respecto al snapshot'
            };
        }
        
        // 5. Actualizar snapshot con diferencias (incluyendo secuencia_en_snapshot)
        const nuevoNumeroImpresion = (snapshot.numero_impresion || 0) + 1;
        
        const updateSnapshotQuery = `
            UPDATE presupuestos_snapshots
            SET 
                diferencias_detalles = $1,
                numero_impresion = $2,
                motivo = $3,
                secuencia_en_snapshot = $4,
                fecha_snapshot = NOW()
            WHERE id = $5
            RETURNING id, numero_impresion, motivo, secuencia_en_snapshot
        `;
        
        const updateSnapshotResult = await db.query(updateSnapshotQuery, [
            JSON.stringify(diferencias),
            nuevoNumeroImpresion,
            'modificado',
            'Imprimir_Modificado',
            snapshot.id
        ]);
        
        const snapshotActualizado = updateSnapshotResult.rows[0];
        
        console.log(`✅ [SNAPSHOT-MOD] diferencias_detalles sobrescritas correctamente`);
        console.log(`📸 [SNAPSHOT-MOD] Snapshot id=${snapshotActualizado.id} actualizado:`);
        console.log(`📸 [SNAPSHOT-MOD]   - numero_impresion: ${snapshotActualizado.numero_impresion} (antes: ${snapshot.numero_impresion})`);
        console.log(`📸 [SNAPSHOT-MOD]   - motivo: ${snapshotActualizado.motivo}`);
        console.log(`📸 [SNAPSHOT-MOD]   - secuencia_en_snapshot: ${snapshotActualizado.secuencia_en_snapshot}`);
        console.log(`📸 [SNAPSHOT-MOD]   - diferencias_count: ${diferencias.length}`);
        console.log(`📸 [SNAPSHOT-MOD]   - snapshot_detalles (NO modificado): ${snapshot.snapshot_detalles.length} items`);
        
        // 6. Actualizar secuencia del presupuesto a 'Imprimir_Modificado'
        const updatePresupuestoQuery = `
            UPDATE presupuestos
            SET secuencia = $1
            WHERE id = $2
            RETURNING id, secuencia
        `;
        
        const updatePresupuestoResult = await db.query(updatePresupuestoQuery, [
            'Imprimir_Modificado',
            id_presupuesto
        ]);
        
        if (updatePresupuestoResult.rows.length > 0) {
            console.log(`✅ [SNAPSHOT-MOD] UPDATE secuencia presupuesto -> Imprimir_Modificado`);
        }
        
        return {
            success: true,
            hasSnapshot: true,
            hasDifferences: true,
            snapshot_id: snapshotActualizado.id,
            numero_impresion: snapshotActualizado.numero_impresion,
            diferencias_count: diferencias.length,
            diferencias: diferencias
        };
        
    } catch (error) {
        console.error('❌ [SNAPSHOT-MOD] Error al actualizar snapshot:', error);
        console.error('❌ [SNAPSHOT-MOD] Stack:', error.stack);
        return {
            success: false,
            error: error.message
        };
    }
}

/**
 * Calcular diferencias entre snapshot y estado actual
 * @param {Array} snapshotDetalles - Detalles del snapshot (foto anterior)
 * @param {Array} detallesActuales - Detalles actuales del presupuesto
 * @returns {Array} - Array de diferencias
 */
function calcularDiferencias(snapshotDetalles, detallesActuales) {
    const diferencias = [];
    
    console.log(`📸 [CALC-DIF] Iniciando cálculo de diferencias`);
    console.log(`📸 [CALC-DIF] Snapshot tiene ${snapshotDetalles.length} items`);
    console.log(`📸 [CALC-DIF] Actuales tiene ${detallesActuales.length} items`);
    
    // Crear mapas para comparación rápida
    const snapshotMap = new Map();
    snapshotDetalles.forEach(item => {
        snapshotMap.set(item.articulo, item);
    });
    
    const actualesMap = new Map();
    detallesActuales.forEach(item => {
        actualesMap.set(item.articulo, item);
    });
    
    console.log(`📸 [CALC-DIF] Artículos en snapshot: [${Array.from(snapshotMap.keys()).join(', ')}]`);
    console.log(`📸 [CALC-DIF] Artículos en actuales: [${Array.from(actualesMap.keys()).join(', ')}]`);
    
    // 1. Detectar modificados y eliminados (iterar sobre snapshot)
    snapshotDetalles.forEach(itemSnapshot => {
        const articulo = itemSnapshot.articulo;
        const itemActual = actualesMap.get(articulo);
        
        if (!itemActual) {
            // Artículo eliminado
            console.log(`📸 [CALC-DIF] ELIMINADO detectado: ${articulo} (${itemSnapshot.descripcion})`);
            diferencias.push({
                articulo: articulo,
                descripcion: itemSnapshot.descripcion || '',
                tipo_cambio: 'eliminado',
                cantidad_antes: itemSnapshot.cantidad || 0,
                cantidad_despues: 0
            });
        } else {
            // Verificar SOLO si hubo cambios de CANTIDAD (ignorar precio)
            const cantidadAntes = parseFloat(itemSnapshot.cantidad || 0);
            const cantidadDespues = parseFloat(itemActual.cantidad || 0);
            const cantidadCambio = cantidadAntes !== cantidadDespues;
            
            if (cantidadCambio) {
                // Artículo modificado (solo si cambió cantidad)
                diferencias.push({
                    articulo: articulo,
                    descripcion: itemActual.descripcion || itemSnapshot.descripcion || '',
                    tipo_cambio: 'modificado',
                    cantidad_antes: cantidadAntes,
                    cantidad_despues: cantidadDespues
                });
            }
        }
    });
    
    // 2. Detectar agregados (iterar sobre actuales)
    detallesActuales.forEach(itemActual => {
        const articulo = itemActual.articulo;
        const itemSnapshot = snapshotMap.get(articulo);
        
        if (!itemSnapshot) {
            // Artículo agregado
            console.log(`📸 [CALC-DIF] AGREGADO detectado: ${articulo} (${itemActual.descripcion})`);
            diferencias.push({
                articulo: articulo,
                descripcion: itemActual.descripcion || '',
                tipo_cambio: 'agregado',
                cantidad_antes: 0,
                cantidad_despues: parseFloat(itemActual.cantidad || 0)
            });
        }
    });
    
    console.log(`📸 [CALC-DIF] Total diferencias encontradas: ${diferencias.length}`);
    console.log(`📸 [CALC-DIF] Resumen por tipo:`, {
        eliminados: diferencias.filter(d => d.tipo_cambio === 'eliminado').length,
        agregados: diferencias.filter(d => d.tipo_cambio === 'agregado').length,
        modificados: diferencias.filter(d => d.tipo_cambio === 'modificado').length
    });
    
    return diferencias;
}

module.exports = {
    actualizarSnapshotConDiferencias,
    calcularDiferencias
};
