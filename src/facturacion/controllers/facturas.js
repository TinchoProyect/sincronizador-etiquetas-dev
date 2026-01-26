/**
 * Controlador de facturas
 * Maneja las requests HTTP relacionadas con facturas
 */

const facturaService = require('../services/facturaService');
const presupuestoFacturaService = require('../services/presupuestoFacturaService');
const validadorAfipService = require('../services/validadorAfipService');
const { pool } = require('../config/database');
const { comaAPunto, puntoAComa } = require('../utils/decimales');

console.log('🔍 [FACTURACION-CTRL] Cargando controlador de facturas...');

/**
 * Crear borrador de factura
 * POST /facturacion/facturas
 * Implementa idempotencia por presupuesto_id
 */
const crearFactura = async (req, res) => {
    console.log('📝 [FACTURACION-CTRL] POST /facturas - Crear borrador');
    console.log('📊 [FACTURACION-CTRL] Datos recibidos:');
    console.log(`   - presupuesto_id: ${req.body.presupuesto_id}`);
    console.log(`   - usar_facturador_nuevo: ${req.body.usar_facturador_nuevo}`);
    console.log(`   - fecha_presupuesto: ${req.body.fecha_presupuesto}`);
    console.log(`   - precio_modo: ${req.body.precio_modo}`);
    console.log(`   - items: ${req.body.items?.length || 0}`);

    try {
        const factura = await facturaService.crearBorrador(req.body);

        // Verificar si es respuesta de idempotencia
        if (factura._idempotente) {
            console.log('⚠️ [FACTURACION-CTRL] Idempotencia detectada - Factura ya existe');
            console.log(`   - factura_id: ${factura.id}`);
            console.log(`   - estado: ${factura.estado}`);

            // Remover flags internos antes de enviar respuesta
            const { _idempotente, _mensaje, ...facturaLimpia } = factura;

            return res.status(409).json({
                success: true,
                idempotente: true,
                message: _mensaje,
                data: {
                    id: facturaLimpia.id,
                    estado: facturaLimpia.estado,
                    presupuesto_id: facturaLimpia.presupuesto_id,
                    imp_total: facturaLimpia.imp_total,
                    created_at: facturaLimpia.created_at
                }
            });
        }

        // Factura nueva creada
        console.log('✅ [FACTURACION-CTRL] Borrador creado exitosamente');
        console.log(`   - factura_id: ${factura.id}`);
        console.log(`   - estado: ${factura.estado}`);
        console.log(`   - imp_total: ${factura.imp_total}`);

        res.status(201).json({
            success: true,
            message: 'Borrador de factura creado exitosamente',
            data: {
                id: factura.id,
                estado: factura.estado,
                tipo_cbte: factura.tipo_cbte,
                pto_vta: factura.pto_vta,
                presupuesto_id: factura.presupuesto_id,
                cliente_id: factura.cliente_id,
                imp_neto: factura.imp_neto,
                imp_iva: factura.imp_iva,
                imp_total: factura.imp_total,
                requiere_afip: factura.requiere_afip,
                serie_interna: factura.serie_interna,
                created_at: factura.created_at
            }
        });

    } catch (error) {
        console.error('❌ [FACTURACION-CTRL] Error creando borrador:', error.message);
        console.error('❌ [FACTURACION-CTRL] Stack:', error.stack);

        res.status(400).json({
            success: false,
            error: 'Error creando borrador de factura',
            message: error.message,
            detalles: process.env.NODE_ENV === 'development' ? error.stack : undefined
        });
    }
};

/**
 * Actualizar borrador de factura
 * PUT /facturacion/facturas/:id
 */
