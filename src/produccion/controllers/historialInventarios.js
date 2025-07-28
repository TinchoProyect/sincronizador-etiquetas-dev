const pool = require('../config/database');

/**
 * Obtiene el historial completo de inventarios realizados
 */
async function obtenerHistorialInventarios(req, res) {
    try {
        console.log('🔄 [HISTORIAL-BACKEND] Iniciando obtención de historial de inventarios...');
        
        const query = `
            SELECT 
                igar.inventario_id,
                MIN(igar.fecha_hora) as fecha_creacion,
                igar.usuario_id,
                u.nombre_completo as nombre_usuario,
                COUNT(DISTINCT igar.articulo_numero) as total_articulos,
                COUNT(CASE WHEN igar.stock_consolidado != 0 THEN 1 END) as total_diferencias
            FROM inventario_general_articulos_registro igar
            LEFT JOIN usuarios u ON u.id = igar.usuario_id
            GROUP BY igar.inventario_id, igar.usuario_id, u.nombre_completo
            ORDER BY MIN(igar.fecha_hora) DESC
        `;
        
        console.log('🔄 [HISTORIAL-BACKEND] Ejecutando query de historial...');
        const result = await pool.query(query);
        
        console.log(`✅ [HISTORIAL-BACKEND] Historial obtenido: ${result.rows.length} inventarios encontrados`);
        
        if (result.rows.length > 0) {
            console.log('📋 [HISTORIAL-BACKEND] Muestra del primer inventario:', {
                inventario_id: result.rows[0].inventario_id,
                fecha_creacion: result.rows[0].fecha_creacion,
                usuario: result.rows[0].nombre_usuario,
                total_articulos: result.rows[0].total_articulos,
                total_diferencias: result.rows[0].total_diferencias
            });
        }
        
        res.json(result.rows);
        
    } catch (error) {
        console.error('❌ [HISTORIAL-BACKEND] Error al obtener historial de inventarios:', error);
        
        if (error.code === '42P01') {
            return res.status(500).json({ 
                error: 'Tabla inventario_general_articulos_registro no encontrada. Verifique la estructura de la base de datos.' 
            });
        }
        
        res.status(500).json({ 
            error: 'Error interno del servidor al obtener historial de inventarios',
            details: process.env.NODE_ENV === 'development' ? error.message : undefined
        });
    }
}

/**
 * Obtiene el stock registrado de un inventario específico
 */
async function obtenerStockRegistrado(req, res) {
    try {
        const { inventarioId } = req.params;
        
        console.log(`🔄 [STOCK-REGISTRADO] Obteniendo stock registrado para inventario ${inventarioId}...`);
        
        if (!inventarioId || isNaN(inventarioId)) {
            return res.status(400).json({ error: 'ID de inventario inválido' });
        }
        
        const query = `
            SELECT 
                igar.articulo_numero,
                a.nombre as nombre_articulo,
                igar.stock_consolidado,
                igar.fecha_hora
            FROM inventario_general_articulos_registro igar
            LEFT JOIN articulos a ON a.numero = igar.articulo_numero
            WHERE igar.inventario_id = $1
            ORDER BY igar.fecha_hora ASC
        `;
        
        const result = await pool.query(query, [inventarioId]);
        
        console.log(`✅ [STOCK-REGISTRADO] Stock registrado obtenido: ${result.rows.length} registros para inventario ${inventarioId}`);
        
        if (result.rows.length > 0) {
            console.log('📋 [STOCK-REGISTRADO] Muestra del primer registro:', {
                articulo_numero: result.rows[0].articulo_numero,
                nombre_articulo: result.rows[0].nombre_articulo,
                stock_consolidado: result.rows[0].stock_consolidado
            });
        }
        
        res.json(result.rows);
        
    } catch (error) {
        console.error(`❌ [STOCK-REGISTRADO] Error al obtener stock registrado para inventario ${req.params.inventarioId}:`, error);
        
        if (error.code === '42P01') {
            return res.status(500).json({ 
                error: 'Tabla inventario_general_articulos_registro no encontrada' 
            });
        }
        
        res.status(500).json({ 
            error: 'Error interno del servidor al obtener stock registrado',
            details: process.env.NODE_ENV === 'development' ? error.message : undefined
        });
    }
}

/**
 * Obtiene las diferencias de un inventario específico
 */
async function obtenerDiferencias(req, res) {
    try {
        const { inventarioId } = req.params;
        
        console.log(`🔄 [DIFERENCIAS] Obteniendo diferencias para inventario ${inventarioId}...`);
        
        if (!inventarioId || isNaN(inventarioId)) {
            return res.status(400).json({ error: 'ID de inventario inválido' });
        }
        
        const query = `
            SELECT 
                igad.articulo_numero,
                a.nombre as nombre_articulo,
                igad.stock_antes,
                igad.stock_contado,
                igad.fecha_hora
            FROM inventario_general_articulos_diferencias igad
            LEFT JOIN articulos a ON a.numero = igad.articulo_numero
            WHERE igad.inventario_id = $1
            ORDER BY ABS(igad.stock_contado - igad.stock_antes) DESC
        `;
        
        const result = await pool.query(query, [inventarioId]);
        
        console.log(`✅ [DIFERENCIAS] Diferencias obtenidas: ${result.rows.length} diferencias para inventario ${inventarioId}`);
        
        if (result.rows.length > 0) {
            console.log('📋 [DIFERENCIAS] Muestra de la primera diferencia:', {
                articulo_numero: result.rows[0].articulo_numero,
                nombre_articulo: result.rows[0].nombre_articulo,
                stock_antes: result.rows[0].stock_antes,
                stock_contado: result.rows[0].stock_contado,
                diferencia: result.rows[0].stock_contado - result.rows[0].stock_antes
            });
        }
        
        res.json(result.rows);
        
    } catch (error) {
        console.error(`❌ [DIFERENCIAS] Error al obtener diferencias para inventario ${req.params.inventarioId}:`, error);
        
        if (error.code === '42P01') {
            return res.status(500).json({ 
                error: 'Tabla inventario_general_articulos_diferencias no encontrada' 
            });
        }
        
        res.status(500).json({ 
            error: 'Error interno del servidor al obtener diferencias',
            details: process.env.NODE_ENV === 'development' ? error.message : undefined
        });
    }
}

module.exports = {
    obtenerHistorialInventarios,
    obtenerStockRegistrado,
    obtenerDiferencias
};
