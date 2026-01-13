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
        // Obtener tipos de movimiento desde query params
        const tiposParam = req.query.tipos || 'salida a ventas,ingreso a producción';
        const tiposMovimiento = tiposParam.split(',').map(t => t.trim());

        console.log('📊 [INFORME-PROD] Obteniendo historial completo (CTE Refactor)...');
        console.log('🔍 [INFORME-PROD] Tipos de movimiento:', tiposMovimiento);

        const query = `
                WITH movimientos_agrupados AS (
                    SELECT 
                        articulo_numero,
                        COUNT(id) as total_registros,
                        -- Agregación Condicional por Tipo (ROBUST FIX: ILIKE)
                        SUM(CASE WHEN tipo ILIKE '%producc%' THEN cantidad ELSE 0 END) as cantidad_ingresos,
                        SUM(CASE WHEN tipo ILIKE '%ventas%' THEN ABS(cantidad) ELSE 0 END) as cantidad_salidas,
                        SUM(CASE WHEN tipo ILIKE '%ajuste%' AND cantidad > 0 THEN cantidad ELSE 0 END) as cantidad_ajustes_pos,
                        SUM(CASE WHEN tipo ILIKE '%ajuste%' AND cantidad < 0 THEN ABS(cantidad) ELSE 0 END) as cantidad_ajustes_neg,
                        -- Total neto para balance
                        SUM(cantidad) as balance_neto,
                        
                        COUNT(DISTINCT DATE_TRUNC('month', fecha)) as meses_activos
                    FROM stock_ventas_movimientos
                     -- WHERE tipo filter is applied below loosely or we rely on the specific sums logic
                     -- We still need to filter broadly.
                     -- Let's include everything that looks like the requested types.
                    WHERE (
                        tipo ILIKE '%producc%' OR 
                        tipo ILIKE '%ventas%' OR 
                        tipo ILIKE '%ajuste%'
                    )
                    GROUP BY articulo_numero
                )
                SELECT 
                    a.numero as articulo_codigo,
                    a.nombre as articulo_nombre,
                    a.codigo_barras,
                    COALESCE(pa.rubro, 'Sin Rubro') as rubro,
                    COALESCE(pa.sub_rubro, 'Sin Subrubro') as subrubro,
                    
                    -- Datos agregados desde CTE (Garantiza 1:1)
                    COALESCE(ma.total_registros, 0) as total_registros,
                    COALESCE(ma.cantidad_ingresos, 0) as cantidad_ingresos,
                    COALESCE(ma.cantidad_salidas, 0) as cantidad_salidas,
                    COALESCE(ma.cantidad_ajustes_pos, 0) as cantidad_ajustes_pos,
                    COALESCE(ma.cantidad_ajustes_neg, 0) as cantidad_ajustes_neg,
                    COALESCE(ma.balance_neto, 0) as balance_neto,
                    COALESCE(ma.meses_activos, 0) as meses_activos,
                    
                    -- Totales absolutos
                    (COALESCE(ma.cantidad_ingresos, 0) + COALESCE(ma.cantidad_salidas, 0) + COALESCE(ma.cantidad_ajustes_pos, 0) + COALESCE(ma.cantidad_ajustes_neg, 0)) as cantidad_total_producida,
                    
                    -- Metadata
                    COALESCE(src.kilos_unidad, 0) as kilos_unidad,
                    (COALESCE(ma.cantidad_ingresos, 0) + COALESCE(ma.cantidad_salidas, 0) + COALESCE(ma.cantidad_ajustes_pos, 0) + COALESCE(ma.cantidad_ajustes_neg, 0)) * COALESCE(src.kilos_unidad, 0) as kilos_totales_producidos,
                    
                    src.es_pack
                FROM movimientos_agrupados ma
                -- Usamos RIGHT JOIN o LEFT JOIN asegurando unicidad en Articulos
                -- Protegemos contra duplicados en tabla articulos usando DISTINCT
                JOIN (SELECT DISTINCT ON (numero) * FROM articulos ORDER BY numero) a ON a.numero = ma.articulo_numero
                
                -- JOINS Optimizados con DISTINCT ON para evitar duplicados en metadatos
                LEFT JOIN (
                    SELECT DISTINCT ON (articulo) articulo, rubro, sub_rubro 
                    FROM precios_articulos
                    ORDER BY articulo, rubro, sub_rubro
                ) pa ON pa.articulo = a.numero
                LEFT JOIN (
                    SELECT DISTINCT ON (articulo_numero) articulo_numero, kilos_unidad, es_pack
                    FROM stock_real_consolidado
                    ORDER BY articulo_numero
                ) src ON src.articulo_numero = a.numero
                ORDER BY 
                    COALESCE(pa.rubro, 'Sin Rubro') ASC,
                    COALESCE(pa.sub_rubro, 'Sin Subrubro') ASC,
                    a.nombre ASC
            `;

        // No pasamos parámetros porque hemos hardcodeado la lógica robusta (Nuclear Fix)
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
            tipos_aplicados: tiposMovimiento,
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
 * 
 * @param {Object} req - Request de Express
 * @param {Object} res - Response de Express
 * @returns {Object} JSON con producción del periodo
 */
