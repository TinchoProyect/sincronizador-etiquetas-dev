/**
 * Controlador de Artículos
 * Gestión de datos de artículos (peso, stock, etc.)
 */

console.log('📦 [ARTICULOS-CONTROLLER] Cargando controlador de artículos...');

/**
 * Actualizar peso/kilos de un artículo
 * @route PUT /api/logistica/articulos/:articulo_numero/peso
 */
async function actualizarPesoArticulo(req, res) {
    const { articulo_numero } = req.params;
    const { kilos_unidad } = req.body;
    
    const requestId = `peso-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    console.log(`📦 [ARTICULOS] ${requestId} - Actualizando peso de artículo: ${articulo_numero}`);
    
    try {
        // Validar parámetros
        if (!articulo_numero) {
            console.log(`❌ [ARTICULOS] ${requestId} - Falta articulo_numero`);
            return res.status(400).json({
                success: false,
                error: 'El número de artículo es requerido'
            });
        }
        
        if (kilos_unidad === undefined || kilos_unidad === null) {
            console.log(`❌ [ARTICULOS] ${requestId} - Falta kilos_unidad`);
            return res.status(400).json({
                success: false,
                error: 'El valor de kilos_unidad es requerido'
            });
        }
        
        const kilosNumerico = parseFloat(kilos_unidad);
        
        if (isNaN(kilosNumerico) || kilosNumerico < 0) {
            console.log(`❌ [ARTICULOS] ${requestId} - Valor inválido: ${kilos_unidad}`);
            return res.status(400).json({
                success: false,
                error: 'El valor de kilos_unidad debe ser un número positivo'
            });
        }
        
        console.log(`📊 [ARTICULOS] ${requestId} - Valor a actualizar: ${kilosNumerico} kg`);
        
        // ✅ CORRECCIÓN: Buscar por articulo_numero (alfanumérico) que es la PK
        const checkQuery = `
            SELECT articulo_numero, codigo_barras, descripcion, kilos_unidad
            FROM public.stock_real_consolidado
            WHERE articulo_numero = $1
            LIMIT 1
        `;
        
        const checkResult = await req.db.query(checkQuery, [articulo_numero]);
        
        if (checkResult.rows.length === 0) {
            console.log(`❌ [ARTICULOS] ${requestId} - Artículo no encontrado en stock_real_consolidado`);
            console.log(`📊 [ARTICULOS] ${requestId} - Buscado por articulo_numero: ${articulo_numero}`);
            return res.status(404).json({
                success: false,
                error: 'Artículo no encontrado en el sistema de stock'
            });
        }
        
        const articuloAntes = checkResult.rows[0];
        console.log(`📦 [ARTICULOS] ${requestId} - Artículo encontrado: ${articuloAntes.descripcion}`);
        console.log(`📊 [ARTICULOS] ${requestId} - Articulo numero (alfanumérico): ${articuloAntes.articulo_numero}`);
        console.log(`📊 [ARTICULOS] ${requestId} - Codigo barras (numérico): ${articuloAntes.codigo_barras}`);
        console.log(`📊 [ARTICULOS] ${requestId} - Peso anterior: ${articuloAntes.kilos_unidad || 'NULL'} kg`);
        
        // ✅ CORRECCIÓN: Actualizar usando articulo_numero (alfanumérico) que es la PK
        const updateQuery = `
            UPDATE public.stock_real_consolidado
            SET kilos_unidad = $1,
                ultima_actualizacion = NOW()
            WHERE articulo_numero = $2
            RETURNING articulo_numero, codigo_barras, descripcion, kilos_unidad, ultima_actualizacion
        `;
        
        const updateResult = await req.db.query(updateQuery, [kilosNumerico, articuloAntes.articulo_numero]);
        
        if (updateResult.rows.length === 0) {
            console.log(`❌ [ARTICULOS] ${requestId} - No se pudo actualizar el artículo`);
            return res.status(500).json({
                success: false,
                error: 'No se pudo actualizar el peso del artículo'
            });
        }
        
        const articuloActualizado = updateResult.rows[0];
        
        console.log(`✅ [ARTICULOS] ${requestId} - Peso actualizado exitosamente`);
        console.log(`📊 [ARTICULOS] ${requestId} - Peso nuevo: ${articuloActualizado.kilos_unidad} kg`);
        
        res.json({
            success: true,
            data: {
                articulo_numero: articuloActualizado.articulo_numero,
                codigo_barras: articuloActualizado.codigo_barras,
                descripcion: articuloActualizado.descripcion,
                kilos_unidad: parseFloat(articuloActualizado.kilos_unidad),
                peso_anterior: articuloAntes.kilos_unidad ? parseFloat(articuloAntes.kilos_unidad) : null,
                ultima_actualizacion: articuloActualizado.ultima_actualizacion
            },
            requestId,
            timestamp: new Date().toISOString()
        });
        
    } catch (error) {
        console.error(`❌ [ARTICULOS] ${requestId} - Error al actualizar peso:`, error);
        res.status(500).json({
            success: false,
            error: 'Error interno al actualizar el peso del artículo',
            message: error.message,
            requestId,
            timestamp: new Date().toISOString()
        });
    }
}

console.log('✅ [ARTICULOS-CONTROLLER] Controlador de artículos configurado');

module.exports = {
    actualizarPesoArticulo
};
