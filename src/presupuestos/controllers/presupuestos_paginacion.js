const pool = require('../config/database');

console.log('🔍 [PRESUPUESTOS-PAGINACION] Cargando controlador con paginación y filtro...');

/**
 * Obtener presupuestos con paginación y filtro por concepto
 */
async function obtenerPresupuestos(req, res) {
    console.log('🔍 [PRESUPUESTOS-PAGINACION] Obteniendo presupuestos...');
    
    try {
        const limit = parseInt(req.query.limit) || 50;
        const offset = parseInt(req.query.offset) || 0;
        const agente = req.query.agente || '';
        const concepto = req.query.concepto || '';
        
        console.log(`📊 [PRESUPUESTOS-PAGINACION] Parámetros: limit=${limit}, offset=${offset}, agente=${agente}, concepto=${concepto}`);
        
        let whereConditions = [];
        let queryParams = [];
        let paramIndex = 1;
        
        if (agente) {
            whereConditions.push(`agente = $${paramIndex}`);
            queryParams.push(agente);
            paramIndex++;
        }
        
        if (concepto) {
            whereConditions.push(`(id_cliente ILIKE $${paramIndex} OR id_presupuesto_ext ILIKE $${paramIndex})`);
            queryParams.push(`%${concepto}%`);
            paramIndex++;
        }
        
        const whereClause = whereConditions.length > 0 ? `WHERE ${whereConditions.join(' AND ')}` : '';
        
        // Consulta principal con paginación
        const dataQuery = `
            SELECT 
                id_cliente as categoria,
                id_presupuesto_ext as concepto,
                monto_total as monto,
                fecha_registro,
                fecha_sincronizacion
            FROM presupuestos 
            ${whereClause}
            ORDER BY fecha_registro DESC 
            LIMIT $${paramIndex} OFFSET $${paramIndex + 1}
        `;
        
        queryParams.push(limit, offset);
        
        // Consulta para contar total de registros
        const countQuery = `
            SELECT COUNT(*) as total 
            FROM presupuestos 
            ${whereClause}
        `;
        
        const countParams = queryParams.slice(0, -2); // Remover limit y offset para el count
        
        // Ejecutar ambas consultas
        const [dataResult, countResult] = await Promise.all([
            pool.query(dataQuery, queryParams),
            pool.query(countQuery, countParams)
        ]);
        
        const presupuestos = dataResult.rows;
        const total = parseInt(countResult.rows[0].total);
        const totalPages = Math.ceil(total / limit);
        
        // Obtener categorías únicas para el filtro
        const categoriasResult = await pool.query('SELECT DISTINCT agente FROM presupuestos WHERE agente IS NOT NULL ORDER BY agente');
        const categorias = categoriasResult.rows.map(row => row.agente);
        
        // Calcular estadísticas
        const statsResult = await pool.query(`
            SELECT 
                COUNT(*) as total_registros,
                SUM(monto_total) as monto_total,
                COUNT(DISTINCT agente) as total_agentes,
                MAX(fecha_sincronizacion) as ultima_sincronizacion
            FROM presupuestos
        `);
        
        const estadisticas = {
            totalRegistros: parseInt(statsResult.rows[0].total_registros) || 0,
            montoTotal: parseFloat(statsResult.rows[0].monto_total) || 0,
            totalAgentes: parseInt(statsResult.rows[0].total_agentes) || 0,
            ultimaSincronizacion: statsResult.rows[0].ultima_sincronizacion
        };
        
        console.log(`✅ [PRESUPUESTOS-PAGINACION] Datos obtenidos: ${presupuestos.length} registros de ${total} totales (filtrados)`);
        
        res.json({
            success: true,
            data: presupuestos,
            categorias: categorias,
            estadisticas: estadisticas,
            pagination: {
                currentPage: Math.floor(offset / limit) + 1,
                totalPages: totalPages,
                limit: limit,
                offset: offset,
                total: total
            },
            total: total
        });
        
    } catch (error) {
        console.error('❌ [PRESUPUESTOS-PAGINACION] Error al obtener presupuestos:', error);
        res.status(500).json({
            success: false,
            message: 'Error al obtener presupuestos',
            error: error.message
        });
    }
}

/**
 * Obtener estadísticas generales
 */
async function obtenerEstadisticas(req, res) {
    console.log('🔍 [PRESUPUESTOS-PAGINACION] Obteniendo estadísticas...');
    
    try {
        const statsResult = await pool.query(`
            SELECT 
                COUNT(*) as total_registros,
                SUM(monto_total) as monto_total,
                COUNT(DISTINCT agente) as total_agentes,
                MAX(fecha_sincronizacion) as ultima_sincronizacion
            FROM presupuestos
        `);
        
        const estadisticas = {
            totalRegistros: parseInt(statsResult.rows[0].total_registros) || 0,
            montoTotal: parseFloat(statsResult.rows[0].monto_total) || 0,
            totalAgentes: parseInt(statsResult.rows[0].total_agentes) || 0,
            ultimaSincronizacion: statsResult.rows[0].ultima_sincronizacion
        };
        
        console.log('✅ [PRESUPUESTOS-PAGINACION] Estadísticas obtenidas');
        
        res.json({
            success: true,
            estadisticas: estadisticas
        });
        
    } catch (error) {
        console.error('❌ [PRESUPUESTOS-PAGINACION] Error al obtener estadísticas:', error);
        res.status(500).json({
            success: false,
            message: 'Error al obtener estadísticas',
            error: error.message
        });
    }
}

console.log('✅ [PRESUPUESTOS-PAGINACION] Controlador con paginación configurado');

module.exports = {
    obtenerPresupuestos,
    obtenerEstadisticas
};
