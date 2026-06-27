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
        if (req.body.es_nota_credito && req.body.factura_asociada_id) {
            console.log(`📝 [FACTURACION-CTRL] Autocompletando cliente desde factura original ${req.body.factura_asociada_id}`);
            const checkFacturaOriginal = `SELECT cliente_id, doc_tipo, doc_nro, condicion_iva_id FROM factura_facturas WHERE id = $1`;
            const resultOriginal = await pool.query(checkFacturaOriginal, [req.body.factura_asociada_id]);

            if (resultOriginal.rows.length > 0) {
                const fOrig = resultOriginal.rows[0];
                req.body.cliente = {
                    cliente_id: fOrig.cliente_id,
                    doc_tipo: fOrig.doc_tipo,
                    doc_nro: fOrig.doc_nro,
                    condicion_iva_id: fOrig.condicion_iva_id
                };
            }
        }

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
        if (estado !== 'BORRADOR' && estado !== 'RECHAZADA') {
            console.error(`❌ [FACTURACION-CTRL] Factura no es borrador ni rechazada (estado: ${estado})`);
            return res.status(400).json({
                success: false,
                error: 'Solo se pueden editar facturas en estado BORRADOR o RECHAZADA',
                estado_actual: estado
            });
        }

        console.log('✅ [FACTURACION-CTRL] Factura es BORRADOR o RECHAZADA, procediendo a actualizar');

        // Construir query de actualización dinámica
        const camposPermitidos = [
            'requiere_afip',
            'serie_interna',
            'doc_tipo',
            'doc_nro',
            'condicion_iva_id',
            'cliente_id',
            'fecha_emision',
            'concepto',
            'tipo_cbte',
            'factura_asociada_id'
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
            message: 'Rechazado por AFIP',
            detalle: error.message
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
            cliente,
            tipo_circuito,
            limit = 50,
            offset = 0
        } = req.query;

        // Construir query con filtros (retornando razon_social)
        let query = `
            SELECT 
                f.*,
                bc.id as bunker_cliente_id,
                COALESCE(NULLIF(TRIM(bc.razon_social), ''), NULLIF(TRIM(bc.cliente_nombre), ''), NULLIF(TRIM(c.apellido), '')) as razon_social,
                COALESCE(NULLIF(TRIM(bc.cuit_cuil), ''), NULLIF(TRIM(c.cuit), ''), NULLIF(TRIM(c.dni), '')) as cliente_cuit,
                COALESCE(NULLIF(TRIM(bc.domicilio_fiscal), ''), NULLIF(TRIM(c.domicilio), '')) as cliente_domicilio,
                COALESCE(NULLIF(TRIM(bc.provincia), ''), NULLIF(TRIM(c.provincia), '')) as cliente_provincia,
                COALESCE(NULLIF(TRIM(bc.condicion_iva), ''), NULLIF(TRIM(c.condicion_iva), '')) as cliente_condicion_iva,
                COALESCE(bc.whatsapp_facturas, c.celular, c.telefono) as whatsapp_facturas,
                bc.email_facturas as email_facturas,
                COALESCE(bc.canal_envio_preferido, 'whatsapp') as canal_envio_preferido
            FROM factura_facturas f
            LEFT JOIN clientes c ON f.cliente_id = c.cliente_id
            LEFT JOIN bunker_clientes bc ON 
                (CASE 
                    WHEN bc.lomas_soft_id ~ '^\\d+$' THEN bc.lomas_soft_id::integer 
                    ELSE NULL 
                END) = f.cliente_id
            WHERE 1=1
        `;
        const params = [];
        let paramIndex = 1;

        // --- FILTRO PROVISIONAL ESTRICTO PARA HOMOLOGACIÓN ---
        // Si no piden ver pruebas, ocultamos todo lo anterior al ID 90 (o el que consideremos "real")
        // Actualmente tenemos basura hasta el 90 aprox. 
        if (req.query.es_prueba !== 'true') {
            // "Ocultar pruebas": solo mostrar facturas con id > 100 
            // (Ajustar este número al momento de salir a PROD real, ej: id > 150)
            query += ` AND f.id > 100`;
        }

        // Filtro por tipo de circuito
        if (tipo_circuito) {
            if (tipo_circuito === 'oficial') {
                query += ` AND f.pto_vta != 90`;
            } else if (tipo_circuito === 'interno') {
                query += ` AND f.pto_vta = 90`;
            }
            console.log(`   - Filtro tipo_circuito: ${tipo_circuito}`);
        }

        // Filtro por presupuesto_id (para verificar si ya existe factura)
        if (presupuesto_id) {
            query += ` AND f.presupuesto_id = $${paramIndex}`;
            params.push(parseInt(presupuesto_id));
            paramIndex++;
            console.log(`   - Filtro presupuesto_id: ${presupuesto_id}`);
        }

        // Filtro por fecha desde
        if (fecha_desde) {
            query += ` AND f.fecha_emision >= $${paramIndex}`;
            params.push(fecha_desde);
            paramIndex++;
            console.log(`   - Filtro fecha_desde: ${fecha_desde}`);
        }

        // Filtro por fecha hasta
        if (fecha_hasta) {
            query += ` AND f.fecha_emision <= $${paramIndex}`;
            params.push(fecha_hasta);
            paramIndex++;
            console.log(`   - Filtro fecha_hasta: ${fecha_hasta}`);
        }

        // Filtro por estado
        if (estado) {
            query += ` AND f.estado = $${paramIndex}`;
            params.push(estado);
            paramIndex++;
            console.log(`   - Filtro estado: ${estado}`);
        }

        // Filtro por tipo de comprobante
        if (tipo_cbte) {
            query += ` AND f.tipo_cbte = $${paramIndex}`;
            params.push(parseInt(tipo_cbte));
            paramIndex++;
            console.log(`   - Filtro tipo_cbte: ${tipo_cbte}`);
        }

        // Filtro por ID de cliente
        if (cliente_id) {
            query += ` AND f.cliente_id = $${paramIndex}`;
            params.push(parseInt(cliente_id));
            paramIndex++;
            console.log(`   - Filtro cliente_id: ${cliente_id}`);
        }

        // Filtro por búsqueda de texto de cliente (Razón social, nombre, CUIT/DNI)
        if (cliente) {
            query += ` AND (
                COALESCE(bc.razon_social, bc.cliente_nombre, c.apellido) ILIKE $${paramIndex}
                OR f.doc_nro::text ILIKE $${paramIndex}
            )`;
            params.push(`%${cliente}%`);
            paramIndex++;
            console.log(`   - Filtro cliente search: ${cliente}`);
        }

        // Ordenar y limitar
        query += ` ORDER BY f.created_at DESC LIMIT $${paramIndex} OFFSET $${paramIndex + 1}`;
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
            SELECT 
                i.id, 
                i.factura_id, 
                i.qty, 
                i.p_unit, 
                i.alic_iva_id, 
                i.imp_neto, 
                i.imp_iva, 
                i.orden, 
                i.created_at,
                COALESCE(
                    a.nombre, 
                    (SELECT nombre FROM public.articulos WHERE codigo_barras = REPLACE(i.descripcion, 'Devolución: ', '') OR numero = REPLACE(i.descripcion, 'Devolución: ', '') LIMIT 1),
                    i.descripcion
                ) as descripcion
            FROM public.factura_factura_items i
            LEFT JOIN public.articulos a ON (a.codigo_barras = i.descripcion OR a.numero = i.descripcion)
            WHERE i.factura_id = $1
            ORDER BY i.id ASC
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

