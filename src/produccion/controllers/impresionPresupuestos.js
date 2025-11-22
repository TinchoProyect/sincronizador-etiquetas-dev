const pool = require('../config/database');

/**
 * Guardar snapshot de presupuesto al imprimir
 * @param {number} id_presupuesto - ID interno del presupuesto
 * @param {string} id_presupuesto_ext - ID externo del presupuesto
 * @param {Array} detalles - Array de artículos del presupuesto
 * @param {string} secuencia - Secuencia actual del presupuesto
 */
async function guardarSnapshotImpresion(id_presupuesto, id_presupuesto_ext, detalles, secuencia) {
    console.log(`📸 [SNAPSHOT] Guardando snapshot para presupuesto ID: ${id_presupuesto} (${id_presupuesto_ext})`);
    
    const client = await pool.connect();
    
    try {
        await client.query('BEGIN');
        
        // Desactivar snapshots anteriores
        const desactivarQuery = `
            UPDATE presupuestos_snapshots 
            SET activo = false 
            WHERE id_presupuesto = $1 AND activo = true
        `;
        const desactivarResult = await client.query(desactivarQuery, [id_presupuesto]);
        console.log(`📸 [SNAPSHOT] Snapshots anteriores desactivados: ${desactivarResult.rowCount}`);
        
        // Construir snapshot_detalles como array JSON
        const snapshot_detalles = detalles.map(item => ({
            articulo: item.articulo_numero || item.articulo,
            cantidad: item.cantidad || 0,
            valor1: item.valor1 || 0,
            precio1: item.precio1 || item.valor1 || 0,
            descripcion: item.descripcion || ''
        }));
        
        // Determinar secuencia_en_snapshot según el motivo
        const motivo = 'primera_impresion';
        let secuencia_en_snapshot;
        
        if (motivo === 'primera_impresion') {
            // Para primera impresión, SIEMPRE usar 'Armar_Pedido'
            secuencia_en_snapshot = 'Armar_Pedido';
            console.log(`📸 [SNAPSHOT] Motivo: ${motivo} -> forzando secuencia_en_snapshot = 'Armar_Pedido'`);
        } else {
            // Para otros motivos, usar la secuencia real del presupuesto
            secuencia_en_snapshot = secuencia || null;
            console.log(`📸 [SNAPSHOT] Motivo: ${motivo} -> usando secuencia real: ${secuencia || 'NULL'}`);
        }
        
        // Insertar nuevo snapshot
        const insertQuery = `
            INSERT INTO presupuestos_snapshots (
                id_presupuesto,
                id_presupuesto_ext,
                snapshot_detalles,
                secuencia_en_snapshot,
                motivo,
                activo
            ) VALUES ($1, $2, $3, $4, $5, $6)
            RETURNING id, fecha_snapshot
        `;
        
        const insertValues = [
            id_presupuesto,
            id_presupuesto_ext,
            JSON.stringify(snapshot_detalles),
            secuencia_en_snapshot,
            motivo,
            true
        ];
        
        const insertResult = await client.query(insertQuery, insertValues);
        const snapshot = insertResult.rows[0];
        
        await client.query('COMMIT');
        
        console.log(`✅ [SNAPSHOT] Snapshot guardado exitosamente - ID: ${snapshot.id}, Fecha: ${snapshot.fecha_snapshot}`);
        console.log(`📸 [SNAPSHOT] Detalles: ${snapshot_detalles.length} artículos, Secuencia: ${secuencia || 'N/A'}`);
        
        return {
            success: true,
            snapshot_id: snapshot.id,
            fecha_snapshot: snapshot.fecha_snapshot
        };
        
    } catch (error) {
        await client.query('ROLLBACK');
        console.error('❌ [SNAPSHOT] Error al guardar snapshot:', error.message);
        console.error('❌ [SNAPSHOT] Stack:', error.stack);
        // No lanzar error - la impresión debe continuar
        return {
            success: false,
            error: error.message
        };
    } finally {
        client.release();
    }
}

/**
 * Genera impresión de presupuesto por cliente en formato remito rediseñado (PDF o HTML)
 * REDISEÑO: Formato R compacto, moderno y minimalista
 */
