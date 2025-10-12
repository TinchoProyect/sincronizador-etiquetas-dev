/**
 * Controlador de facturas
 * Maneja las requests HTTP relacionadas con facturas
 */

const facturaService = require('../services/facturaService');
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
    
    try {
        // STUB: Implementación pendiente
        console.log('⚠️ [FACTURACION-CTRL] STUB: Actualización pendiente de implementar');
        
        res.status(200).json({
            success: true,
            message: 'Funcionalidad en desarrollo',
            data: { id }
        });
        
    } catch (error) {
        console.error('❌ [FACTURACION-CTRL] Error actualizando:', error.message);
        
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
        // STUB: Implementación básica
        const query = `
            SELECT * FROM factura_facturas
            ORDER BY created_at DESC
            LIMIT 50
        `;
        
        const resultado = await pool.query(query);
        
        console.log(`✅ [FACTURACION-CTRL] ${resultado.rows.length} facturas obtenidas`);
        
        res.status(200).json({
            success: true,
            data: resultado.rows,
            total: resultado.rows.length
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
        // STUB: Implementación pendiente
        console.log('⚠️ [FACTURACION-CTRL] STUB: Generación de PDF pendiente');
        
        res.status(200).json({
            success: true,
            message: 'Funcionalidad de PDF en desarrollo',
            data: { id }
        });
        
    } catch (error) {
        console.error('❌ [FACTURACION-CTRL] Error generando PDF:', error.message);
        
        res.status(500).json({
            success: false,
            error: 'Error generando PDF',
            message: error.message
        });
    }
};

console.log('✅ [FACTURACION-CTRL] Controlador de facturas cargado');

module.exports = {
    crearFactura,
    actualizarFactura,
    emitirFactura,
    obtenerFactura,
    listarFacturas,
    generarPDF
};