/**
 * Sincronizar comprobante (borrador) con su presupuesto actualizado
 * POST /facturacion/presupuestos/:id/sincronizar
 */
const sincronizarBorrador = async (req, res) => {
    const { id } = req.params;
    console.log(`🔄 [FACTURACION-CTRL] POST /presupuestos/${id}/sincronizar - Sincronizar borrador`);

    try {
        const result = await presupuestoFacturaService.sincronizarBorrador(id);

        res.status(200).json({
            success: true,
            message: 'Borrador de factura sincronizado exitosamente con el presupuesto',
            data: result
        });

    } catch (error) {
        console.error('❌ [FACTURACION-CTRL] Error sincronizando borrador desde presupuesto:', error.message);
        console.error('❌ [FACTURACION-CTRL] Stack:', error.stack);

        res.status(400).json({
            success: false,
            error: 'Error sincronizando factura borrador',
            message: error.message
        });
    }
};

/**
 * Eliminar factura en estado BORRADOR
 * DELETE /facturacion/facturas/:id
 */
const eliminarBorrador = async (req, res) => {
    const { id } = req.params;
    console.log(`🗑️ [FACTURACION-CTRL] DELETE /facturas/${id} - Eliminar borrador`);

    try {
        // Verificar que la factura existe y está en BORRADOR (y que NO tenga CAE)
        const checkQuery = 'SELECT estado, cae FROM factura_facturas WHERE id = $1';
        const checkResult = await pool.query(checkQuery, [parseInt(id)]);

        if (checkResult.rows.length === 0) {
            return res.status(404).json({ success: false, error: 'Factura no encontrada' });
        }

        const f = checkResult.rows[0];
        if (f.cae) {
            return res.status(400).json({ success: false, error: 'Rechazado: La factura ya posee CAE y valor fiscal.' });
        }
        const estadosPermitidos = ['BORRADOR', 'RECHAZADA', 'ANULADA', 'APROBADA_LOCAL'];
        if (!estadosPermitidos.includes(f.estado)) {
            return res.status(400).json({ success: false, error: 'Solo se pueden eliminar facturas en estado BORRADOR, RECHAZADA, ANULADA o comprobantes locales.' });
        }

        // Obtener el presupuesto_id antes de eliminar para restaurar su estado
        const getPresupuestoIdQuery = 'SELECT presupuesto_id FROM factura_facturas WHERE id = $1';
        const getPresupuestoIdResult = await pool.query(getPresupuestoIdQuery, [parseInt(id)]);
        const presupuestoId = getPresupuestoIdResult.rows[0]?.presupuesto_id;

        // Eliminar items primero por foreign key
        await pool.query('DELETE FROM factura_factura_items WHERE factura_id = $1', [parseInt(id)]);
        // Eliminar factura
        await pool.query('DELETE FROM factura_facturas WHERE id = $1', [parseInt(id)]);

        // Si la factura estaba vinculada a un presupuesto, limpiar vinculación y restaurar estado
        if (presupuestoId) {
            await pool.query(
                `UPDATE public.presupuestos SET factura_id = NULL, estado = 'Presupuesto/Orden' WHERE id = $1`,
                [presupuestoId]
            );
            console.log(`🔗 [FACTURACION-CTRL] Presupuesto ${presupuestoId} desvinculado y restaurado a 'Presupuesto/Orden'`);
        }

        console.log(`✅ [FACTURACION-CTRL] Borrador #${id} eliminado exitosamente`);
        res.status(200).json({ success: true, message: 'Borrador eliminado exitosamente' });

    } catch (error) {
        console.error('❌ [FACTURACION-CTRL] Error eliminando borrador:', error.message);
        res.status(500).json({ success: false, error: 'Error interno eliminando borrador' });
    }
};