const imprimirPresupuestoCliente = async (req, res) => {
    try {
        console.log('🔍 [REMITO-R] Iniciando impresión de remito rediseñado...');
        
        const { 
            cliente_id, 
            presupuesto_id,
            presupuestos_ext_ids,
            fecha,
            fecha_desde, 
            fecha_hasta, 
            formato = 'html',
            pendiente_compra = 'false'
        } = req.query;
        
        const esPendienteCompra = pendiente_compra === 'true';
        
        if (esPendienteCompra) {
            console.log('🛒 [REMITO-R] MODO PENDIENTE DE COMPRA activado');
        }
        
        // Validaciones - cliente_id es opcional si se proporciona fecha o presupuestos_ext_ids
        if (!cliente_id && !fecha && !presupuestos_ext_ids) {
            console.log('❌ [REMITO-R] Debe proporcionar cliente_id, fecha o presupuestos_ext_ids');
            return res.status(400).json({
                success: false,
                error: 'Debe proporcionar cliente_id, fecha o presupuestos_ext_ids',
                timestamp: new Date().toISOString()
            });
        }
        
        if (cliente_id && isNaN(parseInt(cliente_id))) {
            console.log('❌ [REMITO-R] cliente_id inválido:', cliente_id);
            return res.status(400).json({
                success: false,
                error: 'cliente_id debe ser un número válido',
                timestamp: new Date().toISOString()
            });
        }
        
        if (fecha && !fecha.match(/^\d{4}-\d{2}-\d{2}$/)) {
            return res.status(400).json({
                success: false,
                error: 'fecha debe tener formato YYYY-MM-DD',
                timestamp: new Date().toISOString()
            });
        }
        
        if (fecha_desde && !fecha_desde.match(/^\d{4}-\d{2}-\d{2}$/)) {
            return res.status(400).json({
                success: false,
                error: 'fecha_desde debe tener formato YYYY-MM-DD',
                timestamp: new Date().toISOString()
            });
        }
        
        if (fecha_hasta && !fecha_hasta.match(/^\d{4}-\d{2}-\d{2}$/)) {
            return res.status(400).json({
                success: false,
                error: 'fecha_hasta debe tener formato YYYY-MM-DD',
                timestamp: new Date().toISOString()
            });
        }
        
        console.log('📋 [REMITO-R] Parámetros impresión:', { cliente_id, presupuesto_id, fecha, fecha_desde, fecha_hasta, formato });
        
        // Determinar el tipo de consulta según los parámetros
        let query, params, result;
        
        if (cliente_id) {
            // CASO 1 y 2: Por cliente (con o sin presupuesto_id específico)
            query = `
                WITH presupuestos_filtrados AS (
                    SELECT 
                        p.id,
                        p.id_presupuesto_ext,
                        p.id_cliente,
                        p.fecha
                    FROM public.presupuestos p
                    WHERE p.activo = true 
                      AND CAST(p.id_cliente AS integer) = $1
                      AND REPLACE(LOWER(TRIM(p.estado)), ' ', '') = 'presupuesto/orden'
                      AND ($2::text IS NULL OR p.id_presupuesto_ext = $2)
                      AND ($3::date IS NULL OR p.fecha <= $3)
                )
                SELECT 
                    c.cliente_id,
                    COALESCE(
                        NULLIF(TRIM(c.nombre || ' ' || COALESCE(c.apellido, '')), ''),
                        NULLIF(TRIM(c.nombre), ''),
                        'Cliente ' || c.cliente_id
                    ) as cliente_nombre,
                    JSON_AGG(
                        JSON_BUILD_OBJECT(
                            'id_presupuesto_ext', pf.id_presupuesto_ext,
                            'fecha', pf.fecha,
                            'articulos', (
                                SELECT JSON_AGG(
                                    JSON_BUILD_OBJECT(
                                        'articulo_numero', pd.articulo,
                                        'descripcion', COALESCE(
                                            NULLIF(TRIM(a.nombre), ''),
                                            pd.articulo
                                        ),
                                        'cantidad', COALESCE(pd.cantidad, 0)
                                    ) ORDER BY pd.articulo
                                )
                                FROM public.presupuestos_detalles pd
                                LEFT JOIN public.articulos a ON a.codigo_barras = pd.articulo
                                WHERE pd.id_presupuesto_ext = pf.id_presupuesto_ext
                            )
                        ) ORDER BY pf.fecha DESC
                    ) as presupuestos
                FROM public.clientes c
                CROSS JOIN presupuestos_filtrados pf
                WHERE c.cliente_id = $1
                GROUP BY c.cliente_id, c.nombre, c.apellido;
            `;
            
            params = [
                parseInt(cliente_id),
                presupuesto_id || null,
                fecha || fecha_hasta || null
            ];
            
            console.log('🔍 [REMITO-R] Consulta por cliente con parámetros:', params);
            result = await pool.query(query, params);
            
            if (result.rows.length === 0) {
                console.log('❌ [REMITO-R] Cliente no encontrado o sin presupuestos confirmados:', cliente_id);
                return res.status(404).json({
                    success: false,
                    error: 'Cliente no encontrado o sin presupuestos confirmados',
                    detalle: 'No se encontraron presupuestos con estado "Presupuesto/Orden" para este cliente',
                    cliente_id: parseInt(cliente_id),
                    timestamp: new Date().toISOString()
                });
            }
            
            const clienteData = result.rows[0];
            console.log(`✅ [REMITO-R] Datos obtenidos para cliente: ${clienteData.cliente_nombre}`);
            console.log(`📊 [REMITO-R] Total presupuestos encontrados: ${clienteData.presupuestos.length}`);
            
            // 📸 GUARDAR SNAPSHOTS para cada presupuesto que se va a imprimir
            console.log('📸 [SNAPSHOT] Iniciando guardado de snapshots para presupuestos a imprimir...');
            for (const presupuesto of clienteData.presupuestos) {
                try {
                    // Obtener id_presupuesto y secuencia desde la BD
                    const presupuestoQuery = `
                        SELECT id, secuencia 
                        FROM public.presupuestos 
                        WHERE id_presupuesto_ext = $1 AND activo = true
                        LIMIT 1
                    `;
                    const presupuestoResult = await pool.query(presupuestoQuery, [presupuesto.id_presupuesto_ext]);
                    
                    if (presupuestoResult.rows.length > 0) {
                        const { id: id_presupuesto, secuencia } = presupuestoResult.rows[0];
                        
                        // Guardar snapshot (no bloquea la impresión si falla)
                        await guardarSnapshotImpresion(
                            id_presupuesto,
                            presupuesto.id_presupuesto_ext,
                            presupuesto.articulos || [],
                            secuencia
                        );
                    } else {
                        console.log(`⚠️ [SNAPSHOT] No se encontró presupuesto con id_ext: ${presupuesto.id_presupuesto_ext}`);
                    }
                } catch (snapshotError) {
                    console.error(`❌ [SNAPSHOT] Error al guardar snapshot para ${presupuesto.id_presupuesto_ext}:`, snapshotError.message);
                    // Continuar con la impresión aunque falle el snapshot
                }
            }
            console.log('📸 [SNAPSHOT] Proceso de snapshots completado');
            
            // Si es pendiente de compra, obtener artículos en falta
            // IMPORTANTE: Usar la misma lógica que comprasPendientes.js con codigo_barras_real
            let articulosEnFalta = [];
            if (esPendienteCompra && presupuesto_id) {
                console.log('🛒 [REMITO-R] Obteniendo artículos en falta para presupuesto:', presupuesto_id);
                try {
                    const faltantesQuery = `
                        SELECT DISTINCT 
                            fpc.articulo_numero,
                            fpc.codigo_barras,
                            COALESCE(a.codigo_barras, src.codigo_barras, fpc.codigo_barras, fpc.articulo_numero) as codigo_barras_real
                        FROM faltantes_pendientes_compra fpc
                        LEFT JOIN public.stock_real_consolidado src ON src.articulo_numero = fpc.articulo_numero
                        LEFT JOIN public.articulos a ON a.codigo_barras = fpc.articulo_numero
                        WHERE fpc.id_presupuesto_ext = $1
                          AND fpc.estado = 'En espera'
                    `;
                    const faltantesResult = await pool.query(faltantesQuery, [presupuesto_id]);
                    // Usar codigo_barras_real que es el que coincide con articulo_numero en presupuestos_detalles
                    articulosEnFalta = faltantesResult.rows.map(r => r.codigo_barras_real);
                    console.log('🛒 [REMITO-R] Artículos en falta encontrados (codigo_barras_real):', articulosEnFalta);
                } catch (error) {
                    console.error('❌ [REMITO-R] Error al obtener artículos en falta:', error.message);
                    // Continuar sin artículos en falta si hay error
                    articulosEnFalta = [];
                }
            }
            
            if (formato === 'pdf') {
                return generarPDF_Rediseñado(res, clienteData, esPendienteCompra, articulosEnFalta);
            } else {
                return generarHTML_Rediseñado(res, clienteData, esPendienteCompra, articulosEnFalta);
            }
            
        } else if (presupuestos_ext_ids) {
            // CASO 3: Por lista de IDs externos (para "Imprimir todos" del acordeón)
            const idsArray = presupuestos_ext_ids.split(',').map(id => id.trim()).filter(id => id);
            console.log(`📋 [REMITO-R] Filtrando por ${idsArray.length} IDs externos:`, idsArray);
            
            const placeholders = idsArray.map((_, index) => `$${index + 1}`).join(',');
            
            query = `
                WITH presupuestos_filtrados AS (
                    SELECT 
                        p.id,
                        p.id_presupuesto_ext,
                        p.id_cliente,
                        p.fecha,
                        CAST(p.id_cliente AS integer) as cliente_id_int
                    FROM public.presupuestos p
                    WHERE p.activo = true 
                      AND REPLACE(LOWER(TRIM(p.estado)), ' ', '') = 'presupuesto/orden'
                      AND p.id_presupuesto_ext IN (${placeholders})
                )
                SELECT 
                    JSON_AGG(
                        JSON_BUILD_OBJECT(
                            'cliente_id', c.cliente_id,
                            'cliente_nombre', COALESCE(
                                NULLIF(TRIM(c.nombre || ' ' || COALESCE(c.apellido, '')), ''),
                                NULLIF(TRIM(c.nombre), ''),
                                'Cliente ' || c.cliente_id
                            ),
                            'presupuestos', (
                                SELECT JSON_AGG(
                                    JSON_BUILD_OBJECT(
                                        'id_presupuesto_ext', pf2.id_presupuesto_ext,
                                        'fecha', pf2.fecha,
                                        'articulos', (
                                            SELECT JSON_AGG(
                                                JSON_BUILD_OBJECT(
                                                    'articulo_numero', pd.articulo,
                                                    'descripcion', COALESCE(
                                                        NULLIF(TRIM(a.nombre), ''),
                                                        pd.articulo
                                                    ),
                                                    'cantidad', COALESCE(pd.cantidad, 0)
                                                ) ORDER BY pd.articulo
                                            )
                                            FROM public.presupuestos_detalles pd
                                            LEFT JOIN public.articulos a ON a.codigo_barras = pd.articulo
                                            WHERE pd.id_presupuesto_ext = pf2.id_presupuesto_ext
                                        )
                                    ) ORDER BY pf2.fecha DESC
                                )
                                FROM presupuestos_filtrados pf2
                                WHERE pf2.cliente_id_int = c.cliente_id
                            )
                        ) ORDER BY c.cliente_id
                    ) as clientes_data
                FROM public.clientes c
                WHERE EXISTS (
                    SELECT 1 FROM presupuestos_filtrados pf3
                    WHERE pf3.cliente_id_int = c.cliente_id
                );
            `;
            
            params = idsArray;
            
            console.log('🔍 [REMITO-R] Consulta por IDs externos con parámetros:', params);
            result = await pool.query(query, params);
            
            if (result.rows.length === 0 || !result.rows[0].clientes_data) {
                console.log('❌ [REMITO-R] No se encontraron presupuestos para los IDs externos');
                return res.status(404).json({
                    success: false,
                    error: 'No se encontraron presupuestos confirmados',
                    detalle: 'No hay presupuestos con estado "Presupuesto/Orden" para los IDs externos especificados',
                    presupuestos_ext_ids: idsArray,
                    timestamp: new Date().toISOString()
                });
            }
            
            const clientesData = result.rows[0].clientes_data;
            console.log(`✅ [REMITO-R] Datos obtenidos para ${clientesData.length} clientes con IDs externos`);
            
            // 📸 GUARDAR SNAPSHOTS para cada presupuesto que se va a imprimir
            console.log('📸 [SNAPSHOT] Iniciando guardado de snapshots para "Imprimir Todos"...');
            for (const cliente of clientesData) {
                for (const presupuesto of cliente.presupuestos) {
                    try {
                        // Obtener id_presupuesto y secuencia desde la BD
                        const presupuestoQuery = `
                            SELECT id, secuencia 
                            FROM public.presupuestos 
                            WHERE id_presupuesto_ext = $1 AND activo = true
                            LIMIT 1
                        `;
                        const presupuestoResult = await pool.query(presupuestoQuery, [presupuesto.id_presupuesto_ext]);
                        
                        if (presupuestoResult.rows.length > 0) {
                            const { id: id_presupuesto, secuencia } = presupuestoResult.rows[0];
                            
                            // Guardar snapshot (no bloquea la impresión si falla)
                            await guardarSnapshotImpresion(
                                id_presupuesto,
                                presupuesto.id_presupuesto_ext,
                                presupuesto.articulos || [],
                                secuencia
                            );
                        } else {
                            console.log(`⚠️ [SNAPSHOT] No se encontró presupuesto con id_ext: ${presupuesto.id_presupuesto_ext}`);
                        }
                    } catch (snapshotError) {
                        console.error(`❌ [SNAPSHOT] Error al guardar snapshot para ${presupuesto.id_presupuesto_ext}:`, snapshotError.message);
                        // Continuar con la impresión aunque falle el snapshot
                    }
                }
            }
            console.log('📸 [SNAPSHOT] Proceso de snapshots completado para "Imprimir Todos"');
            
            if (formato === 'pdf') {
                return generarPDF_TodosLosClientes(res, clientesData, fecha);
            } else {
                return generarHTML_TodosLosClientes(res, clientesData, fecha);
            }
            
        } else {
            // CASO 4: Todos los presupuestos por fecha (sin cliente específico)
            query = `
                WITH presupuestos_filtrados AS (
                    SELECT 
                        p.id,
                        p.id_presupuesto_ext,
                        p.id_cliente,
                        p.fecha,
                        CAST(p.id_cliente AS integer) as cliente_id_int
                    FROM public.presupuestos p
                    WHERE p.activo = true 
                      AND REPLACE(LOWER(TRIM(p.estado)), ' ', '') = 'presupuesto/orden'
                      AND p.fecha::date <= $1::date
                )
                SELECT 
                    JSON_AGG(
                        JSON_BUILD_OBJECT(
                            'cliente_id', c.cliente_id,
                            'cliente_nombre', COALESCE(
                                NULLIF(TRIM(c.nombre || ' ' || COALESCE(c.apellido, '')), ''),
                                NULLIF(TRIM(c.nombre), ''),
                                'Cliente ' || c.cliente_id
                            ),
                            'presupuestos', (
                                SELECT JSON_AGG(
                                    JSON_BUILD_OBJECT(
                                        'id_presupuesto_ext', pf2.id_presupuesto_ext,
                                        'fecha', pf2.fecha,
                                        'articulos', (
                                            SELECT JSON_AGG(
                                                JSON_BUILD_OBJECT(
                                                    'articulo_numero', pd.articulo,
                                                    'descripcion', COALESCE(
                                                        NULLIF(TRIM(a.nombre), ''),
                                                        pd.articulo
                                                    ),
                                                    'cantidad', COALESCE(pd.cantidad, 0)
                                                ) ORDER BY pd.articulo
                                            )
                                            FROM public.presupuestos_detalles pd
                                            LEFT JOIN public.articulos a ON a.codigo_barras = pd.articulo
                                            WHERE pd.id_presupuesto_ext = pf2.id_presupuesto_ext
                                        )
                                    ) ORDER BY pf2.fecha DESC
                                )
                                FROM presupuestos_filtrados pf2
                                WHERE pf2.cliente_id_int = c.cliente_id
                            )
                        ) ORDER BY c.cliente_id
                    ) as clientes_data
                FROM public.clientes c
                WHERE EXISTS (
                    SELECT 1 FROM presupuestos_filtrados pf3
                    WHERE pf3.cliente_id_int = c.cliente_id
                );
            `;
            
            params = [fecha || new Date().toISOString().split('T')[0]];
            
            console.log('🔍 [REMITO-R] Consulta general por fecha con parámetros:', params);
            result = await pool.query(query, params);
            
            if (result.rows.length === 0 || !result.rows[0].clientes_data) {
                console.log('❌ [REMITO-R] No se encontraron presupuestos confirmados para la fecha:', fecha);
                return res.status(404).json({
                    success: false,
                    error: 'No se encontraron presupuestos confirmados',
                    detalle: 'No hay presupuestos con estado "Presupuesto/Orden" para la fecha especificada',
                    fecha: fecha || new Date().toISOString().split('T')[0],
                    timestamp: new Date().toISOString()
                });
            }
            
            const clientesData = result.rows[0].clientes_data;
            console.log(`✅ [REMITO-R] Datos obtenidos para ${clientesData.length} clientes`);
            
            // 📸 GUARDAR SNAPSHOTS para cada presupuesto que se va a imprimir
            console.log('📸 [SNAPSHOT] Iniciando guardado de snapshots para impresión por fecha...');
            for (const cliente of clientesData) {
                for (const presupuesto of cliente.presupuestos) {
                    try {
                        // Obtener id_presupuesto y secuencia desde la BD
                        const presupuestoQuery = `
                            SELECT id, secuencia 
                            FROM public.presupuestos 
                            WHERE id_presupuesto_ext = $1 AND activo = true
                            LIMIT 1
                        `;
                        const presupuestoResult = await pool.query(presupuestoQuery, [presupuesto.id_presupuesto_ext]);
                        
                        if (presupuestoResult.rows.length > 0) {
                            const { id: id_presupuesto, secuencia } = presupuestoResult.rows[0];
                            
                            // Guardar snapshot (no bloquea la impresión si falla)
                            await guardarSnapshotImpresion(
                                id_presupuesto,
                                presupuesto.id_presupuesto_ext,
                                presupuesto.articulos || [],
                                secuencia
                            );
                        } else {
                            console.log(`⚠️ [SNAPSHOT] No se encontró presupuesto con id_ext: ${presupuesto.id_presupuesto_ext}`);
                        }
                    } catch (snapshotError) {
                        console.error(`❌ [SNAPSHOT] Error al guardar snapshot para ${presupuesto.id_presupuesto_ext}:`, snapshotError.message);
                        // Continuar con la impresión aunque falle el snapshot
                    }
                }
            }
            console.log('📸 [SNAPSHOT] Proceso de snapshots completado para impresión por fecha');
            
            if (formato === 'pdf') {
                return generarPDF_TodosLosClientes(res, clientesData, fecha);
            } else {
                return generarHTML_TodosLosClientes(res, clientesData, fecha);
            }
        }
        
    } catch (error) {
        console.error('❌ [REMITO-R] Error en impresión:', error);
        console.error('❌ [REMITO-R] Stack trace:', error.stack);
        res.status(500).json({
            success: false,
            error: 'Error interno del servidor',
            message: error.message,
            timestamp: new Date().toISOString()
        });
    }
};

