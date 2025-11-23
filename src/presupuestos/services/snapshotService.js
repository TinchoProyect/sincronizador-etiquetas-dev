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
        
        console.log(`📸 [SNAPSHOT-MOD] Artículos en snapshot: ${snapshot.snapshot_detalles.length}, en actual: ${detallesActuales.length}`);
        
        // 4. Comparar y calcular diferencias
        const diferencias = calcularDiferencias(snapshot.snapshot_detalles, detallesActuales);
        
        console.log(`📸 [SNAPSHOT-MOD] Diferencias detectadas: ${diferencias.length} cambios`);
        
        if (diferencias.length === 0) {
            console.log(`📸 [SNAPSHOT-MOD] No hay cambios reales, no se actualiza snapshot`);
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
        
        console.log(`✅ [SNAPSHOT-MOD] UPDATE snapshot exitoso (numero_impresion actualizado, motivo, diferencias_detalles, secuencia_en_snapshot)`);
        console.log(`📸 [SNAPSHOT-MOD] Snapshot id=${snapshotActualizado.id} actualizado:`);
        console.log(`📸 [SNAPSHOT-MOD]   - numero_impresion: ${snapshotActualizado.numero_impresion}`);
        console.log(`📸 [SNAPSHOT-MOD]   - motivo: ${snapshotActualizado.motivo}`);
        console.log(`📸 [SNAPSHOT-MOD]   - secuencia_en_snapshot: ${snapshotActualizado.secuencia_en_snapshot}`);
        console.log(`📸 [SNAPSHOT-MOD]   - diferencias_count: ${diferencias.length}`);
        
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
    
    // Crear mapas para comparación rápida
    const snapshotMap = new Map();
    snapshotDetalles.forEach(item => {
        snapshotMap.set(item.articulo, item);
    });
    
    const actualesMap = new Map();
    detallesActuales.forEach(item => {
        actualesMap.set(item.articulo, item);
    });
    
    // 1. Detectar modificados y eliminados (iterar sobre snapshot)
    snapshotDetalles.forEach(itemSnapshot => {
        const articulo = itemSnapshot.articulo;
        const itemActual = actualesMap.get(articulo);
        
        if (!itemActual) {
            // Artículo eliminado
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
            diferencias.push({
                articulo: articulo,
                descripcion: itemActual.descripcion || '',
                tipo_cambio: 'agregado',
                cantidad_antes: 0,
                cantidad_despues: parseFloat(itemActual.cantidad || 0)
            });
        }
    });
    
    return diferencias;
}

module.exports = {
    actualizarSnapshotConDiferencias,
    calcularDiferencias
};