/**
 * Anular factura (genera y emite Nota de Crédito espejo)
 * POST /facturacion/facturas/:id/anular
 */
const anularFactura = async (req, res) => {
    const { id } = req.params;
    const usuario = req.body.usuario || 'Sistema';

    console.log(`🚫 [FACTURACION-CTRL] POST /facturas/${id}/anular - Anular factura`);

    try {
        // 1. Crear borrador de Nota de Crédito espejo
        const ncId = await facturaService.anular(parseInt(id), usuario);
        console.log(`✅ [FACTURACION-CTRL] Borrador de NC creado ID: ${ncId}. Procediendo a emitir...`);

        // 2. Emitir la Nota de Crédito
        const ncEmitida = await facturaService.emitir(ncId);
        console.log(`✅ [FACTURACION-CTRL] Nota de Crédito emitida ID: ${ncId}. Estado: ${ncEmitida.estado}`);

        res.status(200).json({
            success: true,
            message: 'Comprobante anulado exitosamente',
            data: ncEmitida
        });

    } catch (error) {
        console.error('❌ [FACTURACION-CTRL] Error en anularFactura:', error.message);
        res.status(400).json({
            success: false,
            error: 'Error anulando factura',
            message: error.message
        });
    }
};

/**
 * Facturar presupuesto local (nace emitido localmente con Puesto 90 y sin AFIP)
 * POST /facturacion/presupuestos/:id/facturar-local
 */
const facturarPresupuestoLocal = async (req, res) => {
    const { id } = req.params;
    console.log(`🔄 [FACTURACION-CTRL] POST /presupuestos/${id}/facturar-local - Crear borrador local (Puesto 90)`);

    try {
        // 1. Crear borrador de factura con pto_vta: 90 y requiere_afip: false
        const resultado = await presupuestoFacturaService.facturarPresupuesto(parseInt(id), 90, false);
        console.log(`✅ [FACTURACION-CTRL] Factura local borrador creada con ID: ${resultado.facturaId}`);

        res.status(201).json({
            success: true,
            message: 'Borrador de presupuesto aprobado interno creado exitosamente',
            data: {
                factura_id: resultado.facturaId,
                presupuesto_id: resultado.presupuestoId,
                totales: resultado.totales,
                items_count: resultado.itemsCount
            }
        });

    } catch (error) {
        console.error('❌ [FACTURACION-CTRL] Error facturando presupuesto local:', error.message);
        console.error('❌ [FACTURACION-CTRL] Stack:', error.stack);

        if (error.message.includes('Ya existe una factura')) {
            return res.status(409).json({
                success: false,
                error: 'Factura duplicada',
                message: error.message
            });
        }

        res.status(400).json({
            success: false,
            error: 'Error facturando presupuesto local',
            message: error.message
        });
    }
};