/**
 * Genera HTML en formato remito rediseñado (Formato R)
 * REDISEÑO: Una hoja por presupuesto cuando hay múltiples
 * @param {boolean} esPendienteCompra - Si es true, muestra "ORDEN EN ESPERA" y marca artículos en falta
 * @param {Array} articulosEnFalta - Array de códigos de artículos que están en falta
 */
function generarHTML_Rediseñado(res, clienteData, esPendienteCompra = false, articulosEnFalta = []) {
    try {
        const fechaHoy = new Date().toLocaleDateString('es-AR', {
            year: 'numeric',
            month: '2-digit',
            day: '2-digit'
        });
        const horaHoy = new Date().toLocaleTimeString('es-AR', {
            hour: '2-digit',
            minute: '2-digit'
        });
        
        let html = `
<!DOCTYPE html>
<html lang="es">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Remito R - Cliente ${clienteData.cliente_id}</title>
    <style>
        @page {
            size: A4;
            margin: 1.5cm;
        }
        
        body { 
            font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; 
            margin: 0; 
            padding: 0;
            line-height: 1.3; 
            color: #000;
            font-size: 11px;
        }
        
        .remito-container {
            max-width: 100%;
            margin: 0 auto;
            padding: 15px;
        }
        
        .page-break {
            page-break-after: always;
        }
        
        /* ENCABEZADO MODERNO Y MINIMALISTA */
        .header { 
            display: flex;
            justify-content: space-between;
            align-items: center;
            margin-bottom: 20px; 
            border-bottom: 1px solid #333; 
            padding-bottom: 12px; 
        }
        
        .header-left {
            display: flex;
            align-items: center;
            gap: 15px;
        }
        
        .logo-lamda { 
            font-size: 24px; 
            font-weight: 300; 
            letter-spacing: 2px;
            color: #000;
        }
        
        .letra-r {
            font-size: 36px;
            font-weight: bold;
            color: #000;
            border: 2px solid #000;
            width: 50px;
            height: 50px;
            display: flex;
            align-items: center;
            justify-content: center;
            border-radius: 4px;
        }
        
        /* ESTILOS PARA ORDEN EN ESPERA */
        .orden-espera {
            font-size: 9px;
            font-weight: bold;
            color: #dc3545;
            border: 2px solid #dc3545;
            background: #fff3cd;
            padding: 6px 10px;
            border-radius: 4px;
            text-align: center;
            line-height: 1.2;
            letter-spacing: 0.5px;
        }
        
        /* Artículos en falta - fondo amarillo */
        .articulo-en-falta {
            background-color: #fff3cd !important;
            border-left: 4px solid #ffc107 !important;
        }
        
        .articulo-en-falta td {
            font-weight: 600 !important;
            color: #856404 !important;
        }
        
        /* Separador de secciones */
        .seccion-titulo {
            background: #f8f9fa;
            padding: 6px 8px;
            margin: 12px 0 5px 0;
            border-left: 4px solid #6c757d;
            font-weight: bold;
            font-size: 10px;
            text-transform: uppercase;
        }
        
        .seccion-titulo.en-falta {
            background: #fff3cd;
            border-left-color: #ffc107;
            color: #856404;
        }
        
        .fecha-emision { 
            font-size: 10px; 
            text-align: right;
            color: #666;
        }
        
        /* DATOS DEL PEDIDO - COMPACTOS */
        .datos-pedido { 
            display: flex;
            justify-content: space-between;
            margin-bottom: 15px; 
            padding: 8px 0;
            border-bottom: 1px solid #eee;
        }
        
        .numero-cliente {
            font-size: 14px;
            font-weight: bold;
        }
        
        .nombre-cliente {
            font-size: 12px;
            color: #333;
        }
        
        .codigo-presupuesto {
            font-size: 11px;
            font-family: monospace;
            background: #f5f5f5;
            padding: 2px 6px;
            border-radius: 3px;
        }
        
        /* TABLA DE ARTÍCULOS - COMPACTA */
        .articulos-tabla { 
            width: 100%; 
            border-collapse: collapse; 
            margin: 10px 0; 
            font-size: 10px;
        }
        
        .articulos-tabla th { 
            background-color: #f8f9fa; 
            font-weight: 600; 
            text-align: left;
            padding: 6px 4px;
            border: 1px solid #dee2e6;
            font-size: 9px;
            text-transform: uppercase;
            letter-spacing: 0.5px;
        }
        
        .articulos-tabla td { 
            padding: 4px; 
            border: 1px solid #dee2e6; 
            vertical-align: top;
        }
        
        .articulos-tabla .col-codigo {
            width: 20%;
            font-family: monospace;
            font-size: 9px;
            background: #fafafa;
        }
        
        .articulos-tabla .col-descripcion {
            width: 65%;
            word-wrap: break-word;
        }
        
        .articulos-tabla .col-cantidad {
            width: 15%;
            text-align: center;
            font-weight: 600;
        }
        
        /* CONTROL DE ENTREGA - REDISEÑADO */
        .control-entrega {
            margin-top: 25px;
            border: 1px solid #333;
            padding: 12px;
            background: #fafafa;
        }
        
        .control-entrega h4 {
            margin: 0 0 12px 0;
            font-size: 11px;
            text-align: center;
            font-weight: 600;
            text-transform: uppercase;
            letter-spacing: 1px;
        }
        
        .campos-control {
            display: grid;
            grid-template-columns: 1fr 1fr;
            gap: 15px;
            margin-bottom: 12px;
        }
        
        .campo-firma {
            border-bottom: 1px solid #333;
            padding-bottom: 3px;
            min-height: 20px;
        }
        
        .campo-firma label {
            font-size: 9px;
            font-weight: 600;
            color: #666;
            text-transform: uppercase;
        }
        
        .campo-entregado {
            grid-column: 1 / -1;
            border-bottom: 1px solid #333;
            padding-bottom: 3px;
            min-height: 20px;
        }
        
        .nota-importante {
            margin-top: 10px;
            padding: 6px;
            background-color: #fff3cd;
            border: 1px solid #ffeaa7;
            border-radius: 3px;
            font-size: 8px;
            text-align: justify;
            color: #856404;
        }
        
        /* PIE DE PÁGINA MINIMALISTA */
        .pie-pagina {
            margin-top: 15px;
            text-align: center;
            font-size: 8px;
            color: #999;
            border-top: 1px solid #eee;
            padding-top: 8px;
        }
        
        /* ESTILOS DE IMPRESIÓN */
        @media print {
            body { 
                margin: 0; 
                font-size: 10px;
            }
            
            .remito-container {
                padding: 0;
            }
            
            .header {
                margin-bottom: 15px;
                padding-bottom: 8px;
            }
            
            .control-entrega {
                page-break-inside: avoid;
                margin-top: 20px;
            }
        }
    </style>
</head>
<body>
    <div class="remito-container">
        <!-- ENCABEZADO MODERNO -->
        <div class="header">
            <div class="header-left">
                <div class="logo-lamda">LAMDA</div>
                <div class="letra-r">R</div>
            </div>
            <div class="fecha-emision">
                ${fechaHoy} - ${horaHoy}
            </div>
        </div>
        
`;
        
        // Log de debug
        console.log('🛒 [REMITO-R-HTML] esPendienteCompra:', esPendienteCompra);
        console.log('🛒 [REMITO-R-HTML] articulosEnFalta:', articulosEnFalta);
        console.log('🛒 [REMITO-R-HTML] articulosEnFalta.length:', articulosEnFalta.length);
        
        // Generar una página por cada presupuesto
        clienteData.presupuestos.forEach((presupuesto, presupIndex) => {
            const fechaPresupuesto = new Date(presupuesto.fecha).toLocaleDateString('es-AR');
            
            console.log(`🛒 [REMITO-R-HTML] Presupuesto ${presupIndex}: ${presupuesto.id_presupuesto_ext}`);
            console.log(`🛒 [REMITO-R-HTML] Aplicando título: ${esPendienteCompra ? 'ORDEN EN ESPERA' : 'R'}`);
            
            html += `
    <div class="remito-container${presupIndex < clienteData.presupuestos.length - 1 ? ' page-break' : ''}">
        <!-- ENCABEZADO MODERNO -->
        <div class="header">
            <div class="header-left">
                <div class="logo-lamda">LAMDA</div>
                ${esPendienteCompra ? 
                    '<div class="orden-espera">ORDEN EN ESPERA</div>' : 
                    '<div class="letra-r">R</div>'
                }
            </div>
            <div class="fecha-emision">
                ${fechaHoy} - ${horaHoy}
            </div>
        </div>
        
        <!-- DATOS DEL PEDIDO -->
        <div class="datos-pedido">
            <div>
                <div class="numero-cliente">N° de Cliente: ${clienteData.cliente_id}</div>
                <div class="nombre-cliente">${clienteData.cliente_nombre}</div>
            </div>
            <div>
                <div class="codigo-presupuesto">${presupuesto.id_presupuesto_ext}</div>
                <div style="font-size: 10px; color: #666; margin-top: 4px;">Fecha: ${fechaPresupuesto}</div>
            </div>
        </div>
        
        <!-- TABLA DE ARTÍCULOS -->
        <table class="articulos-tabla">
            <thead>
                <tr>
                    <th class="col-codigo">Código</th>
                    <th class="col-descripcion">Descripción del Artículo</th>
                    <th class="col-cantidad">Cantidad</th>
                </tr>
            </thead>
            <tbody>
`;
            
            // Mostrar artículos de ESTE presupuesto
            if (presupuesto.articulos && presupuesto.articulos.length > 0) {
                const articulosSorted = presupuesto.articulos.sort((a, b) => a.articulo_numero.localeCompare(b.articulo_numero));
                
                console.log(`🛒 [REMITO-R-HTML] Artículos del presupuesto:`, articulosSorted.map(a => a.articulo_numero));
                console.log(`🛒 [REMITO-R-HTML] Comparando con articulosEnFalta:`, articulosEnFalta);
                
                // Si es pendiente de compra, separar artículos en falta
                if (esPendienteCompra && articulosEnFalta.length > 0) {
                    const articulosConStock = articulosSorted.filter(a => !articulosEnFalta.includes(a.articulo_numero));
                    const articulosSinStock = articulosSorted.filter(a => articulosEnFalta.includes(a.articulo_numero));
                    
                    console.log(`🛒 [REMITO-R-HTML] Artículos CON stock:`, articulosConStock.length);
                    console.log(`🛒 [REMITO-R-HTML] Artículos SIN stock:`, articulosSinStock.length);
                    
                    // Primero mostrar artículos CON stock (si hay)
                    if (articulosConStock.length > 0) {
                        html += `
                <tr>
                    <td colspan="3" class="seccion-titulo">Artículos Disponibles</td>
                </tr>
`;
                        articulosConStock.forEach(articulo => {
                            html += `
                <tr>
                    <td class="col-codigo">${articulo.articulo_numero}</td>
                    <td class="col-descripcion">${articulo.descripcion}</td>
                    <td class="col-cantidad">${articulo.cantidad}</td>
                </tr>
`;
                        });
                    }
                    
                    // Luego mostrar artículos EN FALTA (destacados)
                    if (articulosSinStock.length > 0) {
                        html += `
                <tr>
                    <td colspan="3" class="seccion-titulo en-falta">⚠️ Artículos en Falta</td>
                </tr>
`;
                        articulosSinStock.forEach(articulo => {
                            html += `
                <tr class="articulo-en-falta">
                    <td class="col-codigo">${articulo.articulo_numero}</td>
                    <td class="col-descripcion">${articulo.descripcion}</td>
                    <td class="col-cantidad">${articulo.cantidad}</td>
                </tr>
`;
                        });
                    }
                } else {
                    // Modo normal (sin pendientes de compra)
                    articulosSorted.forEach(articulo => {
                        html += `
                <tr>
                    <td class="col-codigo">${articulo.articulo_numero}</td>
                    <td class="col-descripcion">${articulo.descripcion}</td>
                    <td class="col-cantidad">${articulo.cantidad}</td>
                </tr>
`;
                    });
                }
            } else {
                html += `
                <tr>
                    <td colspan="3" style="text-align: center; font-style: italic; color: #666; padding: 15px;">
                        No hay artículos registrados
                    </td>
                </tr>
`;
            }
            
            html += `
            </tbody>
        </table>
        
        <!-- CONTROL DE ENTREGA REDISEÑADO -->
        <div class="control-entrega">
            <h4>Control de Entrega</h4>
            
            <div class="campos-control">
                <div class="campo-firma">
                    <label>Nombre legible de quien recibe</label>
                </div>
                
                <div class="campo-firma">
                    <label>Firma (opcional)</label>
                </div>
                
                <div class="campo-entregado">
                    <label>Entregado por</label>
                </div>
            </div>
            
            <div class="nota-importante">
                <strong>IMPORTANTE:</strong> Este comprobante se usa para armar el pedido y controlarlo en destino. 
                Al entregar, se puede sacar una foto del papel con el nombre escrito por quien recibe.
            </div>
        </div>
        
        <!-- PIE DE PÁGINA -->
        <div class="pie-pagina">
            Sistema LAMDA - Presupuesto ${presupIndex + 1} de ${clienteData.presupuestos.length} - ${new Date().toLocaleString('es-AR')}
        </div>
    </div>
`;
        });
        
        html += `
</body>
</html>
`;
        
        console.log(`✅ [REMITO-R] HTML rediseñado generado para cliente: ${clienteData.cliente_nombre}`);
        res.setHeader('Content-Type', 'text/html; charset=utf-8');
        res.send(html);
        
    } catch (error) {
        console.error('❌ [REMITO-R] Error generando HTML rediseñado:', error);
        res.status(500).json({
            success: false,
            error: 'Error generando remito HTML rediseñado',
            message: error.message,
            timestamp: new Date().toISOString()
        });
    }
}

