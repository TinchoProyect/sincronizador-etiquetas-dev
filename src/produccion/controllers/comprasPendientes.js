const pool = require('../config/database');
const { pushToSheetsFireAndForget } = require('../../presupuestos/controllers/presupuestosWrite');

/**
 * Crear un nuevo pendiente de compra
 * POST /api/produccion/compras/pendientes
 */
const crearPendienteCompra = async (req, res) => {
    try {
        const {
            articulo_numero,
            codigo_barras,
            id_presupuesto_local,
            id_presupuesto_ext,
            cantidad_faltante,
            nota
        } = req.body;

        // Validaciones
        if (!articulo_numero || !id_presupuesto_local || !cantidad_faltante) {
            return res.status(400).json({
                success: false,
                error: 'Faltan campos requeridos: articulo_numero, id_presupuesto_local, cantidad_faltante'
            });
        }

        const query = `
            INSERT INTO public.faltantes_pendientes_compra
            (articulo_numero, codigo_barras, id_presupuesto_local, id_presupuesto_ext, cantidad_faltante, nota, estado)
            VALUES ($1, $2, $3, $4, $5, $6, 'En espera')
            RETURNING *
        `;

        const result = await pool.query(query, [
            articulo_numero,
            codigo_barras || null,
            id_presupuesto_local,
            id_presupuesto_ext || null,
            cantidad_faltante,
            nota || null
        ]);

        res.status(201).json({
            success: true,
            data: result.rows[0]
        });

    } catch (error) {
        console.error('Error al crear pendiente de compra:', error);
        res.status(500).json({
            success: false,
            error: 'Error interno del servidor',
            message: error.message
        });
    }
};

/**
 * Obtener todos los pendientes de compra
 * GET /api/produccion/compras/pendientes
 * FILTRADO: Solo pendientes de presupuestos activos en estado="Presupuesto/Orden" y secuencia="Imprimir"
 */
const obtenerPendientesCompra = async (req, res) => {
    try {
        const query = `
            SELECT 
                fpc.id,
                fpc.articulo_numero,
                fpc.codigo_barras,
                COALESCE(a.codigo_barras, src.codigo_barras, fpc.codigo_barras, fpc.articulo_numero) as codigo_barras_real,
                fpc.id_presupuesto_local,
                fpc.id_presupuesto_ext,
                fpc.cantidad_faltante,
                fpc.estado,
                fpc.nota,
                fpc.creado_en,
                p.estado as presupuesto_estado,
                p.secuencia as presupuesto_secuencia
            FROM public.faltantes_pendientes_compra fpc
            INNER JOIN public.presupuestos p ON p.id = fpc.id_presupuesto_local
            LEFT JOIN public.stock_real_consolidado src ON src.articulo_numero = fpc.articulo_numero
            LEFT JOIN public.articulos a ON a.codigo_barras = fpc.articulo_numero
            WHERE fpc.estado = 'En espera'
                AND p.estado = 'Presupuesto/Orden'
                AND p.secuencia = 'Imprimir'
            ORDER BY fpc.creado_en DESC
        `;

        const result = await pool.query(query);

        // Log para debugging
        console.log(`📊 [PENDIENTES-COMPRA] Total pendientes filtrados: ${result.rows.length}`);
        if (result.rows.length > 0) {
            console.log(`📋 [PENDIENTES-COMPRA] Primer pendiente:`, {
                id: result.rows[0].id,
                articulo: result.rows[0].articulo_numero,
                presupuesto_local: result.rows[0].id_presupuesto_local,
                presupuesto_estado: result.rows[0].presupuesto_estado,
                presupuesto_secuencia: result.rows[0].presupuesto_secuencia
            });
        }

        res.json({
            success: true,
            data: result.rows,
            total: result.rows.length
        });

    } catch (error) {
        console.error('❌ [PENDIENTES-COMPRA] Error al obtener pendientes de compra:', error);
        res.status(500).json({
            success: false,
            error: 'Error interno del servidor',
            message: error.message
        });
    }
};

/**
 * Revertir un pendiente de compra
 * PATCH /api/produccion/compras/pendientes/:id/revertir
 */
