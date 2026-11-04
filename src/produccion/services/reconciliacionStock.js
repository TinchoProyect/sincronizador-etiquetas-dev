/**
 * Servicio de Reconciliación Automática de Pendientes de Compra
 * Sistema LAMDA — Taller de Producción y Pizarra
 *
 * Evalúa atómicamente si el stock consolidado cubre los faltantes en espera.
 * Si hay stock suficiente, marca como 'Resuelto' y libera el pedido para su preparación.
 */

async function reconciliarFaltantesConStock(pool) {
    if (!pool) return [];
    try {
        const query = `
            UPDATE public.faltantes_pendientes_compra fpc
            SET estado = 'Resuelto',
                nota = COALESCE(fpc.nota || ' | ', '') || 'Resuelto automáticamente - Stock: ' || src.stock_consolidado || ' >= Faltante: ' || fpc.cantidad_faltante || ' - ' || NOW()::text
            FROM public.stock_real_consolidado src,
                 public.presupuestos p
            WHERE fpc.id_presupuesto_local = p.id
              AND fpc.estado = 'En espera'
              AND p.activo = true
              AND p.estado = 'Presupuesto/Orden'
              AND (src.articulo_numero = fpc.articulo_numero OR src.codigo_barras = fpc.codigo_barras)
              AND src.stock_consolidado::numeric >= fpc.cantidad_faltante::numeric
            RETURNING fpc.id, fpc.articulo_numero, fpc.cantidad_faltante, fpc.id_presupuesto_local, src.stock_consolidado;
        `;
        const result = await pool.query(query);
        if (result.rowCount > 0) {
            console.log(`🎉 [AUTO-RECONCILIAR] ${result.rowCount} faltante(s) resueltos automáticamente por stock suficiente:`, result.rows);
        }
        return result.rows;
    } catch (error) {
        console.error('⚠️ [AUTO-RECONCILIAR] Error al reconciliar faltantes con stock:', error);
        return [];
    }
}

module.exports = {
    reconciliarFaltantesConStock
};