/**
 * Genera PDF en formato remito rediseñado (Formato R)
 * REDISEÑO: Una página por presupuesto cuando hay múltiples
 * @param {boolean} esPendienteCompra - Si es true, muestra "ORDEN EN ESPERA" y marca artículos en falta
 * @param {Array} articulosEnFalta - Array de códigos de artículos que están en falta
 */
function generarPDF_Rediseñado(res, clienteData, esPendienteCompra = false, articulosEnFalta = []) {
    try {
        let PDFDocument;
        try {
            PDFDocument = require('pdfkit');
        } catch (pdfError) {
            console.error('❌ [REMITO-R] PDFKit no disponible:', pdfError.message);
            return res.status(501).json({
                success: false,
                error: 'PDF no disponible - dependencia faltante',
                sugerencia: 'usar formato=html',
                timestamp: new Date().toISOString()
            });
        }
        
        const fechaHoy = new Date().toLocaleDateString('es-AR');
        const horaHoy = new Date().toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' });
        const fechaArchivo = new Date().toISOString().split('T')[0].replace(/-/g, '');
        const nombreArchivo = `remito-r-cliente-${clienteData.cliente_id}-${fechaArchivo}.pdf`;
        
        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', `inline; filename="${nombreArchivo}"`);
        
        const doc = new PDFDocument({ 
            margin: 40,
            size: 'A4',
            bufferPages: true
        });
        
        doc.pipe(res);
        
        // Generar una página por cada presupuesto
        clienteData.presupuestos.forEach((presupuesto, presupIndex) => {
            if (presupIndex > 0) {
                doc.addPage(); // Nueva página para cada presupuesto después del primero
            }
            
            const fechaPresupuesto = new Date(presupuesto.fecha).toLocaleDateString('es-AR');
            
            // ENCABEZADO
            doc.fontSize(22).font('Helvetica').text('LAMDA', 50, 50);
            
            if (esPendienteCompra) {
                // ORDEN EN ESPERA en lugar de R
                doc.fillColor('#dc3545').strokeColor('#dc3545').lineWidth(2)
                   .roundedRect(130, 45, 120, 35, 3).stroke();
                doc.fillColor('#fff3cd').rect(131, 46, 118, 33).fill();
                doc.fillColor('#dc3545').fontSize(9).font('Helvetica-Bold')
                   .text('ORDEN EN ESPERA', 135, 57, { width: 110, align: 'center' });
                doc.fillColor('black');
            } else {
                // R normal
                doc.roundedRect(130, 45, 35, 35, 3).stroke();
                doc.fontSize(20).font('Helvetica-Bold').text('R', 142, 57);
            }
            
            doc.fontSize(10).font('Helvetica').fillColor('#666666')
               .text(`${fechaHoy} - ${horaHoy}`, 420, 55);
            doc.fillColor('black');
            
            doc.strokeColor('#cccccc').lineWidth(0.5)
               .moveTo(50, 90).lineTo(545, 90).stroke()
               .strokeColor('black').lineWidth(1);
            
            // DATOS DEL PEDIDO
            doc.fontSize(11).font('Helvetica').text(`N° de Cliente:`, 50, 105);
            doc.fontSize(24).font('Helvetica-Bold').fillColor('#2c3e50')
               .text(`${clienteData.cliente_id}`, 140, 100);
            doc.fontSize(11).font('Helvetica').fillColor('black')
               .text(clienteData.cliente_nombre, 50, 125);
            
            // Código de presupuesto y fecha
            doc.fontSize(9).font('Helvetica').fillColor('#7f8c8d')
               .text(presupuesto.id_presupuesto_ext, 450, 105);
            doc.fontSize(8).fillColor('#999999')
               .text(`Fecha: ${fechaPresupuesto}`, 450, 118);
            doc.fillColor('black');
            
            // TABLA DE ARTÍCULOS
            const tablaY = 150;
            const colWidths = [85, 340, 65];
            const rowHeight = 22;
            
            // Encabezados
            doc.fillColor('#f8f9fa').rect(50, tablaY, colWidths[0] + colWidths[1] + colWidths[2], rowHeight).fill();
            doc.fillColor('black').fontSize(9).font('Helvetica-Bold');
            doc.rect(50, tablaY, colWidths[0], rowHeight).stroke();
            doc.text('CÓDIGO', 55, tablaY + 8);
            doc.rect(50 + colWidths[0], tablaY, colWidths[1], rowHeight).stroke();
            doc.text('DESCRIPCIÓN DEL ARTÍCULO', 55 + colWidths[0], tablaY + 8);
            doc.rect(50 + colWidths[0] + colWidths[1], tablaY, colWidths[2], rowHeight).stroke();
            doc.text('CANT.', 55 + colWidths[0] + colWidths[1], tablaY + 8);
            
            // Artículos de ESTE presupuesto solamente
            let currentY = tablaY + rowHeight;
            
            if (presupuesto.articulos && presupuesto.articulos.length > 0) {
                const articulosSorted = presupuesto.articulos.sort((a, b) => a.articulo_numero.localeCompare(b.articulo_numero));
                
                // Si es pendiente de compra, separar artículos
                if (esPendienteCompra && articulosEnFalta.length > 0) {
                    const articulosConStock = articulosSorted.filter(a => !articulosEnFalta.includes(a.articulo_numero));
                    const articulosSinStock = articulosSorted.filter(a => articulosEnFalta.includes(a.articulo_numero));
                    
                    // Artículos CON stock
                    if (articulosConStock.length > 0) {
                        // Título de sección
                        doc.fillColor('#f8f9fa').rect(50, currentY, colWidths[0] + colWidths[1] + colWidths[2], rowHeight).fill();
                        doc.fillColor('#6c757d').fontSize(10).font('Helvetica-Bold')
                           .text('ARTÍCULOS DISPONIBLES', 55, currentY + 7);
                        doc.fillColor('black');
                        currentY += rowHeight;
                        
                        articulosConStock.forEach((articulo, index) => {
                            if (index % 2 === 1) {
                                doc.fillColor('#f8f9fa').rect(50, currentY, colWidths[0] + colWidths[1] + colWidths[2], rowHeight).fill();
                            }
                            doc.fillColor('black');
                            
                            // Bordes
                            doc.moveTo(50, currentY).lineTo(50, currentY + rowHeight).stroke();
                            doc.moveTo(50 + colWidths[0], currentY).lineTo(50 + colWidths[0], currentY + rowHeight).stroke();
                            doc.moveTo(50, currentY + rowHeight).lineTo(50 + colWidths[0], currentY + rowHeight).stroke();
                            
                            doc.fontSize(9).font('Helvetica').fillColor('#495057')
                               .text(articulo.articulo_numero, 55, currentY + 7, { width: colWidths[0] - 10 });
                            
                            doc.moveTo(50 + colWidths[0] + colWidths[1], currentY).lineTo(50 + colWidths[0] + colWidths[1], currentY + rowHeight).stroke();
                            doc.moveTo(50 + colWidths[0], currentY + rowHeight).lineTo(50 + colWidths[0] + colWidths[1], currentY + rowHeight).stroke();
                            
                            let descripcion = articulo.descripcion;
                            if (descripcion.length > 35) {
                                descripcion = descripcion.substring(0, 32) + '...';
                            }
                            doc.fontSize(14).font('Helvetica').fillColor('black')
                               .text(descripcion, 60 + colWidths[0], currentY + 4, { width: colWidths[1] - 20 });
                            
                            doc.moveTo(50 + colWidths[0] + colWidths[1] + colWidths[2], currentY).lineTo(50 + colWidths[0] + colWidths[1] + colWidths[2], currentY + rowHeight).stroke();
                            doc.moveTo(50 + colWidths[0] + colWidths[1], currentY + rowHeight).lineTo(50 + colWidths[0] + colWidths[1] + colWidths[2], currentY + rowHeight).stroke();
                            
                            doc.fontSize(14).font('Helvetica-Bold').fillColor('#2c3e50')
                               .text(articulo.cantidad.toString(), 55 + colWidths[0] + colWidths[1], currentY + 4, { 
                                   width: colWidths[2] - 10, 
                                   align: 'center' 
                               });
                            
                            currentY += rowHeight;
                        });
                    }
                    
                    // Artículos SIN stock (EN FALTA)
                    if (articulosSinStock.length > 0) {
                        // Título de sección
                        doc.fillColor('#fff3cd').rect(50, currentY, colWidths[0] + colWidths[1] + colWidths[2], rowHeight).fill();
                        doc.fillColor('#856404').fontSize(10).font('Helvetica-Bold')
                           .text('⚠️ ARTÍCULOS EN FALTA', 55, currentY + 7);
                        doc.fillColor('black');
                        currentY += rowHeight;
                        
                        articulosSinStock.forEach((articulo, index) => {
                            // Fondo amarillo para artículos en falta
                            doc.fillColor('#fff3cd').rect(50, currentY, colWidths[0] + colWidths[1] + colWidths[2], rowHeight).fill();
                            doc.fillColor('black');
                            
                            // Borde izquierdo naranja
                            doc.strokeColor('#ffc107').lineWidth(4)
                               .moveTo(50, currentY).lineTo(50, currentY + rowHeight).stroke();
                            doc.strokeColor('black').lineWidth(1);
                            
                            // Bordes normales
                            doc.moveTo(50 + colWidths[0], currentY).lineTo(50 + colWidths[0], currentY + rowHeight).stroke();
                            doc.moveTo(50, currentY + rowHeight).lineTo(50 + colWidths[0], currentY + rowHeight).stroke();
                            
                            doc.fontSize(9).font('Helvetica-Bold').fillColor('#856404')
                               .text(articulo.articulo_numero, 55, currentY + 7, { width: colWidths[0] - 10 });
                            
                            doc.moveTo(50 + colWidths[0] + colWidths[1], currentY).lineTo(50 + colWidths[0] + colWidths[1], currentY + rowHeight).stroke();
                            doc.moveTo(50 + colWidths[0], currentY + rowHeight).lineTo(50 + colWidths[0] + colWidths[1], currentY + rowHeight).stroke();
                            
                            let descripcion = articulo.descripcion;
                            if (descripcion.length > 35) {
                                descripcion = descripcion.substring(0, 32) + '...';
                            }
                            doc.fontSize(14).font('Helvetica-Bold').fillColor('#856404')
                               .text(descripcion, 60 + colWidths[0], currentY + 4, { width: colWidths[1] - 20 });
                            
                            doc.moveTo(50 + colWidths[0] + colWidths[1] + colWidths[2], currentY).lineTo(50 + colWidths[0] + colWidths[1] + colWidths[2], currentY + rowHeight).stroke();
                            doc.moveTo(50 + colWidths[0] + colWidths[1], currentY + rowHeight).lineTo(50 + colWidths[0] + colWidths[1] + colWidths[2], currentY + rowHeight).stroke();
                            
                            doc.fontSize(14).font('Helvetica-Bold').fillColor('#856404')
                               .text(articulo.cantidad.toString(), 55 + colWidths[0] + colWidths[1], currentY + 4, { 
                                   width: colWidths[2] - 10, 
                                   align: 'center' 
                               });
                            
                            currentY += rowHeight;
                        });
                    }
                } else {
                    // Modo normal (sin pendientes de compra)
                    articulosSorted.forEach((articulo, index) => {
                        if (index % 2 === 1) {
                            doc.fillColor('#f8f9fa').rect(50, currentY, colWidths[0] + colWidths[1] + colWidths[2], rowHeight).fill();
                        }
                        doc.fillColor('black');
                        
                        // Bordes
                        doc.moveTo(50, currentY).lineTo(50, currentY + rowHeight).stroke();
                        doc.moveTo(50 + colWidths[0], currentY).lineTo(50 + colWidths[0], currentY + rowHeight).stroke();
                        doc.moveTo(50, currentY + rowHeight).lineTo(50 + colWidths[0], currentY + rowHeight).stroke();
                        
                        doc.fontSize(9).font('Helvetica').fillColor('#495057')
                           .text(articulo.articulo_numero, 55, currentY + 7, { width: colWidths[0] - 10 });
                        
                        doc.moveTo(50 + colWidths[0] + colWidths[1], currentY).lineTo(50 + colWidths[0] + colWidths[1], currentY + rowHeight).stroke();
                        doc.moveTo(50 + colWidths[0], currentY + rowHeight).lineTo(50 + colWidths[0] + colWidths[1], currentY + rowHeight).stroke();
                        
                        let descripcion = articulo.descripcion;
                        if (descripcion.length > 35) {
                            descripcion = descripcion.substring(0, 32) + '...';
                        }
                        doc.fontSize(14).font('Helvetica').fillColor('black')
                           .text(descripcion, 60 + colWidths[0], currentY + 4, { width: colWidths[1] - 20 });
                        
                        doc.moveTo(50 + colWidths[0] + colWidths[1] + colWidths[2], currentY).lineTo(50 + colWidths[0] + colWidths[1] + colWidths[2], currentY + rowHeight).stroke();
                        doc.moveTo(50 + colWidths[0] + colWidths[1], currentY + rowHeight).lineTo(50 + colWidths[0] + colWidths[1] + colWidths[2], currentY + rowHeight).stroke();
                        
                        doc.fontSize(14).font('Helvetica-Bold').fillColor('#2c3e50')
                           .text(articulo.cantidad.toString(), 55 + colWidths[0] + colWidths[1], currentY + 4, { 
                               width: colWidths[2] - 10, 
                               align: 'center' 
                           });
                        
                        currentY += rowHeight;
                    });
                }
            } else {
                doc.fillColor('#f8f9fa').rect(50, currentY, colWidths[0] + colWidths[1] + colWidths[2], rowHeight).fill();
                doc.fillColor('black');
                doc.moveTo(50, currentY).lineTo(50, currentY + rowHeight).stroke();
                doc.moveTo(50 + colWidths[0], currentY).lineTo(50 + colWidths[0], currentY + rowHeight).stroke();
                doc.moveTo(50 + colWidths[0] + colWidths[1], currentY).lineTo(50 + colWidths[0] + colWidths[1], currentY + rowHeight).stroke();
                doc.moveTo(50 + colWidths[0] + colWidths[1] + colWidths[2], currentY).lineTo(50 + colWidths[0] + colWidths[1] + colWidths[2], currentY + rowHeight).stroke();
                doc.moveTo(50, currentY + rowHeight).lineTo(50 + colWidths[0] + colWidths[1] + colWidths[2], currentY + rowHeight).stroke();
                
                doc.fontSize(12).font('Helvetica').fillColor('#6c757d')
                   .text('No hay artículos registrados', 55, currentY + 8, { 
                       width: colWidths[0] + colWidths[1] + colWidths[2] - 10, 
                       align: 'center' 
                   });
                currentY += rowHeight;
            }
            
            // CONTROL DE ENTREGA
            const controlY = Math.min(currentY + 15, 720);
            const controlHeight = 35;
            
            doc.fillColor('black').strokeColor('#dee2e6').lineWidth(1)
               .roundedRect(50, controlY, 490, controlHeight, 3).stroke();
            
            doc.fontSize(9).font('Helvetica-Bold').fillColor('#495057')
               .text('CONTROL DE ENTREGA', 50, controlY + 8, { width: 490, align: 'center' });
            
            const campoY = controlY + 22;
            doc.fontSize(8).font('Helvetica').fillColor('#6c757d')
               .text('Nombre legible de quien recibe:', 60, campoY);
            doc.strokeColor('#dee2e6').lineWidth(0.5)
               .moveTo(60, campoY + 8).lineTo(280, campoY + 8).stroke();
            
            doc.text('Firma (opcional):', 300, campoY);
            doc.moveTo(300, campoY + 8).lineTo(520, campoY + 8).stroke();
            
            // PIE DE PÁGINA
            const pieY = Math.min(controlY + controlHeight + 10, 780);
            doc.fontSize(7).font('Helvetica').fillColor('#adb5bd')
               .text(`Sistema LAMDA - Presupuesto ${presupIndex + 1} de ${clienteData.presupuestos.length} - ${new Date().toLocaleString('es-AR')}`,
                     50, pieY, { width: 490, align: 'center' });
            
            doc.fillColor('black');
        });
        
        doc.end();
        
        console.log(`✅ [REMITO-R] PDF rediseñado generado: ${nombreArchivo} (${clienteData.presupuestos.length} páginas)`);
        
    } catch (error) {
        console.error('❌ [REMITO-R] Error generando PDF rediseñado:', error);
        res.status(500).json({
            success: false,
            error: 'Error generando remito PDF rediseñado',
            message: error.message,
            timestamp: new Date().toISOString()
        });
    }
}

