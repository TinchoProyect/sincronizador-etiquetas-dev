console.log('[PRESUPUESTOS-BACK] Cargando controlador de presupuestos CON LOGS DE DEPURACIÓN...');

/**
 * Controlador principal para la gestión de presupuestos CON LOGS DETALLADOS
 * Maneja la lógica de negocio del módulo con la estructura real de BD
 */

/**
 * Obtener todos los presupuestos con filtros avanzados CON LOGS
 */
const obtenerPresupuestos = async (req, res) => {
    try {
        console.log('[PRESUPUESTOS-BACK] 🔍 INICIANDO OBTENCIÓN DE PRESUPUESTOS...');
        console.log('[PRESUPUESTOS-BACK] Esta es la función que llama el frontend con "Cargar Presupuestos"');
        
        // Extraer parámetros de filtrado
        const {
            id_cliente,
            estado,
            agente,
            fecha_desde,
            fecha_hasta,
            fecha_entrega_desde,
            fecha_entrega_hasta,
            hoja_nombre,
            limit = 100,
            offset = 0,
            order_by = 'fecha',
            order_dir = 'DESC'
        } = req.query;
        
        console.log('[PRESUPUESTOS-BACK] Filtros aplicados:', {
            id_cliente, estado, agente, fecha_desde, fecha_hasta,
            fecha_entrega_desde, fecha_entrega_hasta, hoja_nombre, limit, offset
        });
        
        // VERIFICAR PRIMERO SI HAY DATOS EN LA BASE DE DATOS
        console.log('[PRESUPUESTOS-BACK] 🔍 VERIFICANDO SI HAY DATOS EN LA BASE DE DATOS...');
        
        const checkQuery = `SELECT COUNT(*) as total FROM presupuestos WHERE activo = true`;
        const checkResult = await req.db.query(checkQuery);
        const totalEnBD = parseInt(checkResult.rows[0].total);
        
        console.log(`[PRESUPUESTOS-BACK] 📊 TOTAL DE PRESUPUESTOS EN BD: ${totalEnBD}`);
        
        if (totalEnBD === 0) {
            console.log('[PRESUPUESTOS-BACK] ⚠️ NO HAY DATOS EN LA BASE DE DATOS');
            console.log('[PRESUPUESTOS-BACK] Esto significa que:');
            console.log('[PRESUPUESTOS-BACK] 1. La sincronización con Google Sheets nunca se ejecutó');
            console.log('[PRESUPUESTOS-BACK] 2. O la sincronización falló');
            console.log('[PRESUPUESTOS-BACK] 3. O los datos no se guardaron correctamente');
            
            // Verificar si hay configuración de Google Sheets
            const configQuery = `SELECT * FROM presupuestos_config WHERE activo = true LIMIT 1`;
            const configResult = await req.db.query(configQuery);
            
            if (configResult.rows.length === 0) {
                console.log('[PRESUPUESTOS-BACK] ❌ NO HAY CONFIGURACIÓN DE GOOGLE SHEETS');
                console.log('[PRESUPUESTOS-BACK] El usuario debe configurar primero la hoja de Google Sheets');
            } else {
                const config = configResult.rows[0];
                console.log('[PRESUPUESTOS-BACK] ✅ Configuración encontrada:', {
                    hoja_id: config.hoja_id,
                    hoja_url: config.hoja_url,
                    hoja_nombre: config.hoja_nombre,
                    fecha_creacion: config.fecha_creacion
                });
                console.log('[PRESUPUESTOS-BACK] ¿Es el archivo correcto?', config.hoja_id === '1r7VEnEArREqAGZiDxQCW4A0XIKb8qaxHXD0TlVhfuf8');
            }
            
            // Verificar logs de sincronización
            const syncLogQuery = `SELECT * FROM presupuestos_sync_log ORDER BY fecha_sync DESC LIMIT 5`;
            const syncLogResult = await req.db.query(syncLogQuery);
            
            console.log(`[PRESUPUESTOS-BACK] 📋 Últimos ${syncLogResult.rows.length} intentos de sincronización:`);
            syncLogResult.rows.forEach((log, index) => {
                console.log(`[PRESUPUESTOS-BACK] ${index + 1}. ${log.fecha_sync} - Exitoso: ${log.exitoso} - Procesados: ${log.registros_procesados} - Errores: ${log.errores || 'Ninguno'}`);
            });
            
            return res.json({
                success: true,
                data: [],
                total: 0,
                pagination: {
                    total: 0,
                    limit: parseInt(limit),
                    offset: parseInt(offset),
                    pages: 0
                },
                message: 'No hay presupuestos en la base de datos. Ejecute la sincronización con Google Sheets.',
                debug: {
                    total_en_bd: totalEnBD,
                    configuracion_existe: configResult.rows.length > 0,
                    ultimo_sync: syncLogResult.rows[0] || null
                },
                timestamp: new Date().toISOString()
            });
        }
        
        console.log('[PRESUPUESTOS-BACK] ✅ HAY DATOS EN LA BASE DE DATOS, PROCEDIENDO CON LA CONSULTA...');
        
        // Construir consulta dinámica
        let query = `
            SELECT 
                p.id,
                p.id_presupuesto_ext,
                p.id_cliente,
                p.fecha,
                p.fecha_entrega,
                p.agente,
                p.tipo_comprobante,
                p.nota,
                p.estado,
                p.informe_generado,
                p.cliente_nuevo_id,
                p.punto_entrega,
                p.descuento,
                p.hoja_nombre,
                p.hoja_url,
                COUNT(pd.id) as total_articulos,
                SUM(pd.cantidad) as cantidad_total,
                SUM(pd.precio1 * pd.cantidad) as valor_total_estimado
            FROM presupuestos p
            LEFT JOIN presupuestos_detalles pd ON p.id = pd.id_presupuesto
            WHERE p.activo = true
        `;
        
        const params = [];
        let paramCount = 0;
        
        // Aplicar filtros dinámicos
        if (id_cliente) {
            paramCount++;
            query += ` AND LOWER(p.id_cliente) LIKE LOWER($${paramCount})`;
            params.push(`%${id_cliente}%`);
        }
        
        if (estado) {
            paramCount++;
            query += ` AND LOWER(p.estado) = LOWER($${paramCount})`;
            params.push(estado);
        }
        
        if (agente) {
            paramCount++;
            query += ` AND LOWER(p.agente) LIKE LOWER($${paramCount})`;
            params.push(`%${agente}%`);
        }
        
        if (fecha_desde) {
            paramCount++;
            query += ` AND p.fecha >= $${paramCount}`;
            params.push(fecha_desde);
        }
        
        if (fecha_hasta) {
            paramCount++;
            query += ` AND p.fecha <= $${paramCount}`;
            params.push(fecha_hasta);
        }
        
        if (fecha_entrega_desde) {
            paramCount++;
            query += ` AND p.fecha_entrega >= $${paramCount}`;
            params.push(fecha_entrega_desde);
        }
        
        if (fecha_entrega_hasta) {
            paramCount++;
            query += ` AND p.fecha_entrega <= $${paramCount}`;
            params.push(fecha_entrega_hasta);
        }
        
        if (hoja_nombre) {
            paramCount++;
            query += ` AND LOWER(p.hoja_nombre) LIKE LOWER($${paramCount})`;
            params.push(`%${hoja_nombre}%`);
        }
        
        // Agrupar por presupuesto
        query += ` GROUP BY p.id, p.id_presupuesto_ext, p.id_cliente, p.fecha, p.fecha_entrega, 
                   p.agente, p.tipo_comprobante, p.nota, p.estado, p.informe_generado,
                   p.cliente_nuevo_id, p.punto_entrega, p.descuento, p.hoja_nombre, p.hoja_url`;
        
        // Ordenamiento
        const validOrderFields = ['fecha', 'fecha_entrega', 'id_cliente', 'estado', 'agente', 'descuento'];
        const orderField = validOrderFields.includes(order_by) ? order_by : 'fecha';
        const orderDirection = order_dir.toUpperCase() === 'ASC' ? 'ASC' : 'DESC';
        
        query += ` ORDER BY p.${orderField} ${orderDirection}, p.id_presupuesto_ext`;
        
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
        
        console.log('[PRESUPUESTOS-BACK] Consulta SQL:', query);
        console.log('[PRESUPUESTOS-BACK] Parámetros:', params);
        
        const result = await req.db.query(query, params);
        
        // Consulta para total de registros (sin paginación)
        let countQuery = `
            SELECT COUNT(DISTINCT p.id) as total
            FROM presupuestos p
            WHERE p.activo = true
        `;
        
        // Aplicar mismos filtros para el conteo
        let countParams = [];
        let countParamCount = 0;
        
        if (id_cliente) {
            countParamCount++;
            countQuery += ` AND LOWER(p.id_cliente) LIKE LOWER($${countParamCount})`;
            countParams.push(`%${id_cliente}%`);
        }
        
        if (estado) {
            countParamCount++;
            countQuery += ` AND LOWER(p.estado) = LOWER($${countParamCount})`;
            countParams.push(estado);
        }
        
        if (agente) {
            countParamCount++;
            countQuery += ` AND LOWER(p.agente) LIKE LOWER($${countParamCount})`;
            countParams.push(`%${agente}%`);
        }
        
        if (fecha_desde) {
            countParamCount++;
            countQuery += ` AND p.fecha >= $${countParamCount}`;
            countParams.push(fecha_desde);
        }
        
        if (fecha_hasta) {
            countParamCount++;
            countQuery += ` AND p.fecha <= $${countParamCount}`;
            countParams.push(fecha_hasta);
        }
        
        if (fecha_entrega_desde) {
            countParamCount++;
            countQuery += ` AND p.fecha_entrega >= $${countParamCount}`;
            countParams.push(fecha_entrega_desde);
        }
        
        if (fecha_entrega_hasta) {
            countParamCount++;
            countQuery += ` AND p.fecha_entrega <= $${countParamCount}`;
            countParams.push(fecha_entrega_hasta);
        }
        
        if (hoja_nombre) {
            countParamCount++;
            countQuery += ` AND LOWER(p.hoja_nombre) LIKE LOWER($${countParamCount})`;
            countParams.push(`%${hoja_nombre}%`);
        }
        
        const countResult = await req.db.query(countQuery, countParams);
        const totalRecords = parseInt(countResult.rows[0].total);
        
        console.log(`[PRESUPUESTOS-BACK] ✅ PRESUPUESTOS OBTENIDOS: ${result.rows.length} de ${totalRecords} registros`);
        
        // Log de estados encontrados para debugging
        const estados = [...new Set(result.rows.map(row => row.estado))];
        console.log('[PRESUPUESTOS-BACK] Estados encontrados:', estados);
        
        // Extraer categorías únicas (usando agente como categoría por ahora)
        const categorias = [...new Set(result.rows.map(row => row.agente).filter(agente => agente))];
        console.log('[PRESUPUESTOS-BACK] Categorías encontradas:', categorias);
        
        // Log de algunos registros de ejemplo
        if (result.rows.length > 0) {
            console.log('[PRESUPUESTOS-BACK] Primeros 3 presupuestos encontrados:');
            result.rows.slice(0, 3).forEach((row, index) => {
                console.log(`[PRESUPUESTOS-BACK] ${index + 1}. ID: ${row.id_presupuesto_ext}, Cliente: ${row.id_cliente}, Estado: ${row.estado}, Artículos: ${row.total_articulos}`);
            });
        }
        
        res.json({
            success: true,
            data: result.rows,
            total: totalRecords,
            pagination: {
                total: totalRecords,
                limit: parseInt(limit),
                offset: parseInt(offset),
                pages: Math.ceil(totalRecords / parseInt(limit))
            },
            filters: {
                id_cliente, estado, agente, fecha_desde, fecha_hasta,
                fecha_entrega_desde, fecha_entrega_hasta, hoja_nombre
            },
            estados: estados,
            categorias: categorias,
            timestamp: new Date().toISOString()
        });
        
    } catch (error) {
        console.error('[PRESUPUESTOS-BACK] ❌ ERROR AL OBTENER PRESUPUESTOS:', error);
        console.log('[PRESUPUESTOS-BACK] Stack trace:', error.stack);
        res.status(500).json({
            success: false,
            error: 'Error al obtener presupuestos',
            message: error.message,
            timestamp: new Date().toISOString()
        });
    }
};

