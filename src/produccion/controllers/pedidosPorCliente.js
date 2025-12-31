const pool = require('../config/database');

/**
 * Helper para detectar el modo de JOIN entre presupuestos y presupuestos_detalles
 */
async function detectarModoJoin(pool) {
    try {
        const query = `
            SELECT column_name 
            FROM information_schema.columns 
            WHERE table_schema = 'public' 
              AND table_name = 'presupuestos_detalles' 
              AND column_name IN ('id_presupuesto_ext', 'id_presupuesto')
        `;
        
        const result = await pool.query(query);
        const columnas = result.rows.map(row => row.column_name);
        
        const existeExt = columnas.includes('id_presupuesto_ext');
        const existeId = columnas.includes('id_presupuesto');
        
        // Priorizar id_presupuesto_ext si existe
        const modo = existeExt ? 'ext' : (existeId ? 'id' : null);
        
        return { modo, existeExt, existeId };
    } catch (error) {
        console.error('[PROD_PED] Error detectando modo JOIN:', error);
        return { modo: 'ext', existeExt: true, existeId: false }; // Fallback
    }
}

/**
 * Obtiene pedidos consolidados por cliente desde presupuestos confirmados
 */
const obtenerPedidosPorCliente = async (req, res) => {
    try {
        console.log('🔍 [PROD_PED] Iniciando consulta de pedidos por cliente...');
        
        const { 
            fecha = new Date().toISOString().split('T')[0], 
            cliente_id, 
            estado = 'presupuesto/orden',
            debug,
            ids
        } = req.query;
        
        // Validaciones
        if (fecha && !fecha.match(/^\d{4}-\d{2}-\d{2}$/)) {
            console.log('❌ [PROD_PED] Fecha inválida:', fecha);
            return res.status(400).json({
                success: false,
                error: 'Fecha inválida. Use formato YYYY-MM-DD',
                timestamp: new Date().toISOString()
            });
        }
        
        if (cliente_id && (isNaN(parseInt(cliente_id)) || parseInt(cliente_id) <= 0)) {
            console.log('❌ [PROD_PED] cliente_id inválido:', cliente_id);
            return res.status(400).json({
                success: false,
                error: 'cliente_id debe ser un número entero positivo',
                timestamp: new Date().toISOString()
            });
        }
        
        console.log('📋 [PROD_PED] Parámetros:', { fecha, cliente_id, estado, debug });
        
        // Detectar modo de JOIN
        const joinInfo = await detectarModoJoin(pool);
        console.log(`[PROD_PED] Modo JOIN detectado:`, joinInfo);

        if (!joinInfo.modo) {
            return res.status(500).json({
                success: false,
                message: 'No se pudo determinar el modo de JOIN para presupuestos_detalles'
            });
        }

        // Construir JOIN dinámicamente
        let joinClause;
        let presupuestoIdFieldMain;   // para el CTE/articulos (alias pc)
        let presupuestoIdFieldCount;  // para el subselect (alias pc2)
        
        if (joinInfo.modo === 'ext') {
            joinClause = 'JOIN public.presupuestos_detalles pd ON pd.id_presupuesto_ext = pc.id_presupuesto_ext';
            presupuestoIdFieldMain = 'pc.id_presupuesto_ext';
            presupuestoIdFieldCount = 'pc2.id_presupuesto_ext';
        } else {
            joinClause = 'JOIN public.presupuestos_detalles pd ON pd.id_presupuesto = pc.id';
            presupuestoIdFieldMain = 'pc.id';
            presupuestoIdFieldCount = 'pc2.id';
        }
        
        // Query consolidada con estado normalizado y fecha robusta
        const query = `
            WITH presupuestos_con_derivados AS (
                SELECT DISTINCT id_presupuesto_local
                FROM public.faltantes_pendientes_compra
                WHERE estado = 'En espera'
            ),
            presupuestos_confirmados AS (
                SELECT 
                    p.id,
                    p.id_presupuesto_ext,
                    p.id_cliente,
                    p.fecha,
                    COALESCE(p.secuencia, 'Imprimir') as secuencia,
                    CAST(p.id_cliente AS integer) as cliente_id_int
                FROM public.presupuestos p
                LEFT JOIN presupuestos_con_derivados pcd ON pcd.id_presupuesto_local = p.id
                WHERE p.activo = true 
                  AND (
                      REPLACE(LOWER(TRIM(p.estado)), ' ', '') = REPLACE(LOWER($1), ' ', '')
                      OR p.estado = 'Retira por Deposito'
                  )
                  AND p.fecha::date <= $2::date
                  AND ($3::integer IS NULL OR CAST(p.id_cliente AS integer) = $3)
                  AND ($4::text IS NULL OR p.id IN (SELECT unnest(string_to_array($4, ','))::integer))
                  AND (CASE WHEN $4::text IS NULL THEN pcd.id_presupuesto_local IS NULL ELSE true END)
                  AND COALESCE(p.secuencia, 'Imprimir') != 'Asignado_Ruta'
            ),
            articulos_por_presupuesto AS (
                SELECT 
                    pc.cliente_id_int,
                    ${presupuestoIdFieldMain} as presupuesto_id,
                    pc.id as presupuesto_id_local,
                    pc.fecha as presupuesto_fecha,
                    pc.secuencia,
                    pd.articulo as articulo_numero,
                    SUM(COALESCE(pd.cantidad, 0)) as cantidad
                FROM presupuestos_confirmados pc
                ${joinClause}
                WHERE pd.articulo IS NOT NULL AND TRIM(pd.articulo) != ''
                GROUP BY pc.cliente_id_int, ${presupuestoIdFieldMain}, pc.id, pc.fecha, pc.secuencia, pd.articulo
            )
            SELECT 
                app.cliente_id_int as cliente_id,
                COALESCE(
                    NULLIF(TRIM(c.nombre || ' ' || COALESCE(c.apellido, '')), ''),
                    NULLIF(TRIM(c.nombre), ''),
                    NULLIF(TRIM(c.apellido), ''),
                    'Cliente ' || app.cliente_id_int
                ) as cliente_nombre,
                COUNT(DISTINCT app.articulo_numero) as total_articulos,
                COUNT(DISTINCT app.presupuesto_id) as total_presupuestos,
                JSON_AGG(
                    JSON_BUILD_OBJECT(
                        'presupuesto_id', app.presupuesto_id,
                        'id_presupuesto_local', app.presupuesto_id_local,
                        'presupuesto_fecha', app.presupuesto_fecha,
                        'secuencia', app.secuencia,
                        'articulo_numero', app.articulo_numero,
                        'descripcion', COALESCE(
                            NULLIF(TRIM(a.nombre), ''),
                            app.articulo_numero
                        ),
                        'pedido_total', ROUND(app.cantidad::numeric, 2),
                        'stock_disponible', ROUND(GREATEST(0, (CASE 
                            WHEN src.es_pack = true AND src.pack_hijo_codigo IS NOT NULL AND src.pack_unidades > 0 
                            THEN FLOOR(ROUND(COALESCE(hijo.stock_consolidado, 0), 4) / src.pack_unidades)
                            ELSE ROUND(COALESCE(src.stock_consolidado, 0), 4)
                        END))::numeric, 2),
                        'faltante', ROUND(GREATEST(0, app.cantidad - 
                            GREATEST(0, (CASE 
                                WHEN src.es_pack = true AND src.pack_hijo_codigo IS NOT NULL AND src.pack_unidades > 0 
                                THEN FLOOR(ROUND(COALESCE(hijo.stock_consolidado, 0), 4) / src.pack_unidades)
                                ELSE ROUND(COALESCE(src.stock_consolidado, 0), 4)
                            END))
                        )::numeric, 2),
                        'es_pack', src.es_pack,
                        'pack_hijo_codigo', src.pack_hijo_codigo,
                        'pack_unidades', src.pack_unidades,
                        'stock_hijo', hijo.stock_consolidado,
                        'snapshot_motivo', ps.motivo,
                        'snapshot_numero_impresion', ps.numero_impresion,
                        'snapshot_secuencia', ps.secuencia_en_snapshot
                    ) ORDER BY app.presupuesto_fecha DESC, app.presupuesto_id, app.articulo_numero
                ) as articulos
            FROM articulos_por_presupuesto app
            LEFT JOIN public.clientes c ON c.cliente_id = app.cliente_id_int
            LEFT JOIN public.stock_real_consolidado src ON src.codigo_barras = app.articulo_numero
            LEFT JOIN public.stock_real_consolidado hijo ON hijo.codigo_barras = src.pack_hijo_codigo
            LEFT JOIN public.articulos a ON a.codigo_barras = app.articulo_numero
            LEFT JOIN public.presupuestos_snapshots ps ON ps.id_presupuesto = app.presupuesto_id_local AND ps.activo = true
            GROUP BY app.cliente_id_int, c.nombre, c.apellido
            ORDER BY cliente_nombre;
        `;
        
        const params = [estado, fecha, cliente_id ? parseInt(cliente_id) : null, ids || null];
        console.log('🔍 [PROD_PED] Ejecutando consulta con parámetros:', params);
        
        const result = await pool.query(query, params);
        
        // Preparar respuesta base
        let response = {
            success: true,
            data: [],
            total_clientes: 0,
            filtros: { fecha, cliente_id, estado },
            timestamp: new Date().toISOString()
        };

        // Si hay resultados, procesarlos
        if (result.rows.length > 0) {
            // Log de conversiones pack aplicadas (antes de limpiar campos)
            let totalArticulosPack = 0;
            result.rows.forEach(cliente => {
                const articulosPack = cliente.articulos.filter(art => art.es_pack === true);
                totalArticulosPack += articulosPack.length;
                
                articulosPack.forEach(art => {
                    const stockOriginal = art.stock_hijo || 0;
                    const stockConvertido = art.stock_disponible;
                    console.log(`🧩 [PACK] ${art.articulo_numero}: hijo=${art.pack_hijo_codigo} stock=${stockOriginal} unidades=${art.pack_unidades} → effective=${stockConvertido}`);
                });
            });
            
            if (totalArticulosPack > 0) {
                console.log(`🧩 [PACK] Conversiones aplicadas a ${totalArticulosPack} artículos pack en pedidos por cliente`);
            }
            
            // Calcular indicador de estado para cada cliente y limpiar campos internos
            // IMPORTANTE: Usar valores redondeados para clasificación de estado
            const clientesConIndicador = result.rows.map(cliente => {
                const articulos = cliente.articulos;
                let completos = 0;
                let parciales = 0;
                let faltantes = 0;
                
                articulos.forEach(art => {
                    // Los valores ya vienen redondeados del SQL, usarlos directamente
                    const faltanteRedondeado = parseFloat(art.faltante) || 0;
                    const stockRedondeado = parseFloat(art.stock_disponible) || 0;
                    
                    if (faltanteRedondeado === 0) {
                        completos++;
                    } else if (stockRedondeado > 0) {
                        parciales++;
                    } else {
                        faltantes++;
                    }
                });
                
                let indicador_estado;
                if (faltantes > 0) {
                    indicador_estado = 'FALTANTES';
                } else if (parciales > 0) {
                    indicador_estado = 'PARCIAL';
                } else {
                    indicador_estado = 'COMPLETO';
                }
                
                // Limpiar campos internos de pack de cada artículo
                const articulosLimpios = articulos.map(art => {
                    const { es_pack, pack_hijo_codigo, pack_unidades, stock_hijo, ...articuloLimpio } = art;
                    return articuloLimpio;
                });
                
                return {
                    ...cliente,
                    articulos: articulosLimpios,
                    indicador_estado
                };
            });

            response.data = clientesConIndicador;
            response.total_clientes = clientesConIndicador.length;
        } else {
            response.message = 'No se encontraron pedidos confirmados para la fecha especificada';
        }

        // Agregar información de debug si no hay resultados o si se solicita explícitamente
        if (result.rows.length === 0 || debug === 'true') {
            console.log(`[PROD_PED] Generando información de debug...`);
            
            try {
                // 1. Top 10 estados normalizados
                const estadosQuery = `
                    SELECT 
                        REPLACE(LOWER(TRIM(estado)), ' ', '') AS estado_norm, 
                        COUNT(*) as count
                    FROM public.presupuestos 
                    WHERE activo = true 
                      AND fecha::date <= $1::date 
                    GROUP BY 1 
                    ORDER BY 2 DESC 
                    LIMIT 10
                `;
                const estadosResult = await pool.query(estadosQuery, [fecha]);

                // 2. Conteos de JOIN según modo detectado
                let joinCounts = {};
                
                if (joinInfo.existeExt) {
                    const extQuery = `
                        SELECT COUNT(*) as count
                        FROM public.presupuestos p 
                        JOIN public.presupuestos_detalles pd ON pd.id_presupuesto_ext = p.id_presupuesto_ext 
                        WHERE p.activo = true 
                          AND p.fecha::date <= $1::date
                    `;
                    const extResult = await pool.query(extQuery, [fecha]);
                    joinCounts.join_por_ext = parseInt(extResult.rows[0].count);
                }

                if (joinInfo.existeId) {
                    const idQuery = `
                        SELECT COUNT(*) as count
                        FROM public.presupuestos p 
                        JOIN public.presupuestos_detalles pd ON pd.id_presupuesto = p.id 
                        WHERE p.activo = true 
                          AND p.fecha::date <= $1::date
                    `;
                    const idResult = await pool.query(idQuery, [fecha]);
                    joinCounts.join_por_id = parseInt(idResult.rows[0].count);
                }

                response.debug = {
                    modo_join_usado: joinInfo.modo,
                    columnas_detectadas: {
                        id_presupuesto_ext: joinInfo.existeExt,
                        id_presupuesto: joinInfo.existeId
                    },
                    estados_normalizados: estadosResult.rows,
                    conteos_join: joinCounts,
                    estado_buscado: estado,
                    fecha_limite: fecha,
                    fuente_descripcion: 'articulos.nombre (tabla articulos)',
                    fuente_stock: 'stock_real_consolidado.stock_consolidado',
                    estrategia_mapeo_articulo: 'Por codigo_barras (presupuestos_detalles.articulo = articulos.codigo_barras = stock_real_consolidado.codigo_barras)'
                };

            } catch (debugError) {
                console.error('[PROD_PED] Error generando debug:', debugError);
                response.debug = {
                    error: 'No se pudo generar información de debug',
                    detalle: debugError.message
                };
            }
        }
        
        console.log(`✅ [PROD_PED] Consulta exitosa: ${response.total_clientes} clientes encontrados`);
        
        res.json(response);
        
    } catch (error) {
        console.error('❌ [PROD_PED] Error al obtener pedidos por cliente:', error);
        res.status(500).json({
            success: false,
            error: 'Error interno del servidor',
            message: error.message,
            timestamp: new Date().toISOString()
        });
    }
};