const actualizarFactura = async (req, res) => {
    const { id } = req.params;
    console.log(`📝 [FACTURACION-CTRL] PUT /facturas/${id} - Actualizar borrador`);
    console.log('📊 [FACTURACION-CTRL] Datos recibidos:', req.body);

    try {
        // Verificar que la factura existe y está en BORRADOR
        const checkQuery = 'SELECT estado FROM factura_facturas WHERE id = $1';
        const checkResult = await pool.query(checkQuery, [parseInt(id)]);

        if (checkResult.rows.length === 0) {
            console.error('❌ [FACTURACION-CTRL] Factura no encontrada');
            return res.status(404).json({
                success: false,
                error: 'Factura no encontrada'
            });
        }

        const estado = checkResult.rows[0].estado;
        if (estado !== 'BORRADOR') {
            console.error(`❌ [FACTURACION-CTRL] Factura no es borrador (estado: ${estado})`);
            return res.status(400).json({
                success: false,
                error: 'Solo se pueden editar facturas en estado BORRADOR',
                estado_actual: estado
            });
        }

        console.log('✅ [FACTURACION-CTRL] Factura es BORRADOR, procediendo a actualizar');

        // Construir query de actualización dinámica
        const camposPermitidos = [
            'requiere_afip',
            'serie_interna',
            'doc_tipo',
            'doc_nro',
            'condicion_iva_id',
            'cliente_id',
            'fecha_emision',
            'concepto'
        ];

        const updates = [];
        const valores = [];
        let paramIndex = 1;

        // Agregar campos a actualizar
        for (const campo of camposPermitidos) {
            if (req.body.hasOwnProperty(campo)) {
                updates.push(`${campo} = $${paramIndex}`);
                valores.push(req.body[campo]);
                paramIndex++;
                console.log(`   - Actualizando ${campo}: ${req.body[campo]}`);
            }
        }

        if (updates.length === 0) {
            console.warn('⚠️ [FACTURACION-CTRL] No hay campos para actualizar');
            return res.status(400).json({
                success: false,
                error: 'No se proporcionaron campos para actualizar'
            });
        }

        // Agregar updated_at
        updates.push(`updated_at = NOW()`);

        // Agregar ID al final
        valores.push(parseInt(id));

        // Ejecutar actualización
        const updateQuery = `
            UPDATE factura_facturas 
            SET ${updates.join(', ')}
            WHERE id = $${paramIndex}
            RETURNING *
        `;

        console.log('🔍 [FACTURACION-CTRL] Query:', updateQuery);
        console.log('🔍 [FACTURACION-CTRL] Valores:', valores);

        const resultado = await pool.query(updateQuery, valores);

        if (resultado.rows.length === 0) {
            console.error('❌ [FACTURACION-CTRL] No se pudo actualizar la factura');
            return res.status(500).json({
                success: false,
                error: 'Error actualizando factura'
            });
        }

        const facturaActualizada = resultado.rows[0];
        console.log('✅ [FACTURACION-CTRL] Factura actualizada exitosamente');
        console.log(`   - ID: ${facturaActualizada.id}`);
        console.log(`   - requiere_afip: ${facturaActualizada.requiere_afip}`);
        console.log(`   - doc_tipo: ${facturaActualizada.doc_tipo}`);
        console.log(`   - doc_nro: ${facturaActualizada.doc_nro}`);
        console.log(`   - condicion_iva_id: ${facturaActualizada.condicion_iva_id}`);

        res.status(200).json({
            success: true,
            message: 'Factura actualizada exitosamente',
            data: facturaActualizada
        });

    } catch (error) {
        console.error('❌ [FACTURACION-CTRL] Error actualizando:', error.message);
        console.error('❌ [FACTURACION-CTRL] Stack:', error.stack);

        res.status(400).json({
            success: false,
            error: 'Error actualizando factura',
            message: error.message
        });
    }
};

/**
 * Emitir factura
 * POST /facturacion/facturas/:id/emitir
 */
const emitirFactura = async (req, res) => {
    const { id } = req.params;
    console.log(`📤 [FACTURACION-CTRL] POST /facturas/${id}/emitir - Emitir factura`);

    try {
        const factura = await facturaService.emitir(parseInt(id));

        console.log('✅ [FACTURACION-CTRL] Factura emitida - Estado:', factura.estado);

        res.status(200).json({
            success: true,
            message: 'Factura emitida exitosamente',
            data: factura
        });

    } catch (error) {
        console.error('❌ [FACTURACION-CTRL] Error emitiendo:', error.message);

        res.status(400).json({
            success: false,
            error: 'Error emitiendo factura',
            message: error.message
        });
    }
};

/**
 * Obtener factura por ID
 * GET /facturacion/facturas/:id
 */