const revertirPendienteCompra = async (req, res) => {
    try {
        const { id } = req.params;

        if (!id || isNaN(parseInt(id))) {
            return res.status(400).json({
                success: false,
                error: 'ID inválido'
            });
        }

        const query = `
            UPDATE public.faltantes_pendientes_compra
            SET estado = 'Revertido'
            WHERE id = $1 AND estado = 'En espera'
            RETURNING *
        `;

        const result = await pool.query(query, [parseInt(id)]);

        if (result.rows.length === 0) {
            return res.status(404).json({
                success: false,
                error: 'Pendiente no encontrado o ya revertido'
            });
        }

        res.json({
            success: true,
            data: result.rows[0],
            message: 'Revertido'
        });

    } catch (error) {
        console.error('Error al revertir pendiente de compra:', error);
        res.status(500).json({
            success: false,
            error: 'Error interno del servidor',
            message: error.message
        });
    }
};

/**
 * Marcar un pendiente como obsoleto (presupuesto eliminado/modificado)
 * PATCH /api/produccion/compras/pendientes/:id/obsoleto
 */
const marcarPendienteObsoleto = async (req, res) => {
    try {
        const { id } = req.params;

        if (!id || isNaN(parseInt(id))) {
            return res.status(400).json({
                success: false,
                error: 'ID inválido'
            });
        }

        const query = `
            UPDATE public.faltantes_pendientes_compra
            SET estado = 'Obsoleto',
                nota = COALESCE(nota || ' | ', '') || 'Presupuesto eliminado o modificado - ' || NOW()::text
            WHERE id = $1 AND estado = 'En espera'
            RETURNING *
        `;

        const result = await pool.query(query, [parseInt(id)]);

        if (result.rows.length === 0) {
            return res.status(404).json({
                success: false,
                error: 'Pendiente no encontrado o ya procesado'
            });
        }

        res.json({
            success: true,
            data: result.rows[0],
            message: 'Marcado como obsoleto'
        });

    } catch (error) {
        console.error('Error al marcar pendiente como obsoleto:', error);
        res.status(500).json({
            success: false,
            error: 'Error interno del servidor',
            message: error.message
        });
    }
};

/**
 * Obtener pendientes agrupados por secuencia
 * GET /api/produccion/compras/pendientes-agrupados
 */
const obtenerPendientesAgrupados = async (req, res) => {
    try {
        const query = `
            SELECT 
                fpc.id,
                fpc.articulo_numero,
                fpc.codigo_barras,
                COALESCE(a.codigo_barras, src.codigo_barras, fpc.codigo_barras, fpc.articulo_numero) as codigo_barras_real,
                fpc.id_presupuesto_local,
                fpc.id_presupuesto_ext,
                fpc.cantidad_faltante,
                fpc.estado,
                fpc.nota,
                fpc.creado_en,
                p.estado as presupuesto_estado,
                p.secuencia as presupuesto_secuencia
            FROM public.faltantes_pendientes_compra fpc
            INNER JOIN public.presupuestos p ON p.id = fpc.id_presupuesto_local
            LEFT JOIN public.stock_real_consolidado src ON src.articulo_numero = fpc.articulo_numero
            LEFT JOIN public.articulos a ON a.codigo_barras = fpc.articulo_numero
            WHERE fpc.estado = 'En espera'
                AND p.estado = 'Presupuesto/Orden'
                AND p.activo = true
            ORDER BY p.secuencia, fpc.creado_en DESC
        `;

        const result = await pool.query(query);

        // Agrupar por secuencia
        const porImprimir = result.rows.filter(p => p.presupuesto_secuencia === 'Imprimir' || p.presupuesto_secuencia === 'Imprimir_Modificado');
        const enEspera = result.rows.filter(p => p.presupuesto_secuencia === 'Armar_Pedido');

        console.log(`📊 [PENDIENTES-AGRUPADOS] Por imprimir: ${porImprimir.length}, En espera: ${enEspera.length}`);

        res.json({
            success: true,
            data: {
                por_imprimir: porImprimir,
                en_espera: enEspera
            },
            totales: {
                por_imprimir: porImprimir.length,
                en_espera: enEspera.length,
                total: result.rows.length
            }
        });

    } catch (error) {
        console.error('❌ [PENDIENTES-AGRUPADOS] Error:', error);
        res.status(500).json({
            success: false,
            error: 'Error interno del servidor',
            message: error.message
        });
    }
};

