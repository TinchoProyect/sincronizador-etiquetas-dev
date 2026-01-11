/**
 * ============================================================================
 * CONTROLADOR: INFORME DE PRODUCCIÓN INTERNA
 * ============================================================================
 * 
 * Propósito: Módulo de inteligencia de negocios para visualizar y analizar
 * el historial completo de producción interna de LAMDA.
 * 
 * Este controlador es la "piedra fundamental" para futuros cruces de datos
 * con ventas y presupuestos, permitiendo tomar decisiones estratégicas
 * basadas en datos históricos de producción.
 * 
 * Funcionalidades:
 * - Obtener historial completo de producción
 * - Filtrar producción por periodos (rangos de fechas)
 * - Obtener jerarquía de Rubros y Subrubros
 * - Comparar producción entre diferentes periodos
 * 
 * @author Sistema LAMDA
 * @version 1.0.0
 * @date 2024
 */

const pool = require('../config/database');

/**
 * Obtener el historial completo de producción interna
 * 
 * Retorna todos los registros de producción agrupados por artículo,
 * organizados jerárquicamente por Rubro > Subrubro > Artículo
 * 
 * @param {Object} req - Request de Express
 * @param {Object} res - Response de Express
 * @returns {Object} JSON con historial de producción
 */
async function obtenerHistorialProduccion(req, res) {
    try {
        console.log('📊 [INFORME-PROD] Obteniendo historial completo de producción...');

        const query = `
            SELECT 
                a.numero as articulo_codigo,
                a.nombre as articulo_nombre,
                a.codigo_barras,
                COALESCE(pa.rubro, 'Sin Rubro') as rubro,
                COALESCE(pa.sub_rubro, 'Sin Subrubro') as subrubro,
                COUNT(DISTINCT svm.id) as total_registros,
                SUM(svm.cantidad) as cantidad_total_producida,
                SUM(svm.kilos) as kilos_totales_producidos,
                MIN(svm.fecha) as primera_produccion,
                MAX(svm.fecha) as ultima_produccion,
                COUNT(DISTINCT DATE_TRUNC('month', svm.fecha)) as meses_activos
            FROM stock_ventas_movimientos svm
            JOIN articulos a ON a.numero = svm.articulo_numero
            LEFT JOIN precios_articulos pa ON pa.articulo = a.numero
            WHERE svm.tipo = 'ingreso a producción'
            GROUP BY 
                a.numero, 
                a.nombre, 
                a.codigo_barras,
                pa.rubro, 
                pa.sub_rubro
            ORDER BY 
                COALESCE(pa.rubro, 'Sin Rubro') ASC,
                COALESCE(pa.sub_rubro, 'Sin Subrubro') ASC,
                a.nombre ASC
        `;

        const result = await pool.query(query);

        console.log(`✅ [INFORME-PROD] Historial obtenido: ${result.rows.length} artículos`);

        // Calcular estadísticas generales
        const estadisticas = {
            total_articulos: result.rows.length,
            total_registros: result.rows.reduce((sum, row) => sum + parseInt(row.total_registros), 0),
            cantidad_total: result.rows.reduce((sum, row) => sum + parseFloat(row.cantidad_total_producida || 0), 0),
            kilos_totales: result.rows.reduce((sum, row) => sum + parseFloat(row.kilos_totales_producidos || 0), 0)
        };

        res.json({
            success: true,
            data: result.rows,
            estadisticas: estadisticas,
            timestamp: new Date().toISOString()
        });

    } catch (error) {
        console.error('❌ [INFORME-PROD] Error al obtener historial:', error);
        res.status(500).json({
            success: false,
            error: 'Error al obtener historial de producción',
            message: error.message
        });
    }
}