async function obtenerProduccionPorPeriodo(req, res) {
    try {
        const { fecha_inicio, fecha_fin, tipos } = req.query;

        console.log(`📊 [INFORME-PROD] Obteniendo producción por periodo: ${fecha_inicio} a ${fecha_fin}`);

        // Validar parámetros
        if (!fecha_inicio || !fecha_fin) {
            return res.status(400).json({
                success: false,
                error: 'Se requieren fecha_inicio y fecha_fin'
            });
        }

        const tiposParam = tipos || 'salida a ventas,ingreso a producción';
        const tiposMovimiento = tiposParam.split(',').map(t => t.trim());

        // console.log('🔍 [INFORME-PROD] Tipos de movimiento:', tiposMovimiento);

        const query = `
            WITH movimientos_agrupados AS (
                SELECT 
                    articulo_numero,
                    COUNT(id) as total_registros,
                    -- Agregación Condicional
                    SUM(CASE WHEN tipo ILIKE '%producc%' THEN cantidad ELSE 0 END) as cantidad_ingresos,
                    SUM(CASE WHEN tipo ILIKE '%ventas%' THEN ABS(cantidad) ELSE 0 END) as cantidad_salidas,
                    SUM(CASE WHEN tipo ILIKE '%ajuste%' AND cantidad > 0 THEN cantidad ELSE 0 END) as cantidad_ajustes_pos,
                    SUM(CASE WHEN tipo ILIKE '%ajuste%' AND cantidad < 0 THEN ABS(cantidad) ELSE 0 END) as cantidad_ajustes_neg,
                    SUM(cantidad) as balance_neto,
                    
                    ARRAY_AGG(DISTINCT DATE_TRUNC('day', fecha)::date ORDER BY DATE_TRUNC('day', fecha)::date) as fechas_produccion
                FROM stock_ventas_movimientos
                WHERE (
                        tipo ILIKE '%producc%' OR 
                        tipo ILIKE '%ventas%' OR 
                        tipo ILIKE '%ajuste%'
                    )
                    AND fecha >= $1::date
                    AND fecha <= $2::date + INTERVAL '1 day' - INTERVAL '1 second'
                GROUP BY articulo_numero
            )
            SELECT 
                a.numero as articulo_codigo,
                a.nombre as articulo_nombre,
                a.codigo_barras,
                COALESCE(pa.rubro, 'Sin Rubro') as rubro,
                COALESCE(pa.sub_rubro, 'Sin Subrubro') as subrubro,
                
                -- Datos agregados
                COALESCE(ma.total_registros, 0) as total_registros,
                COALESCE(ma.cantidad_ingresos, 0) as cantidad_ingresos,
                COALESCE(ma.cantidad_salidas, 0) as cantidad_salidas,
                COALESCE(ma.cantidad_ajustes_pos, 0) as cantidad_ajustes_pos,
                COALESCE(ma.cantidad_ajustes_neg, 0) as cantidad_ajustes_neg,
                COALESCE(ma.balance_neto, 0) as cantidad_producida, -- REUSAMOS KEY para compatibilidad
                
                -- Totales para cálculo de KPI
                (COALESCE(ma.cantidad_ingresos, 0) + COALESCE(ma.cantidad_salidas, 0) + COALESCE(ma.cantidad_ajustes_pos, 0) + COALESCE(ma.cantidad_ajustes_neg, 0)) as volumen_actividad,
                
                COALESCE(ma.fechas_produccion, '{}') as fechas_produccion,
                
                COALESCE(src.kilos_unidad, 0) as kilos_unidad,
                (COALESCE(ma.cantidad_ingresos, 0) + COALESCE(ma.cantidad_salidas, 0) + COALESCE(ma.cantidad_ajustes_pos, 0) + COALESCE(ma.cantidad_ajustes_neg, 0)) * COALESCE(src.kilos_unidad, 0) as kilos_producidos,
                
                src.es_pack
            FROM movimientos_agrupados ma
            JOIN (SELECT DISTINCT ON (numero) * FROM articulos ORDER BY numero) a ON a.numero = ma.articulo_numero
            LEFT JOIN (
                SELECT DISTINCT ON (articulo) articulo, rubro, sub_rubro 
                FROM precios_articulos
                ORDER BY articulo, rubro, sub_rubro
            ) pa ON pa.articulo = a.numero
            LEFT JOIN (
                SELECT DISTINCT ON (articulo_numero) articulo_numero, kilos_unidad, es_pack
                FROM stock_real_consolidado
                ORDER BY articulo_numero
            ) src ON src.articulo_numero = a.numero
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
            cantidad_total: result.rows.reduce((sum, row) => sum + parseFloat(row.volumen_actividad || 0), 0),
            kilos_totales: result.rows.reduce((sum, row) => sum + parseFloat(row.kilos_producidos || 0), 0)
        };

        res.json({
            success: true,
            data: result.rows,
            estadisticas: estadisticas,
            tipos_aplicados: tiposMovimiento,
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