/**
 * Marcar pendiente como impreso (cambiar secuencia del presupuesto)
 * PATCH /api/produccion/compras/pendientes/presupuesto/:id_presupuesto_local/marcar-impreso
 */
const marcarPendienteImpreso = async (req, res) => {
    try {
        const { id_presupuesto_local } = req.params;

        if (!id_presupuesto_local || isNaN(parseInt(id_presupuesto_local))) {
            return res.status(400).json({
                success: false,
                error: 'ID de presupuesto inválido'
            });
        }

        // Cambiar secuencia del presupuesto a "Armar_Pedido"
        const query = `
            UPDATE public.presupuestos
            SET secuencia = 'Armar_Pedido',
                fecha_actualizacion = CURRENT_TIMESTAMP AT TIME ZONE 'America/Argentina/Buenos_Aires'
            WHERE id = $1 
                AND estado = 'Presupuesto/Orden'
                AND activo = true
            RETURNING id, id_presupuesto_ext, secuencia
        `;

        const result = await pool.query(query, [parseInt(id_presupuesto_local)]);

        if (result.rows.length === 0) {
            return res.status(404).json({
                success: false,
                error: 'Presupuesto no encontrado o no se pudo actualizar'
            });
        }

        console.log(`✅ [MARCAR-IMPRESO] Presupuesto ${id_presupuesto_local} → secuencia: Armar_Pedido`);

        res.json({
            success: true,
            data: result.rows[0],
            message: 'Pendiente marcado como impreso'
        });

    } catch (error) {
        console.error('❌ [MARCAR-IMPRESO] Error:', error);
        res.status(500).json({
            success: false,
            error: 'Error interno del servidor',
            message: error.message
        });
    }
};

/**
 * Validar que presupuestos existan y estén activos
 * POST /api/produccion/validar-presupuestos
 * Body: { ids_presupuestos: [123, 456, 789] }
 */
const validarPresupuestos = async (req, res) => {
    try {
        const { ids_presupuestos } = req.body;

        if (!ids_presupuestos || !Array.isArray(ids_presupuestos) || ids_presupuestos.length === 0) {
            return res.status(400).json({
                success: false,
                error: 'Se requiere un array de IDs de presupuestos',
                timestamp: new Date().toISOString()
            });
        }

        console.log('🔍 [VALIDAR-PRES] Validando presupuestos:', ids_presupuestos);

        const query = `
            SELECT 
                id,
                id_presupuesto_ext,
                activo,
                estado,
                CASE 
                    WHEN activo = false THEN 'inactivo'
                    WHEN activo IS NULL THEN 'eliminado'
                    ELSE 'activo'
                END as motivo
            FROM public.presupuestos
            WHERE id = ANY($1::int[])
        `;

        const result = await pool.query(query, [ids_presupuestos]);

        const presupuestosEncontrados = result.rows;
        const idsEncontrados = new Set(presupuestosEncontrados.map(p => p.id));

        // Clasificar presupuestos
        const presupuestosValidos = presupuestosEncontrados.filter(p => p.activo === true);
        const presupuestosInvalidos = [
            ...presupuestosEncontrados.filter(p => p.activo !== true),
            ...ids_presupuestos.filter(id => !idsEncontrados.has(id)).map(id => ({
                id,
                motivo: 'no_existe'
            }))
        ];

        console.log('✅ [VALIDAR-PRES] Válidos:', presupuestosValidos.length);
        console.log('❌ [VALIDAR-PRES] Inválidos:', presupuestosInvalidos.length);

        res.json({
            success: true,
            presupuestos_validos: presupuestosValidos,
            presupuestos_invalidos: presupuestosInvalidos,
            total_validados: ids_presupuestos.length,
            timestamp: new Date().toISOString()
        });

    } catch (error) {
        console.error('❌ [VALIDAR-PRES] Error al validar presupuestos:', error);
        res.status(500).json({
            success: false,
            error: 'Error interno del servidor',
            message: error.message,
            timestamp: new Date().toISOString()
        });
    }
};


/**
 * Dividir presupuesto para entrega parcial
 * POST /dividir-presupuesto
 */