/**
 * Asigna artículos faltantes a un carro de producción
 */
const asignarFaltantes = async (req, res) => {
    try {
        console.log('🔍 [PROD_PED] Iniciando asignación de faltantes...');
        
        const { usuario_id, cliente_id, articulos_faltantes, observaciones } = req.body;
        
        // Validaciones
        if (!usuario_id || isNaN(parseInt(usuario_id))) {
            return res.status(400).json({
                success: false,
                error: 'Datos invalidos',
                details: 'usuario_id es requerido y debe ser un número',
                timestamp: new Date().toISOString()
            });
        }
        
        if (!cliente_id || isNaN(parseInt(cliente_id))) {
            return res.status(400).json({
                success: false,
                error: 'Datos invalidos',
                details: 'cliente_id es requerido y debe ser un número',
                timestamp: new Date().toISOString()
            });
        }
        
        if (!articulos_faltantes || !Array.isArray(articulos_faltantes) || articulos_faltantes.length === 0) {
            return res.status(400).json({
                success: false,
                error: 'Datos invalidos',
                details: 'articulos_faltantes es requerido y debe ser un array no vacío',
                timestamp: new Date().toISOString()
            });
        }
        
        console.log('📋 [PROD_PED] Datos recibidos:', { usuario_id, cliente_id, articulos_count: articulos_faltantes.length });
        
        // Verificar que el usuario existe
        const usuarioQuery = `
            SELECT id, nombre_completo 
            FROM public.usuarios 
            WHERE id = $1 AND activo = true
        `;
        const usuarioResult = await pool.query(usuarioQuery, [parseInt(usuario_id)]);
        
        if (usuarioResult.rows.length === 0) {
            console.log('❌ [PROD_PED] Usuario no encontrado:', usuario_id);
            return res.status(404).json({
                success: false,
                error: 'Usuario no encontrado',
                usuario_id: parseInt(usuario_id),
                timestamp: new Date().toISOString()
            });
        }
        
        const usuario = usuarioResult.rows[0];
        console.log('✅ [PROD_PED] Usuario encontrado:', usuario.nombre_completo);
        
        // Crear carro de producción
        const { crearCarro, agregarArticulo } = require('./carro');
        
        const carroId = await crearCarro(parseInt(usuario_id), false, 'interna');
        console.log('✅ [PROD_PED] Carro creado con ID:', carroId);
        
        // Agregar artículos al carro
        let articulosAsignados = 0;
        for (const articulo of articulos_faltantes) {
            try {
                await agregarArticulo(
                    carroId,
                    articulo.articulo_numero,
                    articulo.descripcion || articulo.articulo_numero,
                    articulo.cantidad_faltante,
                    parseInt(usuario_id)
                );
                articulosAsignados++;
                console.log(`✅ [PROD_PED] Artículo agregado: ${articulo.articulo_numero} x${articulo.cantidad_faltante}`);
            } catch (artError) {
                console.error(`❌ [PROD_PED] Error agregando artículo ${articulo.articulo_numero}:`, artError);
            }
        }
        
        console.log(`✅ [PROD_PED] Asignación completada: ${articulosAsignados}/${articulos_faltantes.length} artículos`);
        
        res.status(201).json({
            success: true,
            carro_id: carroId,
            articulos_asignados: articulosAsignados,
            usuario_asignado: usuario.nombre_completo,
            message: 'Faltantes asignados correctamente al carro de produccion',
            timestamp: new Date().toISOString()
        });
        
    } catch (error) {
        console.error('❌ [PROD_PED] Error al asignar faltantes:', error);
        res.status(500).json({
            success: false,
            error: 'Error interno del servidor',
            message: error.message,
            timestamp: new Date().toISOString()
        });
    }
};

