console.log('🔍 [PRESUPUESTOS] Cargando controlador de presupuestos...');

/**
 * Controlador principal para la gestión de presupuestos
 * Maneja la lógica de negocio del módulo
 */

/**
 * Obtener todos los presupuestos
 */
const obtenerPresupuestos = async (req, res) => {
    try {
        console.log('🔍 [PRESUPUESTOS] Iniciando obtención de presupuestos...');
        
        const query = `
            SELECT 
                id,
                sheet_id,
                sheet_name,
                categoria,
                concepto,
                monto,
                fecha_registro,
                fecha_sincronizacion,
                activo
            FROM presupuestos_datos 
            WHERE activo = true 
            ORDER BY fecha_sincronizacion DESC, categoria, concepto
        `;
        
        console.log('📋 [PRESUPUESTOS] Ejecutando consulta:', query);
        const result = await req.db.query(query);
        
        console.log(`✅ [PRESUPUESTOS] Presupuestos obtenidos: ${result.rows.length} registros`);
        
        // Log de categorías encontradas para debugging
        const categorias = [...new Set(result.rows.map(row => row.categoria))];
        console.log('📊 [PRESUPUESTOS] Categorías encontradas:', categorias);
        
        res.json({
            success: true,
            data: result.rows,
            total: result.rows.length,
            categorias: categorias,
            timestamp: new Date().toISOString()
        });
        
    } catch (error) {
        console.error('❌ [PRESUPUESTOS] Error al obtener presupuestos:', error);
        res.status(500).json({
            success: false,
            error: 'Error al obtener presupuestos',
            message: error.message,
            timestamp: new Date().toISOString()
        });
    }
};

/**
 * Obtener presupuestos por categoría
 */
const obtenerPresupuestosPorCategoria = async (req, res) => {
    try {
        const { categoria } = req.params;
        console.log(`🔍 [PRESUPUESTOS] Obteniendo presupuestos para categoría: ${categoria}`);
        
        const query = `
            SELECT 
                id,
                sheet_id,
                sheet_name,
                categoria,
                concepto,
                monto,
                fecha_registro,
                fecha_sincronizacion,
                activo
            FROM presupuestos_datos 
            WHERE activo = true AND LOWER(categoria) = LOWER($1)
            ORDER BY fecha_sincronizacion DESC, concepto
        `;
        
        const result = await req.db.query(query, [categoria]);
        
        console.log(`✅ [PRESUPUESTOS] Presupuestos encontrados para '${categoria}': ${result.rows.length} registros`);
        
        res.json({
            success: true,
            data: result.rows,
            categoria: categoria,
            total: result.rows.length,
            timestamp: new Date().toISOString()
        });
        
    } catch (error) {
        console.error(`❌ [PRESUPUESTOS] Error al obtener presupuestos por categoría:`, error);
        res.status(500).json({
            success: false,
            error: 'Error al obtener presupuestos por categoría',
            message: error.message,
            timestamp: new Date().toISOString()
        });
    }
};

/**
 * Obtener estadísticas de presupuestos
 */
const obtenerEstadisticas = async (req, res) => {
    try {
        console.log('🔍 [PRESUPUESTOS] Calculando estadísticas...');
        
        const query = `
            SELECT 
                COUNT(*) as total_registros,
                COUNT(DISTINCT categoria) as total_categorias,
                SUM(monto) as monto_total,
                AVG(monto) as monto_promedio,
                MIN(monto) as monto_minimo,
                MAX(monto) as monto_maximo,
                MAX(fecha_sincronizacion) as ultima_sincronizacion
            FROM presupuestos_datos 
            WHERE activo = true
        `;
        
        const result = await req.db.query(query);
        const stats = result.rows[0];
        
        // Obtener distribución por categorías
        const categoriasQuery = `
            SELECT 
                categoria,
                COUNT(*) as cantidad,
                SUM(monto) as monto_categoria,
                AVG(monto) as promedio_categoria
            FROM presupuestos_datos 
            WHERE activo = true 
            GROUP BY categoria 
            ORDER BY monto_categoria DESC
        `;
        
        const categoriasResult = await req.db.query(categoriasQuery);
        
        console.log('✅ [PRESUPUESTOS] Estadísticas calculadas exitosamente');
        console.log(`📊 [PRESUPUESTOS] Total registros: ${stats.total_registros}`);
        console.log(`💰 [PRESUPUESTOS] Monto total: $${parseFloat(stats.monto_total || 0).toFixed(2)}`);
        
        res.json({
            success: true,
            estadisticas: {
                total_registros: parseInt(stats.total_registros),
                total_categorias: parseInt(stats.total_categorias),
                monto_total: parseFloat(stats.monto_total || 0),
                monto_promedio: parseFloat(stats.monto_promedio || 0),
                monto_minimo: parseFloat(stats.monto_minimo || 0),
                monto_maximo: parseFloat(stats.monto_maximo || 0),
                ultima_sincronizacion: stats.ultima_sincronizacion
            },
            categorias: categoriasResult.rows,
            timestamp: new Date().toISOString()
        });
        
    } catch (error) {
        console.error('❌ [PRESUPUESTOS] Error al calcular estadísticas:', error);
        res.status(500).json({
            success: false,
            error: 'Error al calcular estadísticas',
            message: error.message,
            timestamp: new Date().toISOString()
        });
    }
};

/**
 * Obtener configuración actual
 */
const obtenerConfiguracion = async (req, res) => {
    try {
        console.log('🔍 [PRESUPUESTOS] Obteniendo configuración actual...');
        
        const query = `
            SELECT 
                id,
                sheet_url,
                sheet_id,
                range_datos,
                ultima_sincronizacion,
                activo,
                creado_por,
                fecha_creacion
            FROM presupuestos_config 
            WHERE activo = true 
            ORDER BY fecha_creacion DESC 
            LIMIT 1
        `;
        
        const result = await req.db.query(query);
        
        if (result.rows.length === 0) {
            console.log('⚠️ [PRESUPUESTOS] No se encontró configuración activa');
            return res.json({
                success: true,
                data: null,
                message: 'No hay configuración activa',
                timestamp: new Date().toISOString()
            });
        }
        
        const config = result.rows[0];
        console.log('✅ [PRESUPUESTOS] Configuración encontrada:', config.sheet_id);
        
        res.json({
            success: true,
            data: config,
            timestamp: new Date().toISOString()
        });
        
    } catch (error) {
        console.error('❌ [PRESUPUESTOS] Error al obtener configuración:', error);
        res.status(500).json({
            success: false,
            error: 'Error al obtener configuración',
            message: error.message,
            timestamp: new Date().toISOString()
        });
    }
};

console.log('✅ [PRESUPUESTOS] Controlador de presupuestos configurado');

module.exports = {
    obtenerPresupuestos,
    obtenerPresupuestosPorCategoria,
    obtenerEstadisticas,
    obtenerConfiguracion
};