/**
 * Obtener producción filtrada por periodo (rango de fechas)
 * 
 * Permite comparar producción entre diferentes periodos de tiempo.
 * Útil para análisis de estacionalidad y tendencias.
 * 
 * Query params:
 * - fecha_inicio: Fecha de inicio del periodo (YYYY-MM-DD)
 * - fecha_fin: Fecha de fin del periodo (YYYY-MM-DD)
 * 
 * @param {Object} req - Request de Express
 * @param {Object} res - Response de Express
 * @returns {Object} JSON con producción del periodo
 */
async function obtenerProduccionPorPeriodo(req, res) {
    try {
        const { fecha_inicio, fecha_fin } = req.query;

        console.log(`📊 [INFORME-PROD] Obteniendo producción por periodo: ${fecha_inicio} a ${fecha_fin}`);

        // Validar parámetros
        if (!fecha_inicio || !fecha_fin) {
            return res.status(400).json({
                success: false,
                error: 'Se requieren fecha_inicio y fecha_fin'
            });
        }

        const query = `
            SELECT 
                a.numero as articulo_codigo,
                a.nombre as articulo_nombre,
                a.codigo_barras,
                COALESCE(pa.rubro, 'Sin Rubro') as rubro,
                COALESCE(pa.sub_rubro, 'Sin Subrubro') as subrubro,
                COUNT(DISTINCT svm.id) as total_registros,
                SUM(svm.cantidad) as cantidad_producida,
                SUM(svm.kilos) as kilos_producidos,
                MIN(svm.fecha) as primera_produccion_periodo,
                MAX(svm.fecha) as ultima_produccion_periodo,
                ARRAY_AGG(DISTINCT DATE_TRUNC('day', svm.fecha)::date ORDER BY DATE_TRUNC('day', svm.fecha)::date) as fechas_produccion
            FROM stock_ventas_movimientos svm
            JOIN articulos a ON a.numero = svm.articulo_numero
            LEFT JOIN precios_articulos pa ON pa.articulo = a.numero
            WHERE svm.tipo = 'ingreso a producción'
                AND svm.fecha >= $1::date
                AND svm.fecha <= $2::date + INTERVAL '1 day' - INTERVAL '1 second'
            GROUP BY 
                a.numero, 
                a.nombre, 
                a.codigo_barras,
                pa.rubro, 
                pa.sub_rubro
            ORDER BY 
                COALESCE(pa.rubro, 'Sin Rubro') ASC,
                COALESCE(pa.sub_rubro, 'Sin Subrubro') ASC,
                a.nombre ASC
        `;

        const result = await pool.query(query, [fecha_inicio, fecha_fin]);

        console.log(`✅ [INFORME-PROD] Producción del periodo obtenida: ${result.rows.length} artículos`);

        // Calcular estadísticas del periodo
        const estadisticas = {
            periodo: {
                inicio: fecha_inicio,
                fin: fecha_fin
            },
            total_articulos: result.rows.length,
            total_registros: result.rows.reduce((sum, row) => sum + parseInt(row.total_registros), 0),
            cantidad_total: result.rows.reduce((sum, row) => sum + parseFloat(row.cantidad_producida || 0), 0),
            kilos_totales: result.rows.reduce((sum, row) => sum + parseFloat(row.kilos_producidos || 0), 0)
        };

        res.json({
            success: true,
            data: result.rows,
            estadisticas: estadisticas,
            timestamp: new Date().toISOString()
        });

    } catch (error) {
        console.error('❌ [INFORME-PROD] Error al obtener producción por periodo:', error);
        res.status(500).json({
            success: false,
            error: 'Error al obtener producción por periodo',
            message: error.message
        });
    }
}

/**
 * Obtener jerarquía de Rubros y Subrubros
 * 
 * Retorna la estructura jerárquica completa de categorización
 * de artículos para facilitar la navegación y filtrado.
 * 
 * @param {Object} req - Request de Express
 * @param {Object} res - Response de Express
 * @returns {Object} JSON con jerarquía de categorías
 */