/**
 * Obtener presupuesto por ID con sus detalles
 */
const obtenerPresupuestoPorId = async (req, res) => {
    try {
        const { id } = req.params;
        
        console.log(`[PRESUPUESTOS-BACK] Obteniendo presupuesto por ID: ${id}`);
        
        if (!id || isNaN(parseInt(id))) {
            console.log('[PRESUPUESTOS-BACK] ❌ ID inválido proporcionado:', id);
            return res.status(400).json({
                success: false,
                error: 'ID de presupuesto inválido',
                timestamp: new Date().toISOString()
            });
        }
        
        // Obtener datos del presupuesto
        const presupuestoQuery = `
            SELECT 
                id,
                id_presupuesto_ext,
                id_cliente,
                fecha,
                fecha_entrega,
                agente,
                tipo_comprobante,
                nota,
                estado,
                informe_generado,
                cliente_nuevo_id,
                punto_entrega,
                descuento,
                hoja_nombre,
                hoja_url,
                usuario_id
            FROM presupuestos 
            WHERE id = $1 AND activo = true
        `;
        
        const presupuestoResult = await req.db.query(presupuestoQuery, [parseInt(id)]);
        
        if (presupuestoResult.rows.length === 0) {
            console.log(`[PRESUPUESTOS-BACK] ⚠️ Presupuesto no encontrado: ID ${id}`);
            return res.status(404).json({
                success: false,
                error: 'Presupuesto no encontrado',
                timestamp: new Date().toISOString()
            });
        }
        
        const presupuesto = presupuestoResult.rows[0];
        
        // Obtener detalles del presupuesto
        const detallesQuery = `
            SELECT 
                id,
                articulo,
                cantidad,
                valor1,
                precio1,
                iva1,
                diferencia,
                camp1,
                camp2,
                camp3,
                camp4,
                camp5,
                camp6
            FROM presupuestos_detalles 
            WHERE id_presupuesto = $1
            ORDER BY id
        `;
        
        const detallesResult = await req.db.query(detallesQuery, [parseInt(id)]);
        
        console.log(`[PRESUPUESTOS-BACK] ✅ Presupuesto encontrado: ${presupuesto.id_presupuesto_ext} con ${detallesResult.rows.length} detalles`);
        
        res.json({
            success: true,
            data: {
                presupuesto: presupuesto,
                detalles: detallesResult.rows,
                total_articulos: detallesResult.rows.length,
                valor_total: detallesResult.rows.reduce((sum, det) => sum + (det.precio1 * det.cantidad), 0)
            },
            timestamp: new Date().toISOString()
        });
        
    } catch (error) {
        console.error('[PRESUPUESTOS-BACK] ❌ Error al obtener presupuesto por ID:', error);
        res.status(500).json({
            success: false,
            error: 'Error al obtener presupuesto',
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
        const { estado, nota } = req.body;
        
        console.log(`[PRESUPUESTOS-BACK] Actualizando estado de presupuesto ID: ${id}`);
        console.log('[PRESUPUESTOS-BACK] Nuevo estado:', estado);
        
        if (!id || isNaN(parseInt(id))) {
            console.log('[PRESUPUESTOS-BACK] ❌ ID inválido:', id);
            return res.status(400).json({
                success: false,
                error: 'ID de presupuesto inválido',
                timestamp: new Date().toISOString()
            });
        }
        
        if (!estado) {
            console.log('[PRESUPUESTOS-BACK] ❌ Estado requerido');
            return res.status(400).json({
                success: false,
                error: 'El estado es requerido',
                timestamp: new Date().toISOString()
            });
        }
        
        // Verificar que el presupuesto existe
        const existsQuery = `
            SELECT id, id_presupuesto_ext, estado FROM presupuestos 
            WHERE id = $1 AND activo = true
        `;
        
        const existsResult = await req.db.query(existsQuery, [parseInt(id)]);
        
        if (existsResult.rows.length === 0) {
            console.log(`[PRESUPUESTOS-BACK] ⚠️ Presupuesto no encontrado para actualizar: ID ${id}`);
            return res.status(404).json({
                success: false,
                error: 'Presupuesto no encontrado',
                timestamp: new Date().toISOString()
            });
        }
        
        const presupuestoAnterior = existsResult.rows[0];
        
        // Actualizar estado
        const updateQuery = `
            UPDATE presupuestos 
            SET estado = $1, nota = COALESCE($2, nota)
            WHERE id = $3 AND activo = true
            RETURNING *
        `;
        
        const updateResult = await req.db.query(updateQuery, [
            estado.trim(),
            nota ? nota.trim() : null,
            parseInt(id)
        ]);
        
        const presupuestoActualizado = updateResult.rows[0];
        
        console.log(`[PRESUPUESTOS-BACK] ✅ Estado actualizado: ${presupuestoAnterior.estado} → ${presupuestoActualizado.estado}`);
        
        res.json({
            success: true,
            data: presupuestoActualizado,
            cambios: {
                estado_anterior: presupuestoAnterior.estado,
                estado_nuevo: presupuestoActualizado.estado
            },
            message: 'Estado de presupuesto actualizado exitosamente',
            timestamp: new Date().toISOString()
        });
        
    } catch (error) {
        console.error('[PRESUPUESTOS-BACK] ❌ Error al actualizar estado:', error);
        res.status(500).json({
            success: false,
            error: 'Error al actualizar estado de presupuesto',
            message: error.message,
            timestamp: new Date().toISOString()
        });
    }
};

/**
 * Obtener estadísticas de presupuestos CON LOGS
 */
const obtenerEstadisticas = async (req, res) => {
    try {
        console.log('[PRESUPUESTOS-BACK] 📊 CALCULANDO ESTADÍSTICAS...');
        
        // Estadísticas generales
        const statsQuery = `
            SELECT 
                COUNT(*) as total_presupuestos,
                COUNT(DISTINCT id_cliente) as total_clientes,
                COUNT(DISTINCT agente) as total_agentes,
                SUM(descuento) as descuento_total,
                AVG(descuento) as descuento_promedio,
                MIN(fecha) as fecha_primer_presupuesto,
                MAX(fecha) as fecha_ultimo_presupuesto
            FROM presupuestos 
            WHERE activo = true
        `;
        
        const statsResult = await req.db.query(statsQuery);
        const stats = statsResult.rows[0];
        
        console.log(`[PRESUPUESTOS-BACK] Total presupuestos en BD: ${stats.total_presupuestos}`);
        console.log(`[PRESUPUESTOS-BACK] Total clientes únicos: ${stats.total_clientes}`);
        console.log(`[PRESUPUESTOS-BACK] Total agentes únicos: ${stats.total_agentes}`);
        
        // Distribución por estados
        const estadosQuery = `
            SELECT 
                estado,
                COUNT(*) as cantidad,
                COUNT(DISTINCT id_cliente) as clientes_distintos,
                SUM(descuento) as descuento_total,
                AVG(descuento) as descuento_promedio
            FROM presupuestos 
            WHERE activo = true 
            GROUP BY estado 
            ORDER BY cantidad DESC
        `;
        
        const estadosResult = await req.db.query(estadosQuery);
        
        console.log('[PRESUPUESTOS-BACK] Distribución por estados:');
        estadosResult.rows.forEach(estado => {
            console.log(`[PRESUPUESTOS-BACK] - ${estado.estado}: ${estado.cantidad} presupuestos`);
        });
        
        // Top clientes
        const clientesQuery = `
            SELECT 
                id_cliente,
                COUNT(*) as total_presupuestos,
                SUM(descuento) as descuento_total,
                MAX(fecha) as ultimo_presupuesto
            FROM presupuestos 
            WHERE activo = true 
            GROUP BY id_cliente 
            ORDER BY total_presupuestos DESC 
            LIMIT 10
        `;
        
        const clientesResult = await req.db.query(clientesQuery);
        
        // Estadísticas de artículos
        const articulosQuery = `
            SELECT 
                COUNT(*) as total_detalles,
                COUNT(DISTINCT articulo) as articulos_distintos,
                SUM(cantidad) as cantidad_total,
                SUM(precio1 * cantidad) as valor_total_estimado
            FROM presupuestos_detalles pd
            INNER JOIN presupuestos p ON p.id = pd.id_presupuesto
            WHERE p.activo = true
        `;
        
        const articulosResult = await req.db.query(articulosQuery);
        const articulosStats = articulosResult.rows[0];
        
        console.log(`[PRESUPUESTOS-BACK] Total detalles de artículos: ${articulosStats.total_detalles}`);
        console.log(`[PRESUPUESTOS-BACK] Artículos distintos: ${articulosStats.articulos_distintos}`);
        console.log(`[PRESUPUESTOS-BACK] Valor total estimado: $${articulosStats.valor_total_estimado || 0}`);
        
        console.log('[PRESUPUESTOS-BACK] ✅ Estadísticas calculadas exitosamente');
        
        res.json({
            success: true,
            estadisticas: {
                total_presupuestos: parseInt(stats.total_presupuestos),
                total_clientes: parseInt(stats.total_clientes),
                total_agentes: parseInt(stats.total_agentes),
                descuento_total: parseFloat(stats.descuento_total || 0),
                descuento_promedio: parseFloat(stats.descuento_promedio || 0),
                fecha_primer_presupuesto: stats.fecha_primer_presupuesto,
                fecha_ultimo_presupuesto: stats.fecha_ultimo_presupuesto,
                total_detalles: parseInt(articulosStats.total_detalles || 0),
                articulos_distintos: parseInt(articulosStats.articulos_distintos || 0),
                cantidad_total: parseFloat(articulosStats.cantidad_total || 0),
                valor_total_estimado: parseFloat(articulosStats.valor_total_estimado || 0)
            },
            distribucion_estados: estadosResult.rows,
            top_clientes: clientesResult.rows,
            timestamp: new Date().toISOString()
        });
        
    } catch (error) {
        console.error('[PRESUPUESTOS-BACK] ❌ Error al calcular estadísticas:', error);
        res.status(500).json({
            success: false,
            error: 'Error al calcular estadísticas',
            message: error.message,
            timestamp: new Date().toISOString()
        });
    }
};

/**
 * Obtener resumen por cliente o estado
 */
const obtenerResumen = async (req, res) => {
    try {
        const { 
            tipo = 'cliente', 
            fecha_desde, 
            fecha_hasta,
            estado 
        } = req.query;
        
        console.log(`[PRESUPUESTOS-BACK] Generando resumen por: ${tipo}`);
        console.log('[PRESUPUESTOS-BACK] Filtros:', { fecha_desde, fecha_hasta, estado });
        
        let query = '';
        let params = [];
        let paramCount = 0;
        
        if (tipo === 'cliente') {
            query = `
                SELECT 
                    id_cliente,
                    COUNT(*) as total_presupuestos,
                    COUNT(CASE WHEN estado = 'entregado' THEN 1 END) as entregados,
                    COUNT(CASE WHEN estado = 'pendiente' THEN 1 END) as pendientes,
                    COUNT(CASE WHEN estado = 'armado' THEN 1 END) as armados,
                    SUM(descuento) as descuento_total,
                    AVG(descuento) as descuento_promedio,
                    MIN(fecha) as fecha_primer_presupuesto,
                    MAX(fecha) as fecha_ultimo_presupuesto
                FROM presupuestos 
                WHERE activo = true
            `;
            
        } else if (tipo === 'estado') {
            query = `
                SELECT 
                    estado,
                    COUNT(*) as total_presupuestos,
                    COUNT(DISTINCT id_cliente) as clientes_distintos,
                    SUM(descuento) as descuento_total,
                    AVG(descuento) as descuento_promedio,
                    MIN(fecha) as fecha_primer_presupuesto,
                    MAX(fecha) as fecha_ultimo_presupuesto
                FROM presupuestos 
                WHERE activo = true
            `;
            
        } else {
            console.log('[PRESUPUESTOS-BACK] ❌ Tipo de resumen inválido:', tipo);
            return res.status(400).json({
                success: false,
                error: 'Tipo de resumen inválido. Use "cliente" o "estado"',
                timestamp: new Date().toISOString()
            });
        }
        
        // Filtros adicionales
        if (fecha_desde) {
            paramCount++;
            query += ` AND fecha >= $${paramCount}`;
            params.push(fecha_desde);
        }
        
        if (fecha_hasta) {
            paramCount++;
            query += ` AND fecha <= $${paramCount}`;
            params.push(fecha_hasta);
        }
        
        if (estado && tipo === 'cliente') {
            paramCount++;
            query += ` AND LOWER(estado) = LOWER($${paramCount})`;
            params.push(estado);
        }
        
        // Agrupar y ordenar
        if (tipo === 'cliente') {
            query += ` GROUP BY id_cliente ORDER BY total_presupuestos DESC`;
        } else {
            query += ` GROUP BY estado ORDER BY total_presupuestos DESC`;
        }
        
        console.log('[PRESUPUESTOS-BACK] Query de resumen:', query);
        console.log('[PRESUPUESTOS-BACK] Parámetros:', params);
        
        const result = await req.db.query(query, params);
        
        // Calcular totales generales
        const totalesQuery = `
            SELECT 
                COUNT(*) as total_presupuestos,
                SUM(descuento) as descuento_total,
                AVG(descuento) as descuento_promedio,
                COUNT(DISTINCT id_cliente) as total_clientes,
                COUNT(DISTINCT estado) as total_estados
            FROM presupuestos 
            WHERE activo = true
            ${fecha_desde ? `AND fecha >= '${fecha_desde}'` : ''}
            ${fecha_hasta ? `AND fecha <= '${fecha_hasta}'` : ''}
            ${estado && tipo === 'cliente' ? `AND LOWER(estado) = LOWER('${estado}')` : ''}
        `;
        
        const totalesResult = await req.db.query(totalesQuery);
        const totales = totalesResult.rows[0];
        
        console.log(`[PRESUPUESTOS-BACK] ✅ Resumen generado: ${result.rows.length} registros`);
        
        res.json({
            success: true,
            tipo: tipo,
            data: result.rows,
            totales: {
                total_presupuestos: parseInt(totales.total_presupuestos),
                descuento_total: parseFloat(totales.descuento_total || 0),
                descuento_promedio: parseFloat(totales.descuento_promedio || 0),
                total_clientes: parseInt(totales.total_clientes),
                total_estados: parseInt(totales.total_estados)
            },
            filtros: { fecha_desde, fecha_hasta, estado },
            timestamp: new Date().toISOString()
        });
        
    } catch (error) {
        console.error('[PRESUPUESTOS-BACK] ❌ Error al generar resumen:', error);
        res.status(500).json({
            success: false,
            error: 'Error al generar resumen',
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
        console.log('[PRESUPUESTOS-BACK] Obteniendo configuración actual...');
        
        const query = `
            SELECT 
                id,
                hoja_url,
                hoja_id,
                hoja_nombre,
                rango,
                activo,
                usuario_id,
                fecha_creacion
            FROM presupuestos_config 
            WHERE activo = true 
            ORDER BY fecha_creacion DESC 
            LIMIT 1
        `;
        
        const result = await req.db.query(query);
        
        if (result.rows.length === 0) {
            console.log('[PRESUPUESTOS-BACK] ⚠️ No se encontró configuración activa');
            return res.json({
                success: true,
                data: null,
                message: 'No hay configuración activa',
                timestamp: new Date().toISOString()
            });
        }
        
        const config = result.rows[0];
        console.log('[PRESUPUESTOS-BACK] ✅ Configuración encontrada:', config.hoja_id);
        
        res.json({
            success: true,
            data: config,
            timestamp: new Date().toISOString()
        });
        
    } catch (error) {
        console.error('[PRESUPUESTOS-BACK] ❌ Error al obtener configuración:', error);
        res.status(500).json({
            success: false,
            error: 'Error al obtener configuración',
            message: error.message,
            timestamp: new Date().toISOString()
        });
    }
};

console.log('[PRESUPUESTOS-BACK] ✅ Controlador de presupuestos CON LOGS configurado');

module.exports = {
    obtenerPresupuestos,
    obtenerPresupuestoPorId,
    actualizarEstadoPresupuesto,
    obtenerEstadisticas,
    obtenerResumen,
    obtenerConfiguracion
};