/**
 * Obtiene artículos consolidados desde presupuestos confirmados (vista por artículo)
 */
const obtenerPedidosArticulos = async (req, res) => {
    try {
        console.log('🔍 [PROD_ART] Iniciando consulta de artículos consolidados...');
        
        const { 
            fecha = new Date().toISOString().split('T')[0], 
            q, // filtro de búsqueda por texto
            estado_filtro, // todos, faltantes, completos, parciales
            debug
        } = req.query;
        
        // Validaciones (reusar las mismas)
        if (fecha && !fecha.match(/^\d{4}-\d{2}-\d{2}$/)) {
            console.log('❌ [PROD_ART] Fecha inválida:', fecha);
            return res.status(400).json({
                success: false,
                error: 'Fecha inválida. Use formato YYYY-MM-DD',
                timestamp: new Date().toISOString()
            });
        }
        
        console.log('📋 [PROD_ART] Parámetros:', { fecha, q, estado_filtro, debug });
        
        // Detectar modo de JOIN (reusar helper existente)
        const joinInfo = await detectarModoJoin(pool);
        console.log(`[PROD_ART] Modo JOIN detectado:`, joinInfo);

        if (!joinInfo.modo) {
            return res.status(500).json({
                success: false,
                message: 'No se pudo determinar el modo de JOIN para presupuestos_detalles'
            });
        }

        // Construir JOIN dinámicamente (reusar lógica existente)
        let joinClause;
        if (joinInfo.modo === 'ext') {
            joinClause = 'JOIN public.presupuestos_detalles pd ON pd.id_presupuesto_ext = pc.id_presupuesto_ext';
        } else {
            joinClause = 'JOIN public.presupuestos_detalles pd ON pd.id_presupuesto = pc.id';
        }
        
        // Query consolidada por artículo con exclusión de ítems derivados
        const query = `
            WITH articulos_derivados_compra AS (
                SELECT DISTINCT
                    fpc.codigo_barras as codigo_barras_derivado,
                    fpc.id_presupuesto_local
                FROM public.faltantes_pendientes_compra fpc
                WHERE fpc.estado = 'En espera'
                  AND fpc.codigo_barras IS NOT NULL
            ),
            presupuestos_confirmados AS (
                SELECT 
                    p.id,
                    p.id_presupuesto_ext,
                    p.id_cliente,
                    p.fecha,
                    COALESCE(p.secuencia, 'Imprimir') as secuencia,
                    CAST(p.id_cliente AS integer) as cliente_id_int
                FROM public.presupuestos p
                WHERE p.activo = true 
                  AND REPLACE(LOWER(TRIM(p.estado)), ' ', '') = REPLACE(LOWER($1), ' ', '')
                  AND p.fecha::date <= $2::date
                  AND COALESCE(p.secuencia, 'Imprimir') != 'Asignado_Ruta'
            ),
            articulos_consolidados AS (
                SELECT 
                    pc.id as presupuesto_id_local,
                    pd.articulo as articulo_numero,
                    SUM(COALESCE(pd.cantidad, 0)) as pedido_total
                FROM presupuestos_confirmados pc
                ${joinClause}
                LEFT JOIN articulos_derivados_compra adc 
                    ON adc.codigo_barras_derivado = pd.articulo 
                    AND adc.id_presupuesto_local = pc.id
                WHERE pd.articulo IS NOT NULL 
                  AND TRIM(pd.articulo) != ''
                  AND pc.secuencia NOT IN ('Pedido_Listo', 'Retira_Deposito')
                  AND adc.codigo_barras_derivado IS NULL
                GROUP BY pc.id, pd.articulo
            ),
            pedidos_listos AS (
                SELECT 
                    pd.articulo as articulo_numero,
                    SUM(COALESCE(pd.cantidad, 0)) as cantidad_en_pedidos_listos
                FROM presupuestos_confirmados pc
                ${joinClause}
                WHERE pd.articulo IS NOT NULL 
                  AND TRIM(pd.articulo) != ''
                  AND pc.secuencia = 'Pedido_Listo'
                GROUP BY pd.articulo
            ),
            valores_redondeados AS (
                SELECT 
                    ac.articulo_numero as codigo_barras_original,
                    ac.pedido_total,
                    COALESCE(
                        NULLIF(TRIM(src.descripcion), ''),
                        NULLIF(TRIM(a.nombre), ''),
                        ac.articulo_numero
                    ) as descripcion,
                    COALESCE(a.numero, ac.articulo_numero) as articulo_numero_alfanumerico,
                    ROUND(ac.pedido_total::numeric, 2) as pedido_total_redondeado,
                    ROUND(GREATEST(0, 
                        (CASE 
                            WHEN src.es_pack = true AND src.pack_hijo_codigo IS NOT NULL AND src.pack_unidades > 0 
                            THEN FLOOR(ROUND(COALESCE(hijo.stock_consolidado, 0), 4) / src.pack_unidades)
                            ELSE ROUND(COALESCE(src.stock_consolidado, 0), 4)
                        END) - COALESCE(pl.cantidad_en_pedidos_listos, 0)
                    )::numeric, 2) as stock_disponible_redondeado,
                    ROUND(GREATEST(0, ac.pedido_total - 
                        GREATEST(0,
                            (CASE 
                                WHEN src.es_pack = true AND src.pack_hijo_codigo IS NOT NULL AND src.pack_unidades > 0 
                                THEN FLOOR(ROUND(COALESCE(hijo.stock_consolidado, 0), 4) / src.pack_unidades)
                                ELSE ROUND(COALESCE(src.stock_consolidado, 0), 4)
                            END) - COALESCE(pl.cantidad_en_pedidos_listos, 0)
                        )
                    )::numeric, 2) as faltante_redondeado,
                    src.es_pack,
                    src.pack_hijo_codigo,
                    src.pack_unidades,
                    hijo.stock_consolidado as stock_hijo,
                    ac.presupuesto_id_local as id_presupuesto_local,
                    pc.id_presupuesto_ext
                FROM articulos_consolidados ac
                LEFT JOIN presupuestos_confirmados pc ON pc.id = ac.presupuesto_id_local
                LEFT JOIN pedidos_listos pl ON pl.articulo_numero = ac.articulo_numero
                LEFT JOIN public.stock_real_consolidado src ON src.codigo_barras = ac.articulo_numero
                LEFT JOIN public.stock_real_consolidado hijo ON hijo.codigo_barras = src.pack_hijo_codigo
                LEFT JOIN public.articulos a ON a.codigo_barras = ac.articulo_numero
            )
            SELECT 
                vr.articulo_numero_alfanumerico as articulo_numero,
                vr.codigo_barras_original as codigo_barras,
                vr.descripcion,
                vr.pedido_total_redondeado as pedido_total,
                vr.stock_disponible_redondeado as stock_disponible,
                vr.faltante_redondeado as faltante,
                CASE 
                    WHEN vr.faltante_redondeado = 0 THEN 'COMPLETO'
                    WHEN vr.stock_disponible_redondeado = 0 THEN 'FALTANTE'
                    ELSE 'PARCIAL'
                END as estado,
                vr.es_pack,
                vr.pack_hijo_codigo,
                vr.pack_unidades,
                vr.stock_hijo,
                vr.id_presupuesto_local,
                vr.id_presupuesto_ext,
                COALESCE(r_hijo.articulo_sugerido_numero, r_padre.articulo_sugerido_numero) as articulo_sugerido_numero,
                COALESCE(asug_hijo.nombre, asug_padre.nombre) as articulo_sugerido_nombre,
                COALESCE(asug_hijo.codigo_barras, asug_padre.codigo_barras) as articulo_sugerido_codigo_barras,
                ROUND(GREATEST(0, COALESCE(
                    CASE 
                        WHEN src_sug_hijo.es_pack = true AND src_sug_hijo.pack_hijo_codigo IS NOT NULL AND src_sug_hijo.pack_unidades > 0 
                        THEN FLOOR(ROUND(COALESCE(hijo_sug_hijo.stock_consolidado, 0), 4) / src_sug_hijo.pack_unidades)
                        WHEN src_sug_padre.es_pack = true AND src_sug_padre.pack_hijo_codigo IS NOT NULL AND src_sug_padre.pack_unidades > 0 
                        THEN FLOOR(ROUND(COALESCE(hijo_sug_padre.stock_consolidado, 0), 4) / src_sug_padre.pack_unidades)
                        ELSE ROUND(COALESCE(src_sug_hijo.stock_consolidado, src_sug_padre.stock_consolidado, 0), 4)
                    END, 0
                ))::numeric, 2) as articulo_sugerido_stock
            FROM valores_redondeados vr
            LEFT JOIN public.articulos a_hijo ON a_hijo.codigo_barras = vr.pack_hijo_codigo
            LEFT JOIN public.recetas r_hijo ON r_hijo.articulo_numero = a_hijo.numero
            LEFT JOIN public.recetas r_padre ON r_padre.articulo_numero = vr.articulo_numero_alfanumerico
            LEFT JOIN public.articulos asug_hijo ON asug_hijo.numero = r_hijo.articulo_sugerido_numero
            LEFT JOIN public.articulos asug_padre ON asug_padre.numero = r_padre.articulo_sugerido_numero
            LEFT JOIN public.stock_real_consolidado src_sug_hijo ON src_sug_hijo.codigo_barras = asug_hijo.codigo_barras
            LEFT JOIN public.stock_real_consolidado src_sug_padre ON src_sug_padre.codigo_barras = asug_padre.codigo_barras
            LEFT JOIN public.stock_real_consolidado hijo_sug_hijo ON hijo_sug_hijo.codigo_barras = src_sug_hijo.pack_hijo_codigo
            LEFT JOIN public.stock_real_consolidado hijo_sug_padre ON hijo_sug_padre.codigo_barras = src_sug_padre.pack_hijo_codigo
            WHERE vr.faltante_redondeado > 0
            ORDER BY vr.articulo_numero_alfanumerico;
        `;
        
        const params = ['presupuesto/orden', fecha];
        console.log('🔍 [PROD_ART] Ejecutando consulta con parámetros:', params);
        
        const result = await pool.query(query, params);
        
        // Log de sugerencias encontradas
        const articulosConSugerencia = result.rows.filter(art => art.articulo_sugerido_numero);
        if (articulosConSugerencia.length > 0) {
            console.log(`💡 [SUGERENCIAS] ${articulosConSugerencia.length} artículos con sugerencia configurada:`);
            articulosConSugerencia.forEach(art => {
                console.log(`💡 [SUGERENCIAS] ${art.articulo_numero} → ${art.articulo_sugerido_numero} (${art.articulo_sugerido_nombre})`);
            });
        }
        
        // Aplicar filtros adicionales
        let articulos = result.rows;
        
        // Filtro por texto (q) y búsqueda en stock_real_consolidado para artículos no pedidos
        if (q && q.trim()) {
            const filtroTexto = q.trim().toLowerCase();
            
            // Filtrar artículos que ya están en presupuestos
            articulos = articulos.filter(art => 
                art.articulo_numero.toLowerCase().includes(filtroTexto) ||
                art.descripcion.toLowerCase().includes(filtroTexto)
            );
            
            // Si buscamos por código de barras exacto y NO está en los resultados, buscar en stock_real_consolidado
            const busquedaExacta = q.trim();
            const yaExiste = articulos.some(art => art.articulo_numero === busquedaExacta);
            
            if (!yaExiste) {
                console.log(`🔍 [PROD_ART] Artículo ${busquedaExacta} no está en presupuestos, buscando en stock_real_consolidado...`);
                
                const stockQuery = `
                    SELECT 
                        COALESCE(a.numero, src.codigo_barras) as articulo_numero,
                        src.codigo_barras as codigo_barras,
                        COALESCE(
                            NULLIF(TRIM(src.descripcion), ''),
                            src.codigo_barras
                        ) as descripcion,
                        0 as pedido_total,
                        ROUND(GREATEST(0, COALESCE(
                            CASE 
                                WHEN src.es_pack = true AND src.pack_hijo_codigo IS NOT NULL AND src.pack_unidades > 0 
                                THEN FLOOR(ROUND(COALESCE(hijo.stock_consolidado, 0), 4) / src.pack_unidades)
                                ELSE ROUND(src.stock_consolidado, 0, 4)
                            END, 0
                        ))::numeric, 2) as stock_disponible,
                        0 as faltante,
                        'COMPLETO' as estado,
                        src.es_pack,
                        src.pack_hijo_codigo,
                        src.pack_unidades,
                        hijo.stock_consolidado as stock_hijo
                    FROM public.stock_real_consolidado src
                    LEFT JOIN public.stock_real_consolidado hijo ON hijo.codigo_barras = src.pack_hijo_codigo
                    LEFT JOIN public.articulos a ON a.codigo_barras = src.codigo_barras
                    WHERE src.codigo_barras = $1 OR src.articulo_numero = $1
                    LIMIT 1
                `;
                
                const stockResult = await pool.query(stockQuery, [busquedaExacta]);
                
                if (stockResult.rows.length > 0) {
                    console.log(`✅ [PROD_ART] Artículo ${busquedaExacta} encontrado en stock_real_consolidado`);
                    articulos.push(stockResult.rows[0]);
                } else {
                    console.log(`❌ [PROD_ART] Artículo ${busquedaExacta} no encontrado en stock_real_consolidado`);
                }
            }
        }
        
        // Filtro por estado
        if (estado_filtro && estado_filtro !== 'todos') {
            articulos = articulos.filter(art => 
                art.estado.toLowerCase() === estado_filtro.toLowerCase()
            );
        }
        
        // Calcular totales
        const totales = articulos.reduce((acc, art) => {
            switch (art.estado) {
                case 'COMPLETO':
                    acc.completos++;
                    break;
                case 'PARCIAL':
                    acc.parciales++;
                    break;
                case 'FALTANTE':
                    acc.faltantes++;
                    break;
            }
            return acc;
        }, { faltantes: 0, parciales: 0, completos: 0 });
        
        // Preparar respuesta
        let response = {
            success: true,
            data: articulos,
            totales: totales,
            total_articulos: articulos.length,
            filtros: { fecha, q, estado_filtro },
            timestamp: new Date().toISOString()
        };

        // Agregar información de debug si se solicita
        if (debug === 'true') {
            console.log(`[PROD_ART] Generando información de debug...`);
            
            response.debug = {
                modo_join_usado: joinInfo.modo,
                fuente_descripcion: 'articulos.nombre (tabla articulos)',
                fuente_stock: 'stock_real_consolidado.stock_consolidado',
                estrategia_mapeo_articulo: 'Por codigo_barras (presupuestos_detalles.articulo = articulos.codigo_barras = stock_real_consolidado.codigo_barras)',
                total_antes_filtros: result.rows.length,
                filtros_aplicados: {
                    texto: q ? `"${q}"` : 'ninguno',
                    estado: estado_filtro || 'todos'
                }
            };
        }
        
        // Log de conversiones pack aplicadas
        const articulosPack = articulos.filter(art => art.es_pack === true);
        if (articulosPack.length > 0) {
            console.log(`🧩 [PACK] Conversiones aplicadas a ${articulosPack.length} artículos pack:`);
            articulosPack.forEach(art => {
                const stockOriginal = art.stock_hijo || 0;
                const stockConvertido = art.stock_disponible;
                console.log(`🧩 [PACK] ${art.articulo_numero}: hijo=${art.pack_hijo_codigo} stock=${stockOriginal} unidades=${art.pack_unidades} → effective=${stockConvertido}`);
            });
        }

        // Limpiar campos internos del response SOLO si no se solicita explícitamente incluirlos
        // IMPORTANTE: Mantener campos de sugerencias (articulo_sugerido_*)
        const includePack = req.query.include_pack === 'true';
        
        if (!includePack) {
            articulos = articulos.map(art => {
                const { 
                    es_pack, 
                    pack_hijo_codigo, 
                    pack_unidades, 
                    stock_hijo, 
                    ...articuloLimpio 
                } = art;
                return articuloLimpio;
            });
        }
        
        // Log de verificación de campos de sugerencias en respuesta
        const articulosConSugerenciaEnRespuesta = articulos.filter(art => art.articulo_sugerido_numero);
        if (articulosConSugerenciaEnRespuesta.length > 0) {
            console.log(`💡 [SUGERENCIAS-RESPONSE] ${articulosConSugerenciaEnRespuesta.length} artículos con sugerencia en respuesta final:`);
            articulosConSugerenciaEnRespuesta.forEach(art => {
                console.log(`💡 [SUGERENCIAS-RESPONSE] ${art.articulo_numero} → ${art.articulo_sugerido_numero} (${art.articulo_sugerido_nombre}) stock=${art.articulo_sugerido_stock}`);
            });
        }

        // Actualizar response con datos (limpios o con pack según parámetro)
        response.data = articulos;
        
        console.log(`✅ [PROD_ART] Consulta exitosa: ${articulos.length} artículos encontrados`);
        console.log(`📊 [PROD_ART] Totales: ${totales.faltantes} faltantes, ${totales.parciales} parciales, ${totales.completos} completos`);
        
        // [PEDIDOS-ART] Log de muestra para diagnóstico
        if (articulos.length > 0) {
            const muestra = articulos[0];
            console.log('[PEDIDOS-ART] resp item =>', {
                numero: muestra.articulo_numero,
                barras: muestra.codigo_barras,
                desc: muestra.descripcion?.substring(0, 30)
            });
        }
        
        res.json(response);
        
    } catch (error) {
        console.error('❌ [PROD_ART] Error al obtener artículos consolidados:', error);
        res.status(500).json({
            success: false,
            error: 'Error interno del servidor',
            message: error.message,
            timestamp: new Date().toISOString()
        });
    }
};