/**
 * Genera HTML para TODOS los clientes (impresión general)
 * Una hoja por cada presupuesto de cada cliente
 */
function generarHTML_TodosLosClientes(res, clientesData, fecha) {
    try {
        const fechaHoy = new Date().toLocaleDateString('es-AR', {
            year: 'numeric',
            month: '2-digit',
            day: '2-digit'
        });
        const horaHoy = new Date().toLocaleTimeString('es-AR', {
            hour: '2-digit',
            minute: '2-digit'
        });
        
        let html = `
<!DOCTYPE html>
<html lang="es">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Remito R - Todos los Presupuestos</title>
    <style>
        @page {
            size: A4;
            margin: 1.5cm;
        }
        
        body { 
            font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; 
            margin: 0; 
            padding: 0;
            line-height: 1.3; 
            color: #000;
            font-size: 11px;
        }
        
        .remito-container {
            max-width: 100%;
            margin: 0 auto;
            padding: 15px;
        }
        
        .page-break {
            page-break-after: always;
        }
        
        .header { 
            display: flex;
            justify-content: space-between;
            align-items: center;
            margin-bottom: 20px; 
            border-bottom: 1px solid #333; 
            padding-bottom: 12px; 
        }
        
        .header-left {
            display: flex;
            align-items: center;
            gap: 15px;
        }
        
        .logo-lamda { 
            font-size: 24px; 
            font-weight: 300; 
            letter-spacing: 2px;
            color: #000;
        }
        
        .letra-r {
            font-size: 36px;
            font-weight: bold;
            color: #000;
            border: 2px solid #000;
            width: 50px;
            height: 50px;
            display: flex;
            align-items: center;
            justify-content: center;
            border-radius: 4px;
        }
        
        .fecha-emision { 
            font-size: 10px; 
            text-align: right;
            color: #666;
        }
        
        .datos-pedido { 
            display: flex;
            justify-content: space-between;
            margin-bottom: 15px; 
            padding: 8px 0;
            border-bottom: 1px solid #eee;
        }
        
        .numero-cliente {
            font-size: 14px;
            font-weight: bold;
        }
        
        .nombre-cliente {
            font-size: 12px;
            color: #333;
        }
        
        .codigo-presupuesto {
            font-size: 11px;
            font-family: monospace;
            background: #f5f5f5;
            padding: 2px 6px;
            border-radius: 3px;
        }
        
        .articulos-tabla { 
            width: 100%; 
            border-collapse: collapse; 
            margin: 10px 0; 
            font-size: 10px;
        }
        
        .articulos-tabla th { 
            background-color: #f8f9fa; 
            font-weight: 600; 
            text-align: left;
            padding: 6px 4px;
            border: 1px solid #dee2e6;
            font-size: 9px;
            text-transform: uppercase;
            letter-spacing: 0.5px;
        }
        
        .articulos-tabla td { 
            padding: 4px; 
            border: 1px solid #dee2e6; 
            vertical-align: top;
        }
        
        .articulos-tabla .col-codigo {
            width: 20%;
            font-family: monospace;
            font-size: 9px;
            background: #fafafa;
        }
        
        .articulos-tabla .col-descripcion {
            width: 65%;
            word-wrap: break-word;
        }
        
        .articulos-tabla .col-cantidad {
            width: 15%;
            text-align: center;
            font-weight: 600;
        }
        
        .control-entrega {
            margin-top: 25px;
            border: 1px solid #333;
            padding: 12px;
            background: #fafafa;
        }
        
        .control-entrega h4 {
            margin: 0 0 12px 0;
            font-size: 11px;
            text-align: center;
            font-weight: 600;
            text-transform: uppercase;
            letter-spacing: 1px;
        }
        
        .campos-control {
            display: grid;
            grid-template-columns: 1fr 1fr;
            gap: 15px;
            margin-bottom: 12px;
        }
        
        .campo-firma {
            border-bottom: 1px solid #333;
            padding-bottom: 3px;
            min-height: 20px;
        }
        
        .campo-firma label {
            font-size: 9px;
            font-weight: 600;
            color: #666;
            text-transform: uppercase;
        }
        
        .campo-entregado {
            grid-column: 1 / -1;
            border-bottom: 1px solid #333;
            padding-bottom: 3px;
            min-height: 20px;
        }
        
        .nota-importante {
            margin-top: 10px;
            padding: 6px;
            background-color: #fff3cd;
            border: 1px solid #ffeaa7;
            border-radius: 3px;
            font-size: 8px;
            text-align: justify;
            color: #856404;
        }
        
        .pie-pagina {
            margin-top: 15px;
            text-align: center;
            font-size: 8px;
            color: #999;
            border-top: 1px solid #eee;
            padding-top: 8px;
        }
        
        @media print {
            body { 
                margin: 0; 
                font-size: 10px;
            }
            
            .remito-container {
                padding: 0;
            }
            
            .header {
                margin-bottom: 15px;
                padding-bottom: 8px;
            }
            
            .control-entrega {
                page-break-inside: avoid;
                margin-top: 20px;
            }
        }
    </style>
</head>
<body>
`;
        
        // Contar total de presupuestos
        let totalPresupuestos = 0;
        clientesData.forEach(cliente => {
            totalPresupuestos += cliente.presupuestos.length;
        });
        
        let presupuestoGlobalIndex = 0;
        
        // Iterar por cada cliente y cada presupuesto
        clientesData.forEach((cliente, clienteIndex) => {
            cliente.presupuestos.forEach((presupuesto, presupIndex) => {
                const fechaPresupuesto = new Date(presupuesto.fecha).toLocaleDateString('es-AR');
                const esUltimo = (clienteIndex === clientesData.length - 1) && (presupIndex === cliente.presupuestos.length - 1);
                
                html += `
    <div class="remito-container${!esUltimo ? ' page-break' : ''}">
        <div class="header">
            <div class="header-left">
                <div class="logo-lamda">LAMDA</div>
                <div class="letra-r">R</div>
            </div>
            <div class="fecha-emision">
                ${fechaHoy} - ${horaHoy}
            </div>
        </div>
        
        <div class="datos-pedido">
            <div>
                <div class="numero-cliente">N° de Cliente: ${cliente.cliente_id}</div>
                <div class="nombre-cliente">${cliente.cliente_nombre}</div>
            </div>
            <div>
                <div class="codigo-presupuesto">${presupuesto.id_presupuesto_ext}</div>
                <div style="font-size: 10px; color: #666; margin-top: 4px;">Fecha: ${fechaPresupuesto}</div>
            </div>
        </div>
        
        <table class="articulos-tabla">
            <thead>
                <tr>
                    <th class="col-codigo">Código</th>
                    <th class="col-descripcion">Descripción del Artículo</th>
                    <th class="col-cantidad">Cantidad</th>
                </tr>
            </thead>
            <tbody>
`;
                
                // Mostrar artículos de ESTE presupuesto
                if (presupuesto.articulos && presupuesto.articulos.length > 0) {
                    presupuesto.articulos
                        .sort((a, b) => a.articulo_numero.localeCompare(b.articulo_numero))
                        .forEach(articulo => {
                            html += `
                <tr>
                    <td class="col-codigo">${articulo.articulo_numero}</td>
                    <td class="col-descripcion">${articulo.descripcion}</td>
                    <td class="col-cantidad">${articulo.cantidad}</td>
                </tr>
`;
                        });
                } else {
                    html += `
                <tr>
                    <td colspan="3" style="text-align: center; font-style: italic; color: #666; padding: 15px;">
                        No hay artículos
                    </td>
                </tr>
`;
                }
                
                presupuestoGlobalIndex++;
                
                html += `
            </tbody>
        </table>
        
        <div class="control-entrega">
            <h4>Control de Entrega</h4>
            
            <div class="campos-control">
                <div class="campo-firma">
                    <label>Nombre legible de quien recibe</label>
                </div>
                
                <div class="campo-firma">
                    <label>Firma (opcional)</label>
                </div>
                
                <div class="campo-entregado">
                    <label>Entregado por</label>
                </div>
            </div>
            
            <div class="nota-importante">
                <strong>IMPORTANTE:</strong> Este comprobante se usa para armar el pedido y controlarlo en destino. 
                Al entregar, se puede sacar una foto del papel con el nombre escrito por quien recibe.
            </div>
        </div>
        
        <div class="pie-pagina">
            Sistema LAMDA - Presupuesto ${presupuestoGlobalIndex} de ${totalPresupuestos} - ${new Date().toLocaleString('es-AR')}
        </div>
    </div>
`;
            });
        });
        
        html += `
</body>
</html>
`;
        
        console.log(`✅ [REMITO-R] HTML general generado: ${totalPresupuestos} presupuestos de ${clientesData.length} clientes`);
        res.setHeader('Content-Type', 'text/html; charset=utf-8');
        res.send(html);
        
    } catch (error) {
        console.error('❌ [REMITO-R] Error generando HTML general:', error);
        res.status(500).json({
            success: false,
            error: 'Error generando remito HTML general',
            message: error.message,
            timestamp: new Date().toISOString()
        });
    }
}