const obtenerFactura = async (req, res) => {
    const { id } = req.params;
    console.log(`🔍 [FACTURACION-CTRL] GET /facturas/${id} - Obtener factura`);

    try {
        const factura = await facturaService.obtenerPorId(parseInt(id));

        console.log('✅ [FACTURACION-CTRL] Factura obtenida');

        res.status(200).json({
            success: true,
            data: factura
        });

    } catch (error) {
        console.error('❌ [FACTURACION-CTRL] Error obteniendo factura:', error.message);

        res.status(404).json({
            success: false,
            error: 'Factura no encontrada',
            message: error.message
        });
    }
};

/**
 * Listar facturas con filtros
 * GET /facturacion/facturas
 */
const listarFacturas = async (req, res) => {
    console.log('🔍 [FACTURACION-CTRL] GET /facturas - Listar facturas');
    console.log('📊 [FACTURACION-CTRL] Query params:', req.query);

    try {
        const {
            presupuesto_id,
            fecha_desde,
            fecha_hasta,
            estado,
            tipo_cbte,
            cliente_id,
            limit = 50,
            offset = 0
        } = req.query;

        // Construir query con filtros
        let query = 'SELECT * FROM factura_facturas WHERE 1=1';
        const params = [];
        let paramIndex = 1;

        // Filtro por presupuesto_id (para verificar si ya existe factura)
        if (presupuesto_id) {
            query += ` AND presupuesto_id = $${paramIndex}`;
            params.push(parseInt(presupuesto_id));
            paramIndex++;
            console.log(`   - Filtro presupuesto_id: ${presupuesto_id}`);
        }

        // Filtro por fecha desde
        if (fecha_desde) {
            query += ` AND fecha_emision >= $${paramIndex}`;
            params.push(fecha_desde);
            paramIndex++;
            console.log(`   - Filtro fecha_desde: ${fecha_desde}`);
        }

        // Filtro por fecha hasta
        if (fecha_hasta) {
            query += ` AND fecha_emision <= $${paramIndex}`;
            params.push(fecha_hasta);
            paramIndex++;
            console.log(`   - Filtro fecha_hasta: ${fecha_hasta}`);
        }

        // Filtro por estado
        if (estado) {
            query += ` AND estado = $${paramIndex}`;
            params.push(estado);
            paramIndex++;
            console.log(`   - Filtro estado: ${estado}`);
        }

        // Filtro por tipo de comprobante
        if (tipo_cbte) {
            query += ` AND tipo_cbte = $${paramIndex}`;
            params.push(parseInt(tipo_cbte));
            paramIndex++;
            console.log(`   - Filtro tipo_cbte: ${tipo_cbte}`);
        }

        // Filtro por cliente
        if (cliente_id) {
            query += ` AND cliente_id = $${paramIndex}`;
            params.push(parseInt(cliente_id));
            paramIndex++;
            console.log(`   - Filtro cliente_id: ${cliente_id}`);
        }

        // Ordenar y limitar
        query += ` ORDER BY created_at DESC LIMIT $${paramIndex} OFFSET $${paramIndex + 1}`;
        params.push(parseInt(limit), parseInt(offset));

        const resultado = await pool.query(query, params);

        console.log(`✅ [FACTURACION-CTRL] ${resultado.rows.length} facturas obtenidas`);

        res.status(200).json({
            success: true,
            data: resultado.rows,
            total: resultado.rows.length,
            limit: parseInt(limit),
            offset: parseInt(offset)
        });

    } catch (error) {
        console.error('❌ [FACTURACION-CTRL] Error listando facturas:', error.message);

        res.status(500).json({
            success: false,
            error: 'Error listando facturas',
            message: error.message
        });
    }
};

/**
 * Generar PDF de factura
 * POST /facturacion/facturas/:id/pdf
 */
