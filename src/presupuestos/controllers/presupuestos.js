console.log('🔍 [PRESUPUESTOS] Cargando controlador de presupuestos...');

/**
 * Controlador principal para la gestión de presupuestos
 * Maneja la lógica de negocio del módulo con CRUD completo
 */

/**
 * Obtener todos los presupuestos con filtros avanzados
 */
const obtenerPresupuestos = async (req, res) => {
    try {
        console.log('🔍 [PRESUPUESTOS] Iniciando obtención de presupuestos...');
        
        // Extraer parámetros de filtrado
        const {
            categoria,
            concepto,
            fecha_desde,
            fecha_hasta,
            monto_min,
            monto_max,
            sheet_id,
            limit = 100,
            offset = 0,
            order_by = 'fecha_sincronizacion',
            order_dir = 'DESC'
        } = req.query;
        
        console.log('📋 [PRESUPUESTOS] Filtros aplicados:', {
            categoria, concepto, fecha_desde, fecha_hasta, 
            monto_min, monto_max, sheet_id, limit, offset
        });
        
        // Construir consulta dinámica
        let query = `
            SELECT 
                id,
                id_presupuesto_ext as sheet_id,
                hoja_nombre as sheet_name,
                tipo_comprobante as categoria,
                nota as concepto,
                descuento as monto,
                fecha as fecha_registro,
                fecha_actualizacion as fecha_sincronizacion,
                activo
            FROM presupuestos 
            WHERE activo = true
        `;
        
        const params = [];
        let paramCount = 0;
        
        // Aplicar filtros dinámicos
        if (categoria) {
            paramCount++;
            query += ` AND LOWER(categoria) LIKE LOWER($${paramCount})`;
            params.push(`%${categoria}%`);
        }
        
        if (concepto) {
            paramCount++;
            query += ` AND LOWER(concepto) LIKE LOWER($${paramCount})`;
            params.push(`%${concepto}%`);
        }
        
        if (fecha_desde) {
            paramCount++;
            query += ` AND fecha_registro >= $${paramCount}`;
            params.push(fecha_desde);
        }
        
        if (fecha_hasta) {
            paramCount++;
            query += ` AND fecha_registro <= $${paramCount}`;
            params.push(fecha_hasta);
        }
        
        if (monto_min) {
            paramCount++;
            query += ` AND monto >= $${paramCount}`;
            params.push(parseFloat(monto_min));
        }
        
        if (monto_max) {
            paramCount++;
            query += ` AND monto <= $${paramCount}`;
            params.push(parseFloat(monto_max));
        }
        
        if (sheet_id) {
            paramCount++;
            query += ` AND sheet_id = $${paramCount}`;
            params.push(sheet_id);
        }
        
        // Ordenamiento
        const validOrderFields = ['fecha_registro', 'fecha_sincronizacion', 'categoria', 'concepto', 'monto'];
        const orderField = validOrderFields.includes(order_by) ? order_by : 'fecha_sincronizacion';
        const orderDirection = order_dir.toUpperCase() === 'ASC' ? 'ASC' : 'DESC';
        
        query += ` ORDER BY ${orderField} ${orderDirection}, categoria, concepto`;
        
        // Paginación
        if (limit) {
            paramCount++;
            query += ` LIMIT $${paramCount}`;
            params.push(parseInt(limit));
        }
        
        if (offset) {
            paramCount++;
            query += ` OFFSET $${paramCount}`;
            params.push(parseInt(offset));
        }
        
        console.log('📋 [PRESUPUESTOS] Consulta SQL:', query);
        console.log('📋 [PRESUPUESTOS] Parámetros:', params);
        
        const result = await req.db.query(query, params);
        
        // Consulta para total de registros (sin paginación)
        let countQuery = `
            SELECT COUNT(*) as total
            FROM presupuestos 
            WHERE activo = true
        `;
        
        // Aplicar mismos filtros para el conteo
        let countParams = [];
        let countParamCount = 0;
        
        if (categoria) {
            countParamCount++;
            countQuery += ` AND LOWER(categoria) LIKE LOWER($${countParamCount})`;
            countParams.push(`%${categoria}%`);
        }
        
        if (concepto) {
            countParamCount++;
            countQuery += ` AND LOWER(concepto) LIKE LOWER($${countParamCount})`;
            countParams.push(`%${concepto}%`);
        }
        
        if (fecha_desde) {
            countParamCount++;
            countQuery += ` AND fecha_registro >= $${countParamCount}`;
            countParams.push(fecha_desde);
        }
        
        if (fecha_hasta) {
            countParamCount++;
            countQuery += ` AND fecha_registro <= $${countParamCount}`;
            countParams.push(fecha_hasta);
        }
        
        if (monto_min) {
            countParamCount++;
            countQuery += ` AND monto >= $${countParamCount}`;
            countParams.push(parseFloat(monto_min));
        }
        
        if (monto_max) {
            countParamCount++;
            countQuery += ` AND monto <= $${countParamCount}`;
            countParams.push(parseFloat(monto_max));
        }
        
        if (sheet_id) {
            countParamCount++;
            countQuery += ` AND sheet_id = $${countParamCount}`;
            countParams.push(sheet_id);
        }
        
        const countResult = await req.db.query(countQuery, countParams);
        const totalRecords = parseInt(countResult.rows[0].total);
        
        console.log(`✅ [PRESUPUESTOS] Presupuestos obtenidos: ${result.rows.length} de ${totalRecords} registros`);
        
        // Log de categorías encontradas para debugging
        const categorias = [...new Set(result.rows.map(row => row.categoria))];
        console.log('📊 [PRESUPUESTOS] Categorías encontradas:', categorias);
        
        res.json({
            success: true,
            data: result.rows,
            pagination: {
                total: totalRecords,
                limit: parseInt(limit),
                offset: parseInt(offset),
                pages: Math.ceil(totalRecords / parseInt(limit))
            },
            filters: {
                categoria, concepto, fecha_desde, fecha_hasta,
                monto_min, monto_max, sheet_id
            },
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
                COUNT(DISTINCT tipo_comprobante) as total_categorias,
                SUM(descuento) as monto_total,
                AVG(descuento) as monto_promedio,
                MIN(descuento) as monto_minimo,
                MAX(descuento) as monto_maximo,
                MAX(fecha) as ultima_sincronizacion
            FROM presupuestos 
            WHERE activo = true
        `;
        
        const result = await req.db.query(query);
        const stats = result.rows[0];
        
        // Obtener distribución por categorías
        const categoriasQuery = `
            SELECT 
                tipo_comprobante as categoria,
                COUNT(*) as cantidad,
                SUM(descuento) as monto_categoria,
                AVG(descuento) as promedio_categoria
            FROM presupuestos 
            WHERE activo = true 
            GROUP BY tipo_comprobante 
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

/**
 * Obtener presupuesto por ID
 */
const obtenerPresupuestoPorId = async (req, res) => {
    try {
        const { id } = req.params;
        
        console.log(`🔍 [PRESUPUESTOS] Obteniendo presupuesto por ID: ${id}`);
        
        if (!id || isNaN(parseInt(id))) {
            console.log('❌ [PRESUPUESTOS] ID inválido proporcionado:', id);
            return res.status(400).json({
                success: false,
                error: 'ID de presupuesto inválido',
                timestamp: new Date().toISOString()
            });
        }
        
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
            WHERE id = $1 AND activo = true
        `;
        
        const result = await req.db.query(query, [parseInt(id)]);
        
        if (result.rows.length === 0) {
            console.log(`⚠️ [PRESUPUESTOS] Presupuesto no encontrado: ID ${id}`);
            return res.status(404).json({
                success: false,
                error: 'Presupuesto no encontrado',
                timestamp: new Date().toISOString()
            });
        }
        
        const presupuesto = result.rows[0];
        console.log(`✅ [PRESUPUESTOS] Presupuesto encontrado: ${presupuesto.concepto}`);
        
        res.json({
            success: true,
            data: presupuesto,
            timestamp: new Date().toISOString()
        });
        
    } catch (error) {
        console.error('❌ [PRESUPUESTOS] Error al obtener presupuesto por ID:', error);
        res.status(500).json({
            success: false,
            error: 'Error al obtener presupuesto',
            message: error.message,
            timestamp: new Date().toISOString()
        });
    }
};

/**
 * Crear nuevo presupuesto manualmente
 */
const crearPresupuesto = async (req, res) => {
    try {
        const { sheet_id, sheet_name, categoria, concepto, monto } = req.body;
        const usuario_id = req.user?.id || 1; // TODO: Obtener de sesión real
        
        console.log('🔍 [PRESUPUESTOS] Creando nuevo presupuesto:', { categoria, concepto, monto });
        
        // Validaciones
        if (!concepto || concepto.trim() === '') {
            console.log('❌ [PRESUPUESTOS] Concepto requerido');
            return res.status(400).json({
                success: false,
                error: 'El concepto es requerido',
                timestamp: new Date().toISOString()
            });
        }
        
        if (monto === undefined || monto === null || isNaN(parseFloat(monto))) {
            console.log('❌ [PRESUPUESTOS] Monto inválido:', monto);
            return res.status(400).json({
                success: false,
                error: 'El monto debe ser un número válido',
                timestamp: new Date().toISOString()
            });
        }
        
        // Verificar duplicados
        const duplicateQuery = `
            SELECT id FROM presupuestos_datos 
            WHERE LOWER(concepto) = LOWER($1) 
            AND LOWER(categoria) = LOWER($2) 
            AND sheet_id = $3 
            AND activo = true
        `;
        
        const duplicateResult = await req.db.query(duplicateQuery, [
            concepto.trim(),
            (categoria || 'Sin categoría').trim(),
            sheet_id || 'manual'
        ]);
        
        if (duplicateResult.rows.length > 0) {
            console.log('⚠️ [PRESUPUESTOS] Presupuesto duplicado detectado');
            return res.status(409).json({
                success: false,
                error: 'Ya existe un presupuesto con el mismo concepto y categoría',
                timestamp: new Date().toISOString()
            });
        }
        
        // Insertar nuevo presupuesto
        const insertQuery = `
            INSERT INTO presupuestos_datos 
            (sheet_id, sheet_name, categoria, concepto, monto, fecha_registro, fecha_sincronizacion, activo)
            VALUES ($1, $2, $3, $4, $5, NOW(), NOW(), true)
            RETURNING *
        `;
        
        const insertResult = await req.db.query(insertQuery, [
            sheet_id || 'manual',
            sheet_name || 'Ingreso Manual',
            (categoria || 'Sin categoría').trim(),
            concepto.trim(),
            parseFloat(monto)
        ]);
        
        const nuevoPresupuesto = insertResult.rows[0];
        
        console.log(`✅ [PRESUPUESTOS] Presupuesto creado con ID: ${nuevoPresupuesto.id}`);
        console.log(`📋 [PRESUPUESTOS] Detalles: ${nuevoPresupuesto.concepto} - $${nuevoPresupuesto.monto}`);
        
        res.status(201).json({
            success: true,
            data: nuevoPresupuesto,
            message: 'Presupuesto creado exitosamente',
            timestamp: new Date().toISOString()
        });
        
    } catch (error) {
        console.error('❌ [PRESUPUESTOS] Error al crear presupuesto:', error);
        res.status(500).json({
            success: false,
            error: 'Error al crear presupuesto',
            message: error.message,
            timestamp: new Date().toISOString()
        });
    }
};

/**
 * Actualizar presupuesto existente
 */
const actualizarPresupuesto = async (req, res) => {
    try {
        const { id } = req.params;
        const { categoria, concepto, monto } = req.body;
        
        console.log(`🔍 [PRESUPUESTOS] Actualizando presupuesto ID: ${id}`);
        console.log('📋 [PRESUPUESTOS] Nuevos datos:', { categoria, concepto, monto });
        
        if (!id || isNaN(parseInt(id))) {
            console.log('❌ [PRESUPUESTOS] ID inválido:', id);
            return res.status(400).json({
                success: false,
                error: 'ID de presupuesto inválido',
                timestamp: new Date().toISOString()
            });
        }
        
        // Verificar que el presupuesto existe
        const existsQuery = `
            SELECT id, concepto FROM presupuestos_datos 
            WHERE id = $1 AND activo = true
        `;
        
        const existsResult = await req.db.query(existsQuery, [parseInt(id)]);
        
        if (existsResult.rows.length === 0) {
            console.log(`⚠️ [PRESUPUESTOS] Presupuesto no encontrado para actualizar: ID ${id}`);
            return res.status(404).json({
                success: false,
                error: 'Presupuesto no encontrado',
                timestamp: new Date().toISOString()
            });
        }
        
        // Construir consulta de actualización dinámica
        const updates = [];
        const params = [];
        let paramCount = 0;
        
        if (categoria !== undefined) {
            paramCount++;
            updates.push(`categoria = $${paramCount}`);
            params.push((categoria || 'Sin categoría').trim());
        }
        
        if (concepto !== undefined && concepto.trim() !== '') {
            paramCount++;
            updates.push(`concepto = $${paramCount}`);
            params.push(concepto.trim());
        }
        
        if (monto !== undefined && !isNaN(parseFloat(monto))) {
            paramCount++;
            updates.push(`monto = $${paramCount}`);
            params.push(parseFloat(monto));
        }
        
        if (updates.length === 0) {
            console.log('⚠️ [PRESUPUESTOS] No hay campos válidos para actualizar');
            return res.status(400).json({
                success: false,
                error: 'No se proporcionaron campos válidos para actualizar',
                timestamp: new Date().toISOString()
            });
        }
        
        // Agregar fecha de sincronización
        paramCount++;
        updates.push(`fecha_sincronizacion = NOW()`);
        
        // Agregar ID para WHERE
        paramCount++;
        params.push(parseInt(id));
        
        const updateQuery = `
            UPDATE presupuestos_datos 
            SET ${updates.join(', ')}
            WHERE id = $${paramCount} AND activo = true
            RETURNING *
        `;
        
        console.log('📋 [PRESUPUESTOS] Query de actualización:', updateQuery);
        console.log('📋 [PRESUPUESTOS] Parámetros:', params);
        
        const updateResult = await req.db.query(updateQuery, params);
        const presupuestoActualizado = updateResult.rows[0];
        
        console.log(`✅ [PRESUPUESTOS] Presupuesto actualizado: ${presupuestoActualizado.concepto}`);
        
        res.json({
            success: true,
            data: presupuestoActualizado,
            message: 'Presupuesto actualizado exitosamente',
            timestamp: new Date().toISOString()
        });
        
    } catch (error) {
        console.error('❌ [PRESUPUESTOS] Error al actualizar presupuesto:', error);
        res.status(500).json({
            success: false,
            error: 'Error al actualizar presupuesto',
            message: error.message,
            timestamp: new Date().toISOString()
        });
    }
};

/**
 * Eliminar presupuesto (soft delete)
 */
const eliminarPresupuesto = async (req, res) => {
    try {
        const { id } = req.params;
        
        console.log(`🔍 [PRESUPUESTOS] Eliminando presupuesto ID: ${id}`);
        
        if (!id || isNaN(parseInt(id))) {
            console.log('❌ [PRESUPUESTOS] ID inválido:', id);
            return res.status(400).json({
                success: false,
                error: 'ID de presupuesto inválido',
                timestamp: new Date().toISOString()
            });
        }
        
        // Verificar que el presupuesto existe
        const existsQuery = `
            SELECT id, concepto FROM presupuestos_datos 
            WHERE id = $1 AND activo = true
        `;
        
        const existsResult = await req.db.query(existsQuery, [parseInt(id)]);
        
        if (existsResult.rows.length === 0) {
            console.log(`⚠️ [PRESUPUESTOS] Presupuesto no encontrado para eliminar: ID ${id}`);
            return res.status(404).json({
                success: false,
                error: 'Presupuesto no encontrado',
                timestamp: new Date().toISOString()
            });
        }
        
        const presupuesto = existsResult.rows[0];
        
        // Soft delete
        const deleteQuery = `
            UPDATE presupuestos_datos 
            SET activo = false, fecha_sincronizacion = NOW()
            WHERE id = $1
            RETURNING id, concepto
        `;
        
        const deleteResult = await req.db.query(deleteQuery, [parseInt(id)]);
        const presupuestoEliminado = deleteResult.rows[0];
        
        console.log(`✅ [PRESUPUESTOS] Presupuesto eliminado (soft delete): ${presupuestoEliminado.concepto}`);
        
        res.json({
            success: true,
            data: {
                id: presupuestoEliminado.id,
                concepto: presupuestoEliminado.concepto,
                eliminado: true
            },
            message: 'Presupuesto eliminado exitosamente',
            timestamp: new Date().toISOString()
        });
        
    } catch (error) {
        console.error('❌ [PRESUPUESTOS] Error al eliminar presupuesto:', error);
        res.status(500).json({
            success: false,
            error: 'Error al eliminar presupuesto',
            message: error.message,
            timestamp: new Date().toISOString()
        });
    }
};

/**
 * Obtener resumen por categoría o fecha
 */
const obtenerResumen = async (req, res) => {
    try {
        const { 
            tipo = 'categoria', 
            fecha_desde, 
            fecha_hasta,
            categoria 
        } = req.query;
        
        console.log(`🔍 [PRESUPUESTOS] Generando resumen por: ${tipo}`);
        console.log('📋 [PRESUPUESTOS] Filtros:', { fecha_desde, fecha_hasta, categoria });
        
        let query = '';
        let params = [];
        let paramCount = 0;
        
        if (tipo === 'categoria') {
            query = `
                SELECT 
                    categoria,
                    COUNT(*) as total_registros,
                    SUM(monto) as monto_total,
                    AVG(monto) as monto_promedio,
                    MIN(monto) as monto_minimo,
                    MAX(monto) as monto_maximo,
                    MIN(fecha_registro) as fecha_primer_registro,
                    MAX(fecha_sincronizacion) as ultima_actualizacion
                FROM presupuestos_datos 
                WHERE activo = true
            `;
            
            // Filtros adicionales
            if (fecha_desde) {
                paramCount++;
                query += ` AND fecha_registro >= $${paramCount}`;
                params.push(fecha_desde);
            }
            
            if (fecha_hasta) {
                paramCount++;
                query += ` AND fecha_registro <= $${paramCount}`;
                params.push(fecha_hasta);
            }
            
            if (categoria) {
                paramCount++;
                query += ` AND LOWER(categoria) LIKE LOWER($${paramCount})`;
                params.push(`%${categoria}%`);
            }
            
            query += `
                GROUP BY categoria
                ORDER BY monto_total DESC
            `;
            
        } else if (tipo === 'fecha') {
            query = `
                SELECT 
                    DATE(fecha_registro) as fecha,
                    COUNT(*) as total_registros,
                    SUM(monto) as monto_total,
                    AVG(monto) as monto_promedio,
                    COUNT(DISTINCT categoria) as categorias_distintas
                FROM presupuestos_datos 
                WHERE activo = true
            `;
            
            // Filtros adicionales
            if (fecha_desde) {
                paramCount++;
                query += ` AND fecha_registro >= $${paramCount}`;
                params.push(fecha_desde);
            }
            
            if (fecha_hasta) {
                paramCount++;
                query += ` AND fecha_registro <= $${paramCount}`;
                params.push(fecha_hasta);
            }
            
            if (categoria) {
                paramCount++;
                query += ` AND LOWER(categoria) LIKE LOWER($${paramCount})`;
                params.push(`%${categoria}%`);
            }
            
            query += `
                GROUP BY DATE(fecha_registro)
                ORDER BY fecha DESC
            `;
            
        } else {
            console.log('❌ [PRESUPUESTOS] Tipo de resumen inválido:', tipo);
            return res.status(400).json({
                success: false,
                error: 'Tipo de resumen inválido. Use "categoria" o "fecha"',
                timestamp: new Date().toISOString()
            });
        }
        
        console.log('📋 [PRESUPUESTOS] Query de resumen:', query);
        console.log('📋 [PRESUPUESTOS] Parámetros:', params);
        
        const result = await req.db.query(query, params);
        
        // Calcular totales generales
        const totalesQuery = `
            SELECT 
                COUNT(*) as total_registros,
                SUM(monto) as monto_total,
                AVG(monto) as monto_promedio,
                COUNT(DISTINCT categoria) as total_categorias
            FROM presupuestos_datos 
            WHERE activo = true
            ${fecha_desde ? `AND fecha_registro >= '${fecha_desde}'` : ''}
            ${fecha_hasta ? `AND fecha_registro <= '${fecha_hasta}'` : ''}
            ${categoria ? `AND LOWER(categoria) LIKE LOWER('%${categoria}%')` : ''}
        `;
        
        const totalesResult = await req.db.query(totalesQuery);
        const totales = totalesResult.rows[0];
        
        console.log(`✅ [PRESUPUESTOS] Resumen generado: ${result.rows.length} grupos`);
        console.log(`📊 [PRESUPUESTOS] Totales: ${totales.total_registros} registros, $${parseFloat(totales.monto_total || 0).toFixed(2)}`);
        
        res.json({
            success: true,
            tipo: tipo,
            data: result.rows,
            totales: {
                total_registros: parseInt(totales.total_registros),
                monto_total: parseFloat(totales.monto_total || 0),
                monto_promedio: parseFloat(totales.monto_promedio || 0),
                total_categorias: parseInt(totales.total_categorias)
            },
            filtros: {
                fecha_desde,
                fecha_hasta,
                categoria
            },
            timestamp: new Date().toISOString()
        });
        
    } catch (error) {
        console.error('❌ [PRESUPUESTOS] Error al generar resumen:', error);
        res.status(500).json({
            success: false,
            error: 'Error al generar resumen',
            message: error.message,
            timestamp: new Date().toISOString()
        });
    }
};

/**
 * Actualizar estado de presupuesto
 */
const actualizarEstadoPresupuesto = async (req, res) => {
    try {
        const { id } = req.params;
        const { estado } = req.body;
        
        console.log(`🔍 [PRESUPUESTOS] Actualizando estado de presupuesto ID: ${id} a: ${estado}`);
        
        if (!id || isNaN(parseInt(id))) {
            console.log('❌ [PRESUPUESTOS] ID inválido:', id);
            return res.status(400).json({
                success: false,
                error: 'ID de presupuesto inválido',
                timestamp: new Date().toISOString()
            });
        }
        
        if (!estado || estado.trim() === '') {
            console.log('❌ [PRESUPUESTOS] Estado requerido');
            return res.status(400).json({
                success: false,
                error: 'El estado es requerido',
                timestamp: new Date().toISOString()
            });
        }
        
        // Verificar que el presupuesto existe
        const existsQuery = `
            SELECT id, estado FROM presupuestos 
            WHERE id = $1 AND activo = true
        `;
        
        const existsResult = await req.db.query(existsQuery, [parseInt(id)]);
        
        if (existsResult.rows.length === 0) {
            console.log(`⚠️ [PRESUPUESTOS] Presupuesto no encontrado para actualizar estado: ID ${id}`);
            return res.status(404).json({
                success: false,
                error: 'Presupuesto no encontrado',
                timestamp: new Date().toISOString()
            });
        }
        
        // Actualizar estado
        const updateQuery = `
            UPDATE presupuestos 
            SET estado = $1, fecha_actualizacion = NOW()
            WHERE id = $2 AND activo = true
            RETURNING *
        `;
        
        const updateResult = await req.db.query(updateQuery, [estado.trim(), parseInt(id)]);
        const presupuestoActualizado = updateResult.rows[0];
        
        console.log(`✅ [PRESUPUESTOS] Estado actualizado: ${presupuestoActualizado.estado}`);
        
        res.json({
            success: true,
            data: presupuestoActualizado,
            message: 'Estado de presupuesto actualizado exitosamente',
            timestamp: new Date().toISOString()
        });
        
    } catch (error) {
        console.error('❌ [PRESUPUESTOS] Error al actualizar estado:', error);
        res.status(500).json({
            success: false,
            error: 'Error al actualizar estado de presupuesto',
            message: error.message,
            timestamp: new Date().toISOString()
        });
    }
};

console.log('✅ [PRESUPUESTOS] Controlador de presupuestos configurado con CRUD completo');

module.exports = {
    obtenerPresupuestos,
    obtenerPresupuestoPorId,
    crearPresupuesto,
    actualizarPresupuesto,
    actualizarEstadoPresupuesto,
    eliminarPresupuesto,
    obtenerPresupuestosPorCategoria,
    obtenerEstadisticas,
    obtenerConfiguracion,
    obtenerResumen
};