/**
 * Genera PDF para TODOS los clientes (impresión general)
 * Una página por cada presupuesto de cada cliente
 */
function generarPDF_TodosLosClientes(res, clientesData, fecha) {
    try {
        let PDFDocument;
        try {
            PDFDocument = require('pdfkit');
        } catch (pdfError) {
            console.error('❌ [REMITO-R] PDFKit no disponible:', pdfError.message);
            return res.status(501).json({
                success: false,
                error: 'PDF no disponible - dependencia faltante',
                sugerencia: 'usar formato=html',
                timestamp: new Date().toISOString()
            });
        }
        
        const fechaHoy = new Date().toLocaleDateString('es-AR');
        const horaHoy = new Date().toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' });
        const fechaArchivo = new Date().toISOString().split('T')[0].replace(/-/g, '');
        const nombreArchivo = `remito-r-todos-${fechaArchivo}.pdf`;
        
        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', `inline; filename="${nombreArchivo}"`);
        
        const doc = new PDFDocument({ 
            margin: 40,
            size: 'A4',
            bufferPages: true
        });
        
        doc.pipe(res);
        
        // Contar total de presupuestos
        let totalPresupuestos = 0;
        clientesData.forEach(cliente => {
            totalPresupuestos += cliente.presupuestos.length;
        });
        
        let presupuestoGlobalIndex = 0;
        
        // Iterar por cada cliente y cada presupuesto - UNA PÁGINA POR PRESUPUESTO
        clientesData.forEach((cliente, clienteIndex) => {
            cliente.presupuestos.forEach((presupuesto, presupIndex) => {
                if (presupuestoGlobalIndex > 0) {
                    doc.addPage(); // Nueva página para cada presupuesto
                }
                
                const fechaPresupuesto = new Date(presupuesto.fecha).toLocaleDateString('es-AR');
                
                // ENCABEZADO
                doc.fontSize(22).font('Helvetica').text('LAMDA', 50, 50);
                doc.roundedRect(130, 45, 35, 35, 3).stroke();
                doc.fontSize(20).font('Helvetica-Bold').text('R', 142, 57);
                doc.fontSize(10).font('Helvetica').fillColor('#666666')
                   .text(`${fechaHoy} - ${horaHoy}`, 420, 55);
                doc.fillColor('black');
                
                doc.strokeColor('#cccccc').lineWidth(0.5)
                   .moveTo(50, 90).lineTo(545, 90).stroke()
                   .strokeColor('black').lineWidth(1);
                
                // DATOS DEL PEDIDO
                doc.fontSize(11).font('Helvetica').text(`N° de Cliente:`, 50, 105);
                doc.fontSize(24).font('Helvetica-Bold').fillColor('#2c3e50')
                   .text(`${cliente.cliente_id}`, 140, 100);
                doc.fontSize(11).font('Helvetica').fillColor('black')
                   .text(cliente.cliente_nombre, 50, 125);
                
                // Código de presupuesto y fecha
                doc.fontSize(9).font('Helvetica').fillColor('#7f8c8d')
                   .text(presupuesto.id_presupuesto_ext, 450, 105);
                doc.fontSize(8).fillColor('#999999')
                   .text(`Fecha: ${fechaPresupuesto}`, 450, 118);
                doc.fillColor('black');
                
                // TABLA DE ARTÍCULOS
                const tablaY = 150;
                const colWidths = [85, 340, 65];
                const rowHeight = 22;
                
                // Encabezados
                doc.fillColor('#f8f9fa').rect(50, tablaY, colWidths[0] + colWidths[1] + colWidths[2], rowHeight).fill();
                doc.fillColor('black').fontSize(9).font('Helvetica-Bold');
                doc.rect(50, tablaY, colWidths[0], rowHeight).stroke();
                doc.text('CÓDIGO', 55, tablaY + 8);
                doc.rect(50 + colWidths[0], tablaY, colWidths[1], rowHeight).stroke();
                doc.text('DESCRIPCIÓN DEL ARTÍCULO', 55 + colWidths[0], tablaY + 8);
                doc.rect(50 + colWidths[0] + colWidths[1], tablaY, colWidths[2], rowHeight).stroke();
                doc.text('CANT.', 55 + colWidths[0] + colWidths[1], tablaY + 8);
                
                // Artículos de ESTE presupuesto
                let currentY = tablaY + rowHeight;
                
                if (presupuesto.articulos && presupuesto.articulos.length > 0) {
                    presupuesto.articulos
                        .sort((a, b) => a.articulo_numero.localeCompare(b.articulo_numero))
                        .forEach((articulo, index) => {
                            if (index % 2 === 1) {
                                doc.fillColor('#f8f9fa').rect(50, currentY, colWidths[0] + colWidths[1] + colWidths[2], rowHeight).fill();
                            }
                            doc.fillColor('black');
                            
                            doc.moveTo(50, currentY).lineTo(50, currentY + rowHeight).stroke();
                            doc.moveTo(50 + colWidths[0], currentY).lineTo(50 + colWidths[0], currentY + rowHeight).stroke();
                            doc.moveTo(50, currentY + rowHeight).lineTo(50 + colWidths[0], currentY + rowHeight).stroke();
                            
                            doc.fontSize(9).font('Helvetica').fillColor('#495057')
                               .text(articulo.articulo_numero, 55, currentY + 7, { width: colWidths[0] - 10 });
                            
                            doc.moveTo(50 + colWidths[0] + colWidths[1], currentY).lineTo(50 + colWidths[0] + colWidths[1], currentY + rowHeight).stroke();
                            doc.moveTo(50 + colWidths[0], currentY + rowHeight).lineTo(50 + colWidths[0] + colWidths[1], currentY + rowHeight).stroke();
                            
                            let descripcion = articulo.descripcion;
                            if (descripcion.length > 35) {
                                descripcion = descripcion.substring(0, 32) + '...';
                            }
                            doc.fontSize(14).font('Helvetica').fillColor('black')
                               .text(descripcion, 60 + colWidths[0], currentY + 4, { width: colWidths[1] - 20 });
                            
                            doc.moveTo(50 + colWidths[0] + colWidths[1] + colWidths[2], currentY).lineTo(50 + colWidths[0] + colWidths[1] + colWidths[2], currentY + rowHeight).stroke();
                            doc.moveTo(50 + colWidths[0] + colWidths[1], currentY + rowHeight).lineTo(50 + colWidths[0] + colWidths[1] + colWidths[2], currentY + rowHeight).stroke();
                            
                            doc.fontSize(14).font('Helvetica-Bold').fillColor('#2c3e50')
                               .text(articulo.cantidad.toString(), 55 + colWidths[0] + colWidths[1], currentY + 4, { 
                                   width: colWidths[2] - 10, 
                                   align: 'center' 
                               });
                            
                            currentY += rowHeight;
                        });
                }
                
                // CONTROL DE ENTREGA
                const controlY = Math.min(currentY + 15, 720);
                const controlHeight = 35;
                
                doc.fillColor('black').strokeColor('#dee2e6').lineWidth(1)
                   .roundedRect(50, controlY, 490, controlHeight, 3).stroke();
                
                doc.fontSize(9).font('Helvetica-Bold').fillColor('#495057')
                   .text('CONTROL DE ENTREGA', 50, controlY + 8, { width: 490, align: 'center' });
                
                const campoY = controlY + 22;
                doc.fontSize(8).font('Helvetica').fillColor('#6c757d')
                   .text('Nombre legible de quien recibe:', 60, campoY);
                doc.strokeColor('#dee2e6').lineWidth(0.5)
                   .moveTo(60, campoY + 8).lineTo(280, campoY + 8).stroke();
                
                doc.text('Firma (opcional):', 300, campoY);
                doc.moveTo(300, campoY + 8).lineTo(520, campoY + 8).stroke();
                
                // PIE DE PÁGINA
                presupuestoGlobalIndex++;
                const pieY = Math.min(controlY + controlHeight + 10, 780);
                doc.fontSize(7).font('Helvetica').fillColor('#adb5bd')
                   .text(`Sistema LAMDA - Presupuesto ${presupuestoGlobalIndex} de ${totalPresupuestos} - ${new Date().toLocaleString('es-AR')}`,
                         50, pieY, { width: 490, align: 'center' });
                
                doc.fillColor('black');
            });
        });
        
        doc.end();
        
        console.log(`✅ [REMITO-R] PDF general generado: ${nombreArchivo} (${totalPresupuestos} páginas)`);
        
    } catch (error) {
        console.error('❌ [REMITO-R] Error generando PDF general:', error);
        res.status(500).json({
            success: false,
            error: 'Error generando PDF general',
            message: error.message,
            timestamp: new Date().toISOString()
        });
    }
}

module.exports = {
    imprimirPresupuestoCliente
};