async function obtenerRubrosSubrubros(req, res) {
    try {
        console.log('📊 [INFORME-PROD] Obteniendo jerarquía de Rubros y Subrubros...');

        const query = `
            SELECT 
                pa.rubro,
                pa.sub_rubro,
                COUNT(DISTINCT a.numero) as total_articulos
            FROM precios_articulos pa
            JOIN articulos a ON a.numero = pa.articulo
            WHERE EXISTS (
                SELECT 1 
                FROM stock_ventas_movimientos svm 
                WHERE svm.articulo_numero = a.numero 
                AND svm.tipo = 'ingreso a producción'
            )
            GROUP BY pa.rubro, pa.sub_rubro
            ORDER BY 
                COALESCE(pa.rubro, 'Sin Rubro') ASC,
                COALESCE(pa.sub_rubro, 'Sin Subrubro') ASC
        `;

        const result = await pool.query(query);

        // Organizar en estructura jerárquica
        const jerarquia = {};
        
        result.rows.forEach(row => {
            const rubroNombre = row.rubro || 'Sin Rubro';
            const subrubroNombre = row.sub_rubro || 'Sin Subrubro';
            
            if (!jerarquia[rubroNombre]) {
                jerarquia[rubroNombre] = {
                    rubro_nombre: rubroNombre,
                    subrubros: [],
                    total_articulos: 0
                };
            }
            
            jerarquia[rubroNombre].subrubros.push({
                subrubro_nombre: subrubroNombre,
                total_articulos: parseInt(row.total_articulos)
            });
            
            jerarquia[rubroNombre].total_articulos += parseInt(row.total_articulos);
        });

        // Convertir objeto a array
        const jerarquiaArray = Object.values(jerarquia);

        console.log(`✅ [INFORME-PROD] Jerarquía obtenida: ${jerarquiaArray.length} rubros`);

        res.json({
            success: true,
            data: jerarquiaArray,
            timestamp: new Date().toISOString()
        });

    } catch (error) {
        console.error('❌ [INFORME-PROD] Error al obtener jerarquía:', error);
        res.status(500).json({
            success: false,
            error: 'Error al obtener jerarquía de rubros y subrubros',
            message: error.message
        });
    }
}

/**
 * Obtener producción agrupada por mes
 * 
 * Útil para análisis de tendencias y estacionalidad.
 * Retorna la producción mensual de todos los artículos.
 * 
 * @param {Object} req - Request de Express
 * @param {Object} res - Response de Express
 * @returns {Object} JSON con producción mensual
 */
async function obtenerProduccionMensual(req, res) {
    try {
        console.log('📊 [INFORME-PROD] Obteniendo producción mensual...');

        const query = `
            SELECT 
                DATE_TRUNC('month', svm.fecha)::date as mes,
                TO_CHAR(DATE_TRUNC('month', svm.fecha), 'YYYY-MM') as mes_formato,
                TO_CHAR(DATE_TRUNC('month', svm.fecha), 'Month YYYY') as mes_nombre,
                COUNT(DISTINCT a.numero) as articulos_diferentes,
                COUNT(DISTINCT svm.id) as total_registros,
                SUM(svm.cantidad) as cantidad_total,
                SUM(svm.kilos) as kilos_totales
            FROM stock_ventas_movimientos svm
            JOIN articulos a ON a.numero = svm.articulo_numero
            WHERE svm.tipo = 'ingreso a producción'
            GROUP BY DATE_TRUNC('month', svm.fecha)
            ORDER BY mes DESC
        `;

        const result = await pool.query(query);

        console.log(`✅ [INFORME-PROD] Producción mensual obtenida: ${result.rows.length} meses`);

        res.json({
            success: true,
            data: result.rows,
            timestamp: new Date().toISOString()
        });

    } catch (error) {
        console.error('❌ [INFORME-PROD] Error al obtener producción mensual:', error);
        res.status(500).json({
            success: false,
            error: 'Error al obtener producción mensual',
            message: error.message
        });
    }
}

module.exports = {
    obtenerHistorialProduccion,
    obtenerProduccionPorPeriodo,
    obtenerRubrosSubrubros,
    obtenerProduccionMensual
};
