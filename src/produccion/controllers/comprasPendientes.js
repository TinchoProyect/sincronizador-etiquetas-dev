const pool = require('../config/database');

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

module.exports = {
    crearPendienteCompra,
    obtenerPendientesCompra,
    revertirPendienteCompra,
    marcarPendienteObsoleto,
    validarPresupuestos
};