/**
 * Obtener factura heredada (Lomasoft) mapeada desde presupuesto
 * GET /facturacion/facturas/heredadas/:presupuestoId
 */
const obtenerFacturaHeredada = async (req, res) => {
    const { presupuestoId } = req.params;
    console.log(`🔍 [FACTURACION-CTRL] GET /facturas/heredadas/${presupuestoId} - Obtener factura heredada`);

    try {
        const pId = parseInt(presupuestoId);
        
        // 1. Obtener cabecera de presupuesto y datos del cliente
        const queryHeader = `
            SELECT 
                p.id, p.fecha, p.id_cliente, p.nota,
                bc.razon_social, bc.cuit_cuil, bc.codigo_bunker_cliente, bc.condicion_iva, bc.domicilio_fiscal, bc.provincia
            FROM public.presupuestos p
            LEFT JOIN public.bunker_clientes bc ON CAST(bc.lomas_soft_id AS INTEGER) = CAST(p.id_cliente AS INTEGER)
            WHERE p.id = $1
        `;
        const resHeader = await pool.query(queryHeader, [pId]);
        if (resHeader.rows.length === 0) {
            throw new Error(`Presupuesto heredado ID ${pId} no encontrado`);
        }
        const budget = resHeader.rows[0];

        // 2. Obtener items
        const queryItems = `
            SELECT 
                d.id,
                d.articulo as codigo_barras,
                d.cantidad as qty,
                d.valor1 as imp_neto,
                d.precio1 as imp_total,
                d.iva1 as imp_iva,
                COALESCE(art.nombre, 'Artículo ' || d.articulo) as descripcion
            FROM public.presupuestos_detalles d
            LEFT JOIN public.articulos art ON art.codigo_barras = d.articulo
            WHERE d.id_presupuesto = $1
        `;
        const resItems = await pool.query(queryItems, [pId]);
        const items = resItems.rows;

        // Calcular totales de la factura
        let impNeto = 0;
        let impIva = 0;
        let impTotal = 0;
        
        items.forEach(item => {
            impNeto += parseFloat(item.imp_neto) || 0;
            impIva += parseFloat(item.imp_iva) || 0;
            impTotal += parseFloat(item.imp_total) || 0;
            const quantity = parseFloat(item.qty) || 1;
            item.p_unit = (parseFloat(item.imp_neto) || 0) / quantity;
        });

        // 3. Estructurar el objeto factura mock
        const factura = {
            id: `heredada-${budget.id}`,
            presupuesto_id: budget.id,
            cliente_id: budget.id_cliente,
            razon_social: budget.razon_social || 'Cliente Histórico Lomasoft',
            cliente_cuit: budget.cuit_cuil || 'N/D',
            cliente_domicilio: budget.domicilio_fiscal || 'Sin Dirección',
            cliente_provincia: budget.provincia || 'Provincia',
            cliente_condicion_iva: budget.condicion_iva || 'Consumidor Final',
            fecha: budget.fecha,
            creado_en: budget.fecha,
            pto_vta: 90, 
            tipo_cbte: 11, 
            nro_cbte: budget.id,
            estado: 'APROBADA_LOCAL', 
            observaciones: 'Comprobante histórico migrado de Lomasoft',
            descuento: 0,
            imp_neto: impNeto,
            imp_iva: impIva,
            imp_total: impTotal,
            cae: null,
            cae_vto: null,
            items: items,
            es_heredada: true 
        };

        res.status(200).json({
            success: true,
            data: factura
        });

    } catch (error) {
        console.error('❌ [FACTURACION-CTRL] Error obteniendo factura heredada:', error.message);
        res.status(404).json({
            success: false,
            error: 'Factura heredada no encontrada',
            message: error.message
        });
    }
};

module.exports = {
    crearFactura,
    actualizarFactura,
    emitirFactura,
    obtenerFactura,
    obtenerFacturaHeredada,
    listarFacturas,
    generarPDF,
    facturarPresupuesto,
    facturarPresupuestoLocal,
    sincronizarBorrador,
    validarFacturaAfip,
    buscarDevoluciones,
    eliminarBorrador,
    anularFactura
};