/**
 * Actualiza el mapeo de pack para un artículo
 * Acepta nombres de campos nuevos (padre_articulo, hijo_articulo) y legacy (padre_codigo_barras, hijo_codigo_barras)
 */
const actualizarPackMapping = async (req, res) => {
    try {
        console.log('🧩 [PACK-MAP] Iniciando actualización de mapeo pack...');
        
        // ✅ COMPATIBILIDAD: Aceptar ambos formatos de nombres
        // Formato OFICIAL (nuevo): padre_articulo, hijo_articulo
        // Formato LEGACY (compatibilidad): padre_codigo_barras, hijo_codigo_barras
        const padreArticulo = req.body.padre_articulo || req.body.padre_codigo_barras;
        const hijoArticulo = req.body.hijo_articulo !== undefined ? req.body.hijo_articulo : req.body.hijo_codigo_barras;
        const unidades = req.body.unidades;
        
        // Validación padre requerido
        if (!padreArticulo || typeof padreArticulo !== 'string' || !padreArticulo.trim()) {
            return res.status(400).json({
                success: false,
                error: 'padre_articulo es requerido y debe ser un string válido'
            });
        }
        
        console.log('📋 [PACK-MAP] Datos recibidos:', { 
            padre: padreArticulo, 
            hijo: hijoArticulo, 
            unidades,
            formato_usado: req.body.padre_articulo ? 'nuevo (padre_articulo)' : 'legacy (padre_codigo_barras)'
        });
        
        // Determinar si es guardar o quitar mapeo
        const esQuitarMapeo = hijoArticulo === null || hijoArticulo === undefined;
        
        if (esQuitarMapeo) {
            // QUITAR MAPEO - Buscar padre por codigo_barras o por articulo_numero
            console.log('🗑️ [PACK-MAP] Quitando mapeo pack...');
            
            const query = `
                UPDATE public.stock_real_consolidado
                SET es_pack = FALSE,
                    pack_hijo_codigo = NULL,
                    pack_unidades = NULL,
                    codigo_barras = COALESCE(codigo_barras, $1)
                WHERE codigo_barras = $1 
                   OR articulo_numero = (
                       SELECT numero FROM public.articulos 
                       WHERE codigo_barras = $1 
                       LIMIT 1
                   )
            `;
            
            const result = await pool.query(query, [padreArticulo.trim()]);
            
            console.log(`🧩 [PACK-MAP] padre=${padreArticulo} mapeo=ELIMINADO (rowCount=${result.rowCount})`);
            
            if (result.rowCount === 0) {
                return res.status(404).json({
                    success: false,
                    error: 'padre no encontrado en stock_real_consolidado'
                });
            }
            
            return res.json({ success: true, message: 'Mapeo pack eliminado correctamente' });
            
        } else {
            // GUARDAR/ACTUALIZAR MAPEO
            console.log('💾 [PACK-MAP] Guardando/actualizando mapeo pack...');
            
            // Validaciones para guardar
            if (!hijoArticulo || typeof hijoArticulo !== 'string' || !hijoArticulo.trim()) {
                return res.status(400).json({
                    success: false,
                    error: 'hijo_articulo es requerido y debe ser un string válido'
                });
            }
            
            if (!unidades || !Number.isInteger(Number(unidades)) || Number(unidades) <= 0) {
                return res.status(400).json({
                    success: false,
                    error: 'unidades debe ser un entero mayor a 0'
                });
            }
            
            const unidadesInt = parseInt(unidades);
            const hijoCodigoTrim = hijoArticulo.trim();
            const padreCodigoTrim = padreArticulo.trim();
            
            // ✅ VALIDACIÓN 1: Verificar que padre !== hijo (circularidad directa)
            if (padreCodigoTrim === hijoCodigoTrim) {
                console.log(`❌ [PACK-MAP] Circularidad directa detectada: padre=${padreCodigoTrim} === hijo=${hijoCodigoTrim}`);
                return res.status(400).json({
                    success: false,
                    error: 'No se puede configurar un artículo como pack de sí mismo'
                });
            }
            
            // Verificar que existe el hijo en stock_real_consolidado
            const verificarHijoQuery = `
                SELECT codigo_barras, es_pack, pack_hijo_codigo
                FROM public.stock_real_consolidado 
                WHERE codigo_barras = $1
            `;
            
            const hijoResult = await pool.query(verificarHijoQuery, [hijoCodigoTrim]);
            
            if (hijoResult.rows.length === 0) {
                console.log(`❌ [PACK-MAP] Hijo no encontrado: ${hijoCodigoTrim}`);
                return res.status(400).json({
                    success: false,
                    error: `El artículo hijo '${hijoCodigoTrim}' no existe en el sistema`
                });
            }
            
            const hijoData = hijoResult.rows[0];
            console.log(`✅ [PACK-MAP] Hijo verificado: ${hijoCodigoTrim}`, { es_pack: hijoData.es_pack, pack_hijo_codigo: hijoData.pack_hijo_codigo });
            
            // ✅ VALIDACIÓN 2: Verificar ciclo directo (hijo ya tiene al padre como su hijo)
            if (hijoData.es_pack && hijoData.pack_hijo_codigo === padreCodigoTrim) {
                console.log(`❌ [PACK-MAP] Ciclo directo detectado: ${padreCodigoTrim} → ${hijoCodigoTrim} → ${padreCodigoTrim}`);
                return res.status(400).json({
                    success: false,
                    error: 'No se puede crear esta relación porque generaría una dependencia circular'
                });
            }
            
            // Actualizar mapeo pack - Buscar padre por codigo_barras o por articulo_numero desde tabla articulos
            const updateQuery = `
                UPDATE public.stock_real_consolidado
                SET es_pack = TRUE,
                    pack_hijo_codigo = $2,
                    pack_unidades = $3,
                    codigo_barras = COALESCE(codigo_barras, $1)
                WHERE codigo_barras = $1 
                   OR articulo_numero = (
                       SELECT numero FROM public.articulos 
                       WHERE codigo_barras = $1 
                       LIMIT 1
                   )
            `;
            
            const result = await pool.query(updateQuery, [padreCodigoTrim, hijoCodigoTrim, unidadesInt]);
            
            console.log(`🧩 [PACK-MAP] padre=${padreCodigoTrim} hijo=${hijoCodigoTrim} unidades=${unidadesInt} (rowCount=${result.rowCount})`);
            
            if (result.rowCount === 0) {
                return res.status(404).json({
                    success: false,
                    error: 'padre no encontrado en stock_real_consolidado'
                });
            }
            
            return res.json({ 
                success: true, 
                message: 'Mapeo pack guardado correctamente',
                mapeo: {
                    padre: padreCodigoTrim,
                    hijo: hijoCodigoTrim,
                    unidades: unidadesInt
                }
            });
        }
        
    } catch (error) {
        console.error('❌ [PACK-MAP] Error al actualizar mapeo pack:', error);
        res.status(500).json({
            success: false,
            error: 'Error interno del servidor',
            message: error.message
        });
    }
};