const generarPDF = async (req, res) => {
    const { id } = req.params;
    console.log(`📄 [FACTURACION-CTRL] POST /facturas/${id}/pdf - Generar PDF`);

    try {
        // Obtener datos completos de la factura
        const factura = await facturaService.obtenerPorId(parseInt(id));

        if (!factura) {
            console.error('❌ [FACTURACION-CTRL] Factura no encontrada');
            return res.status(404).json({
                success: false,
                error: 'Factura no encontrada'
            });
        }

        console.log('✅ [FACTURACION-CTRL] Factura obtenida para PDF');

        // Obtener items de la factura
        const itemsQuery = `
            SELECT * FROM factura_factura_items
            WHERE factura_id = $1
            ORDER BY id ASC
        `;
        const itemsResult = await pool.query(itemsQuery, [parseInt(id)]);
        const items = itemsResult.rows;

        console.log(`📄 [FACTURACION-CTRL] ${items.length} items obtenidos para PDF`);

        // Importar generador de PDF
        const { generarPDF: generarPDFServicio } = require('../pdf/generador');

        // Generar PDF
        const pdfBuffer = await generarPDFServicio(factura, items);

        // Configurar headers de respuesta
        const fechaArchivo = new Date().toISOString().split('T')[0].replace(/-/g, '');
        const numeroComprobante = factura.cbte_nro ?
            `${String(factura.pto_vta).padStart(4, '0')}-${String(factura.cbte_nro).padStart(8, '0')}` :
            `BORRADOR-${factura.serie_interna}-${factura.nro_interno}`;

        const nombreArchivo = `factura-${numeroComprobante}-${fechaArchivo}.pdf`;

        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', `attachment; filename="${nombreArchivo}"`);

        console.log(`✅ [FACTURACION-CTRL] PDF generado exitosamente: ${nombreArchivo}`);

        // Enviar PDF
        res.send(pdfBuffer);

    } catch (error) {
        console.error('❌ [FACTURACION-CTRL] Error generando PDF:', error.message);
        console.error('❌ [FACTURACION-CTRL] Stack:', error.stack);

        res.status(500).json({
            success: false,
            error: 'Error generando PDF',
            message: error.message
        });
    }
};

/**
 * Facturar presupuesto (crear factura BORRADOR desde presupuesto)
 * POST /facturacion/presupuestos/:id/facturar
 */
const facturarPresupuesto = async (req, res) => {
    const { id } = req.params;
    console.log(`🔄 [FACTURACION-CTRL] POST /presupuestos/${id}/facturar - Facturar presupuesto`);

    try {
        // Crear factura desde presupuesto
        const resultado = await presupuestoFacturaService.facturarPresupuesto(parseInt(id));

        console.log('✅ [FACTURACION-CTRL] Factura creada desde presupuesto');
        console.log(`   - factura_id: ${resultado.facturaId}`);
        console.log(`   - items: ${resultado.itemsCount}`);
        console.log(`   - total: ${resultado.totales.imp_total}`);

        // Validar automáticamente
        console.log('🔍 [FACTURACION-CTRL] Validando factura automáticamente...');
        const validacion = await validadorAfipService.validarFacturaParaAfip(resultado.facturaId);

        res.status(201).json({
            success: true,
            message: 'Factura creada exitosamente desde presupuesto',
            data: {
                factura_id: resultado.facturaId,
                presupuesto_id: resultado.presupuestoId,
                totales: resultado.totales,
                items_count: resultado.itemsCount,
                validacion: {
                    ready_for_wsfe: validacion.readyForWSFE,
                    faltantes: validacion.faltantes,
                    advertencias: validacion.advertencias
                }
            }
        });

    } catch (error) {
        console.error('❌ [FACTURACION-CTRL] Error facturando presupuesto:', error.message);
        console.error('❌ [FACTURACION-CTRL] Stack:', error.stack);

        // Verificar si es error de factura duplicada
        if (error.message.includes('Ya existe una factura')) {
            return res.status(409).json({
                success: false,
                error: 'Factura duplicada',
                message: error.message
            });
        }

        res.status(400).json({
            success: false,
            error: 'Error facturando presupuesto',
            message: error.message,
            detalles: process.env.NODE_ENV === 'development' ? error.stack : undefined
        });
    }
};

/**
 * Validar factura para AFIP (pre-WSFE)
 * GET /facturacion/facturas/:id/validar-afip
 */