const dividirPresupuesto = async (req, res) => {
    const client = await pool.connect();
    const requestId = `REQ-DIV-${Date.now()}`;

    try {
        const { id_presupuesto_origen, articulos_seleccionados, id_cliente } = req.body;

        if (!id_presupuesto_origen || !articulos_seleccionados || !Array.isArray(articulos_seleccionados) || articulos_seleccionados.length === 0) {
            return res.status(400).json({ error: 'Datos incompletos para división' });
        }

        console.log(`✂️ [DIVIDIR] ${requestId} - Iniciando división presupuesto ${id_presupuesto_origen} con ${articulos_seleccionados.length} items.`);

        await client.query('BEGIN');

        // 1. Obtener datos origen
        const origenQuery = 'SELECT * FROM presupuestos WHERE id = $1';
        const origenResult = await client.query(origenQuery, [id_presupuesto_origen]);

        if (origenResult.rows.length === 0) {
            throw new Error('Presupuesto origen no encontrado');
        }
        const origen = origenResult.rows[0];
        const newExtId = `${origen.id_presupuesto_ext}-P`;

        console.log(`✂️ [DIVIDIR] Generando nuevo header: ${newExtId}`);

        // 2. Clonar Header
        const insertHeader = `
            INSERT INTO presupuestos (
                id_presupuesto_ext, id_cliente, fecha, fecha_entrega, agente, tipo_comprobante,
                cliente_nuevo_id, punto_entrega, descuento, formato_impresion,
                id_ruta, id_domicilio_entrega, orden_entrega,
                secuencia, estado_logistico, nota, activo, fecha_actualizacion,
                bloqueo_entrega, estado
            ) VALUES (
                $1, $2, $3, $4, $5, $6,
                $7, $8, $9, $10,
                $11, $12, $13,
                'Imprimir', 'PENDIENTE', $14, true, NOW(),
                false, $15
            ) RETURNING id
        `;

        const newHeaderRes = await client.query(insertHeader, [
            newExtId, origen.id_cliente, origen.fecha, origen.fecha_entrega, origen.agente, origen.tipo_comprobante,
            origen.cliente_nuevo_id, origen.punto_entrega, origen.descuento, origen.formato_impresion,
            origen.id_ruta, origen.id_domicilio_entrega, origen.orden_entrega,
            (origen.nota || '') + ' | ENTREGA PARCIAL', origen.estado
        ]);

        const newId = newHeaderRes.rows[0].id;
        console.log(`✂️ [DIVIDIR] Nuevo presupuesto creado ID numérico: ${newId}`);

        // 3. Mover Detalles (UPDATE)
        // Usamos UPDATE para preservar precios exáctos (sin insert/delete)
        const updateDetalles = `
            UPDATE presupuestos_detalles
            SET id_presupuesto = $1,
                id_presupuesto_ext = $2,
                fecha_actualizacion = NOW()
            WHERE id_presupuesto = $3
              AND articulo = ANY($4)
        `;

        const updateRes = await client.query(updateDetalles, [newId, newExtId, id_presupuesto_origen, articulos_seleccionados]);
        console.log(`✂️ [DIVIDIR] Detalles movidos: ${updateRes.rowCount}`);

        // 4. Limpiar Pendientes
        const deletePendientes = `
            DELETE FROM faltantes_pendientes_compra
            WHERE id_presupuesto_local = $1
              AND articulo_numero = ANY($2)
        `;
        const deleteRes = await client.query(deletePendientes, [id_presupuesto_origen, articulos_seleccionados]);
        console.log(`✂️ [DIVIDIR] Pendientes eliminados: ${deleteRes.rowCount}`);

        await client.query('COMMIT');
        console.log(`✂️ [DIVIDIR] Transacción OK.`);

        // 5. Sync Fire And Forget
        // Usamos pool porque client ya se libera, y queremos async background
        setImmediate(() => {
            pushToSheetsFireAndForget(newExtId, articulos_seleccionados.length, requestId, pool);
        });

        res.json({ success: true, new_id: newId, new_ext_id: newExtId });

    } catch (e) {
        await client.query('ROLLBACK');
        console.error('❌ [DIVIDIR] Error:', e);
        res.status(500).json({ error: e.message });
    } finally {
        client.release();
    }
};

module.exports = {
    crearPendienteCompra,
    obtenerPendientesCompra,
    obtenerPendientesAgrupados,
    marcarPendienteImpreso,
    revertirPendienteCompra,
    marcarPendienteObsoleto,
    validarPresupuestos,
    dividirPresupuesto
};