/**
 * Actualiza la secuencia de uno o varios presupuestos
 * 🔧 CORRECCIÓN: Cuando se marca como "Retira_Deposito", también actualiza estado y estado_logistico
 */
const actualizarSecuenciaPresupuestos = async (req, res) => {
    try {
        console.log('🔄 [SECUENCIA] Iniciando actualización de secuencia...');
        
        const { presupuestos_ids, nueva_secuencia } = req.body;
        
        // Validaciones
        if (!presupuestos_ids || !Array.isArray(presupuestos_ids) || presupuestos_ids.length === 0) {
            return res.status(400).json({
                success: false,
                error: 'presupuestos_ids es requerido y debe ser un array no vacío',
                timestamp: new Date().toISOString()
            });
        }
        
        const secuenciasValidas = ['Imprimir', 'Imprimir_Modificado', 'Armar_Pedido', 'Pedido_Listo', 'Retira_Deposito'];
        if (!nueva_secuencia || !secuenciasValidas.includes(nueva_secuencia)) {
            return res.status(400).json({
                success: false,
                error: `nueva_secuencia debe ser uno de: ${secuenciasValidas.join(', ')}`,
                timestamp: new Date().toISOString()
            });
        }
        
        console.log('📋 [SECUENCIA] Datos recibidos:', { 
            presupuestos_count: presupuestos_ids.length, 
            nueva_secuencia 
        });
        
        // 🔧 CORRECCIÓN: Determinar si necesitamos actualizar estado y estado_logistico
        let updateQuery;
        let queryParams;
        
        if (nueva_secuencia === 'Retira_Deposito') {
            // Para "Retira por Depósito": actualizar secuencia, estado y estado_logistico
            console.log('🏪 [RETIRA-DEPOSITO] Actualizando secuencia + estado + estado_logistico');
            
            updateQuery = `
                UPDATE public.presupuestos
                SET secuencia = $1,
                    estado = $2,
                    estado_logistico = $3,
                    fecha_actualizacion = CURRENT_TIMESTAMP AT TIME ZONE 'America/Argentina/Buenos_Aires'
                WHERE id_presupuesto_ext = ANY($4::text[])
                  AND activo = true
                RETURNING id_presupuesto_ext, secuencia, estado, estado_logistico
            `;
            
            queryParams = [
                nueva_secuencia,           // $1: secuencia = 'Retira_Deposito'
                'Retira por Deposito',     // $2: estado = 'Retira por Deposito' (sin tilde)
                'PENDIENTE',               // $3: estado_logistico = 'PENDIENTE'
                presupuestos_ids           // $4: array de IDs
            ];
        } else if (nueva_secuencia === 'Pedido_Listo') {
            // Para "Pedido Listo": actualizar secuencia, estado y estado_logistico
            // IMPORTANTE: Esto permite que el pedido aparezca en Logística cuando se revierte desde "Retira por Depósito"
            console.log('📦 [PEDIDO-LISTO] Actualizando secuencia + estado + estado_logistico para Logística');
            
            updateQuery = `
                UPDATE public.presupuestos
                SET secuencia = $1,
                    estado = $2,
                    estado_logistico = $3,
                    fecha_actualizacion = CURRENT_TIMESTAMP AT TIME ZONE 'America/Argentina/Buenos_Aires'
                WHERE id_presupuesto_ext = ANY($4::text[])
                  AND activo = true
                RETURNING id_presupuesto_ext, secuencia, estado, estado_logistico
            `;
            
            queryParams = [
                nueva_secuencia,           // $1: secuencia = 'Pedido_Listo'
                'Presupuesto/Orden',       // $2: estado = 'Presupuesto/Orden'
                'PENDIENTE_ASIGNAR',       // $3: estado_logistico = 'PENDIENTE_ASIGNAR' (para Logística)
                presupuestos_ids           // $4: array de IDs
            ];
        } else {
            // Para otras secuencias: solo actualizar secuencia (comportamiento original)
            updateQuery = `
                UPDATE public.presupuestos
                SET secuencia = $1,
                    fecha_actualizacion = CURRENT_TIMESTAMP AT TIME ZONE 'America/Argentina/Buenos_Aires'
                WHERE id_presupuesto_ext = ANY($2::text[])
                  AND activo = true
                RETURNING id_presupuesto_ext, secuencia
            `;
            
            queryParams = [nueva_secuencia, presupuestos_ids];
        }
        
        const result = await pool.query(updateQuery, queryParams);
        
        console.log(`✅ [SECUENCIA] Actualizados: ${result.rowCount} presupuestos`);
        
        if ((nueva_secuencia === 'Retira_Deposito' || nueva_secuencia === 'Pedido_Listo') && result.rowCount > 0) {
            const tipoOperacion = nueva_secuencia === 'Retira_Deposito' ? 'RETIRA-DEPOSITO' : 'PEDIDO-LISTO';
            console.log(`✅ [${tipoOperacion}] Campos actualizados correctamente:`);
            result.rows.forEach(row => {
                console.log(`   - Presupuesto ${row.id_presupuesto_ext}:`);
                console.log(`     * secuencia: ${row.secuencia}`);
                console.log(`     * estado: ${row.estado}`);
                console.log(`     * estado_logistico: ${row.estado_logistico}`);
            });
        }
        
        if (result.rowCount === 0) {
            return res.status(404).json({
                success: false,
                error: 'No se encontraron presupuestos activos con los IDs proporcionados',
                timestamp: new Date().toISOString()
            });
        }
        
        res.json({
            success: true,
            actualizados: result.rowCount,
            nueva_secuencia: nueva_secuencia,
            presupuestos: result.rows,
            message: `${result.rowCount} presupuesto(s) actualizado(s) a secuencia "${nueva_secuencia}"`,
            timestamp: new Date().toISOString()
        });
        
    } catch (error) {
        console.error('❌ [SECUENCIA] Error al actualizar secuencia:', error);
        res.status(500).json({
            success: false,
            error: 'Error interno del servidor',
            message: error.message,
            timestamp: new Date().toISOString()
        });
    }
};

module.exports = {
    obtenerPedidosPorCliente,
    obtenerPedidosArticulos,
    asignarFaltantes,
    actualizarPackMapping,
    actualizarSecuenciaPresupuestos
};