const validarFacturaAfip = async (req, res) => {
    const { id } = req.params;
    console.log(`🔍 [FACTURACION-CTRL] GET /facturas/${id}/validar-afip - Validar para AFIP`);

    try {
        const validacion = await validadorAfipService.validarFacturaParaAfip(parseInt(id));

        console.log(`${validacion.readyForWSFE ? '✅' : '⚠️'} [FACTURACION-CTRL] Validación completada`);
        console.log(`   - ready_for_wsfe: ${validacion.readyForWSFE}`);
        console.log(`   - faltantes: ${validacion.faltantes.length}`);
        console.log(`   - advertencias: ${validacion.advertencias.length}`);

        res.status(200).json({
            success: true,
            data: validacion
        });

    } catch (error) {
        console.error('❌ [FACTURACION-CTRL] Error validando factura:', error.message);

        res.status(400).json({
            success: false,
            error: 'Error validando factura',
            message: error.message
        });
    }
};

/**
 * Buscar devoluciones (Notas de Crédito) para conciliación
 * GET /facturacion/devoluciones
 */
const buscarDevoluciones = async (req, res) => {
    console.log('🔍 [FACTURACION-CTRL] GET /devoluciones - Buscar NC para conciliación');
    const { cliente, articulo, cantidad, fecha } = req.query;

    console.log('📊 [FACTURACION-CTRL] Parametros:', { cliente, articulo, cantidad, fecha });

    if (!cliente || !articulo) {
        return res.status(400).json({ error: 'Faltan parámetros: cliente y articulo son requeridos' });
    }

    try {
        // Query para buscar Notas de Crédito (tipo_cbte = 3, 8, 13, etc... o simplemente por string 'Nota de Crédito')
        // Asumiendo que tipo_cbte para NC A es 3, NC B es 8, NC C es 13.
        // O mejor, buscamos por items que coincidan con la descripción o código.

        // Estrategia: Buscar items de facturas que sean NC y contengan el articulo
        // Y que sean de ese cliente.
        // Fecha límite: 30 días hacia atrás desde la fecha provista.

        const fechaLimite = new Date(fecha);
        fechaLimite.setDate(fechaLimite.getDate() - 30);
        const fechaLimiteStr = fechaLimite.toISOString().split('T')[0];

        // 1. Buscamos Facturas NC del cliente en el rango de fecha
        // JOIN con items para buscar el articulo
        const query = `
            SELECT 
                f.id, f.fecha_emision, f.pto_vta, f.cbte_nro as numero_comprobante, f.imp_total, f.imp_neto,
                CASE 
                    WHEN f.tipo_cbte = 3 THEN 'Nota de Crédito A' 
                    WHEN f.tipo_cbte = 8 THEN 'Nota de Crédito B' 
                    WHEN f.tipo_cbte = 13 THEN 'Nota de Crédito C'
                    ELSE 'Nota de Crédito'
                END as tipo_comprobante,
                i.descripcion as item_descripcion, i.qty as item_cantidad
            FROM factura_facturas f
            JOIN factura_factura_items i ON f.id = i.factura_id
            WHERE 
                f.cliente_id = $1
                AND f.fecha_emision >= $2
                AND f.tipo_cbte IN (3, 8, 13) -- Códigos AFIP para N/C
                AND f.estado IN ('APROBADA', 'APROBADA_LOCAL')
                AND (i.descripcion ILIKE $3 OR i.descripcion ILIKE $4) -- Buscar por código o descripción parcial
            ORDER BY f.fecha_emision DESC
        `;

        // Parametro de busqueda flexible para el articulo
        const searchPattern = `%${articulo}%`;

        const result = await pool.query(query, [cliente, fechaLimiteStr, articulo, searchPattern]);

        console.log(`✅ [FACTURACION-CTRL] Encontradas ${result.rows.length} coincidencias`);

        res.json(result.rows);

    } catch (error) {
        console.error('❌ [FACTURACION-CTRL] Error buscando devoluciones:', error.message);
        res.status(500).json({ error: 'Error interno buscando devoluciones' });
    }
};

console.log('✅ [FACTURACION-CTRL] Controlador de facturas cargado');

module.exports = {
    crearFactura,
    actualizarFactura,
    emitirFactura,
    obtenerFactura,
    listarFacturas,
    generarPDF,
    facturarPresupuesto,
    validarFacturaAfip,
    buscarDevoluciones
};
