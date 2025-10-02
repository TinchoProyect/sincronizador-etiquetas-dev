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
            debug
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
            WITH presupuestos_confirmados AS (
                SELECT 
                    p.id,
                    p.id_presupuesto_ext,
                    p.id_cliente,
                    p.fecha,
                    CAST(p.id_cliente AS integer) as cliente_id_int
                FROM public.presupuestos p
                WHERE p.activo = true 
                  AND REPLACE(LOWER(TRIM(p.estado)), ' ', '') = REPLACE(LOWER($1), ' ', '')
                  AND p.fecha::date <= $2::date
                  AND ($3::integer IS NULL OR CAST(p.id_cliente AS integer) = $3)
            ),
            articulos_por_presupuesto AS (
                SELECT 
                    pc.cliente_id_int,
                    ${presupuestoIdFieldMain} as presupuesto_id,
                    pc.fecha as presupuesto_fecha,
                    pd.articulo as articulo_numero,
                    SUM(COALESCE(pd.cantidad, 0)) as cantidad
                FROM presupuestos_confirmados pc
                ${joinClause}
                WHERE pd.articulo IS NOT NULL AND TRIM(pd.articulo) != ''
                GROUP BY pc.cliente_id_int, ${presupuestoIdFieldMain}, pc.fecha, pd.articulo
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
                        'presupuesto_fecha', app.presupuesto_fecha,
                        'articulo_numero', app.articulo_numero,
                        'descripcion', COALESCE(
                            NULLIF(TRIM(a.nombre), ''),
                            app.articulo_numero
                        ),
                        'pedido_total', app.cantidad,
                        'stock_disponible', CASE 
                            WHEN src.es_pack = true AND src.pack_hijo_codigo IS NOT NULL AND src.pack_unidades > 0 
                            THEN FLOOR(COALESCE(hijo.stock_consolidado, 0) / src.pack_unidades)
                            ELSE COALESCE(src.stock_consolidado, 0)
                        END,
                        'faltante', GREATEST(0, app.cantidad - 
                            CASE 
                                WHEN src.es_pack = true AND src.pack_hijo_codigo IS NOT NULL AND src.pack_unidades > 0 
                                THEN FLOOR(COALESCE(hijo.stock_consolidado, 0) / src.pack_unidades)
                                ELSE COALESCE(src.stock_consolidado, 0)
                            END
                        ),
                        'es_pack', src.es_pack,
                        'pack_hijo_codigo', src.pack_hijo_codigo,
                        'pack_unidades', src.pack_unidades,
                        'stock_hijo', hijo.stock_consolidado
                    ) ORDER BY app.presupuesto_fecha DESC, app.presupuesto_id, app.articulo_numero
                ) as articulos
            FROM articulos_por_presupuesto app
            LEFT JOIN public.clientes c ON c.cliente_id = app.cliente_id_int
            LEFT JOIN public.stock_real_consolidado src ON src.codigo_barras = app.articulo_numero
            LEFT JOIN public.stock_real_consolidado hijo ON hijo.codigo_barras = src.pack_hijo_codigo
            LEFT JOIN public.articulos a ON a.codigo_barras = app.articulo_numero
            GROUP BY app.cliente_id_int, c.nombre, c.apellido
            ORDER BY cliente_nombre;
        `;
        
        const params = [estado, fecha, cliente_id ? parseInt(cliente_id) : null];
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
            const clientesConIndicador = result.rows.map(cliente => {
                const articulos = cliente.articulos;
                let completos = 0;
                let parciales = 0;
                let faltantes = 0;
                
                articulos.forEach(art => {
                    if (art.faltante === 0) {
                        completos++;
                    } else if (art.stock_disponible > 0) {
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
        
        // Query consolidada por artículo con lógica pack-aware
        const query = `
            WITH presupuestos_confirmados AS (
                SELECT 
                    p.id,
                    p.id_presupuesto_ext,
                    p.id_cliente,
                    p.fecha,
                    CAST(p.id_cliente AS integer) as cliente_id_int
                FROM public.presupuestos p
                WHERE p.activo = true 
                  AND REPLACE(LOWER(TRIM(p.estado)), ' ', '') = REPLACE(LOWER($1), ' ', '')
                  AND p.fecha::date <= $2::date
            ),
            articulos_consolidados AS (
                SELECT 
                    pd.articulo as articulo_numero,
                    SUM(COALESCE(pd.cantidad, 0)) as pedido_total
                FROM presupuestos_confirmados pc
                ${joinClause}
                WHERE pd.articulo IS NOT NULL AND TRIM(pd.articulo) != ''
                GROUP BY pd.articulo
            )
            SELECT 
                ac.articulo_numero,
                COALESCE(
                    NULLIF(TRIM(a.nombre), ''),
                    ac.articulo_numero
                ) as descripcion,
                ac.pedido_total,
                CASE 
                    WHEN src.es_pack = true AND src.pack_hijo_codigo IS NOT NULL AND src.pack_unidades > 0 
                    THEN FLOOR(COALESCE(hijo.stock_consolidado, 0) / src.pack_unidades)
                    ELSE COALESCE(src.stock_consolidado, 0)
                END as stock_disponible,
                GREATEST(0, ac.pedido_total - 
                    CASE 
                        WHEN src.es_pack = true AND src.pack_hijo_codigo IS NOT NULL AND src.pack_unidades > 0 
                        THEN FLOOR(COALESCE(hijo.stock_consolidado, 0) / src.pack_unidades)
                        ELSE COALESCE(src.stock_consolidado, 0)
                    END
                ) as faltante,
                CASE 
                    WHEN GREATEST(0, ac.pedido_total - 
                        CASE 
                            WHEN src.es_pack = true AND src.pack_hijo_codigo IS NOT NULL AND src.pack_unidades > 0 
                            THEN FLOOR(COALESCE(hijo.stock_consolidado, 0) / src.pack_unidades)
                            ELSE COALESCE(src.stock_consolidado, 0)
                        END
                    ) = 0 THEN 'COMPLETO'
                    WHEN CASE 
                            WHEN src.es_pack = true AND src.pack_hijo_codigo IS NOT NULL AND src.pack_unidades > 0 
                            THEN FLOOR(COALESCE(hijo.stock_consolidado, 0) / src.pack_unidades)
                            ELSE COALESCE(src.stock_consolidado, 0)
                        END > 0 THEN 'PARCIAL'
                    ELSE 'FALTANTE'
                END as estado,
                src.es_pack,
                src.pack_hijo_codigo,
                src.pack_unidades,
                hijo.stock_consolidado as stock_hijo
            FROM articulos_consolidados ac
            LEFT JOIN public.stock_real_consolidado src ON src.codigo_barras = ac.articulo_numero
            LEFT JOIN public.stock_real_consolidado hijo ON hijo.codigo_barras = src.pack_hijo_codigo
            LEFT JOIN public.articulos a ON a.codigo_barras = ac.articulo_numero
            ORDER BY ac.articulo_numero;
        `;
        
        const params = ['presupuesto/orden', fecha];
        console.log('🔍 [PROD_ART] Ejecutando consulta con parámetros:', params);
        
        const result = await pool.query(query, params);
        
        // Aplicar filtros adicionales
        let articulos = result.rows;
        
        // Filtro por texto (q)
        if (q && q.trim()) {
            const filtroTexto = q.trim().toLowerCase();
            articulos = articulos.filter(art => 
                art.articulo_numero.toLowerCase().includes(filtroTexto) ||
                art.descripcion.toLowerCase().includes(filtroTexto)
            );
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

        // Limpiar campos internos del response
        articulos = articulos.map(art => {
            const { es_pack, pack_hijo_codigo, pack_unidades, stock_hijo, ...articuloLimpio } = art;
            return articuloLimpio;
        });

        // Actualizar response con datos limpios
        response.data = articulos;
        
        console.log(`✅ [PROD_ART] Consulta exitosa: ${articulos.length} artículos encontrados`);
        console.log(`📊 [PROD_ART] Totales: ${totales.faltantes} faltantes, ${totales.parciales} parciales, ${totales.completos} completos`);
        
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
 */
const actualizarPackMapping = async (req, res) => {
    try {
        console.log('🧩 [PACK-MAP] Iniciando actualización de mapeo pack...');
        
        const { padre_codigo_barras, hijo_codigo_barras, unidades } = req.body;
        
        // Validación padre_codigo_barras requerido
        if (!padre_codigo_barras || typeof padre_codigo_barras !== 'string' || !padre_codigo_barras.trim()) {
            return res.status(400).json({
                success: false,
                error: 'padre_codigo_barras es requerido y debe ser un string válido'
            });
        }
        
        console.log('📋 [PACK-MAP] Datos recibidos:', { padre_codigo_barras, hijo_codigo_barras, unidades });
        
        // Determinar si es guardar o quitar mapeo
        const esQuitarMapeo = hijo_codigo_barras === null || hijo_codigo_barras === undefined;
        
        if (esQuitarMapeo) {
            // QUITAR MAPEO - Buscar padre por codigo_barras o por articulo_numero desde tabla articulos
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
            
            const result = await pool.query(query, [padre_codigo_barras.trim()]);
            
            console.log(`🧩 [PACK-MAP] padre=${padre_codigo_barras} mapeo=ELIMINADO (rowCount=${result.rowCount})`);
            
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
            if (!hijo_codigo_barras || typeof hijo_codigo_barras !== 'string' || !hijo_codigo_barras.trim()) {
                return res.status(400).json({
                    success: false,
                    error: 'hijo_codigo_barras es requerido y debe ser un string válido'
                });
            }
            
            if (!unidades || !Number.isInteger(Number(unidades)) || Number(unidades) <= 0) {
                return res.status(400).json({
                    success: false,
                    error: 'unidades debe ser un entero mayor a 0'
                });
            }
            
            const unidadesInt = parseInt(unidades);
            const hijoCodigoTrim = hijo_codigo_barras.trim();
            const padreCodigoTrim = padre_codigo_barras.trim();
            
            // Verificar que existe el hijo en stock_real_consolidado
            const verificarHijoQuery = `
                SELECT codigo_barras 
                FROM public.stock_real_consolidado 
                WHERE codigo_barras = $1
            `;
            
            const hijoResult = await pool.query(verificarHijoQuery, [hijoCodigoTrim]);
            
            if (hijoResult.rows.length === 0) {
                console.log(`❌ [PACK-MAP] Hijo no encontrado: ${hijoCodigoTrim}`);
                return res.status(400).json({
                    success: false,
                    error: `El artículo hijo '${hijoCodigoTrim}' no existe en stock_real_consolidado`
                });
            }
            
            console.log(`✅ [PACK-MAP] Hijo verificado: ${hijoCodigoTrim}`);
            
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

module.exports = {
    obtenerPedidosPorCliente,
    obtenerPedidosArticulos,
    asignarFaltantes,
    actualizarPackMapping
};
