/**
 * Rutas del módulo de facturación
 */

const express = require('express');
const router = express.Router();

console.log('🔍 [FACTURACION-ROUTES] Configurando rutas...');

// Importar controladores
const facturasController = require('../controllers/facturas');
const afipController = require('../controllers/afip');

// Importar middleware
const { requestLogger, errorHandler } = require('../middleware/auth');
const { validarCrearFactura, validarEmitirFactura } = require('../middleware/validation');

// Aplicar logger a todas las rutas
router.use(requestLogger);

// ===== RUTAS DE FACTURAS =====

/**
 * @route POST /facturacion/facturas
 * @desc Crear borrador de factura
 * @access Privado
 */
router.post('/facturas', validarCrearFactura, facturasController.crearFactura);

/**
 * @route PUT /facturacion/facturas/:id
 * @desc Actualizar borrador de factura
 * @access Privado
 */
router.put('/facturas/:id', facturasController.actualizarFactura);

/**
 * @route POST /facturacion/facturas/:id/emitir
 * @desc Emitir factura (AFIP o interna)
 * @access Privado
 */
router.post('/facturas/:id/emitir', validarEmitirFactura, facturasController.emitirFactura);

/**
 * @route GET /facturacion/facturas/:id
 * @desc Obtener factura por ID
 * @access Privado
 */
router.get('/facturas/:id', facturasController.obtenerFactura);

/**
 * @route GET /facturacion/facturas
 * @desc Listar facturas con filtros
 * @access Privado
 */
router.get('/facturas', facturasController.listarFacturas);

/**
 * @route POST /facturacion/facturas/:id/pdf
 * @desc Generar PDF de factura
 * @access Privado
 */
router.post('/facturas/:id/pdf', facturasController.generarPDF);

/**
 * @route POST /facturacion/presupuestos/:id/facturar
 * @desc Crear factura BORRADOR desde presupuesto
 * @access Privado
 */
router.post('/presupuestos/:id/facturar', facturasController.facturarPresupuesto);

/**
 * @route POST /facturacion/presupuestos/:id/sincronizar
 * @desc Sincronizar borrador de factura desde presupuesto
 * @access Privado
 */
router.post('/presupuestos/:id/sincronizar', facturasController.sincronizarBorrador);

/**
 * @route GET /facturacion/facturas/:id/validar-afip
 * @desc Validar factura para AFIP (pre-WSFE)
 * @access Privado
 */
router.get('/facturas/:id/validar-afip', facturasController.validarFacturaAfip);

// ===== RUTAS DE AFIP =====

/**
 * @route GET /facturacion/afip/ultimo
 * @desc Consultar último comprobante autorizado
 * @access Privado
 */
router.get('/afip/ultimo', afipController.obtenerUltimo);

/**
 * @route POST /facturacion/afip/sincronizar
 * @desc Sincronizar numeración con AFIP
 * @access Privado
 */
router.post('/afip/sincronizar', afipController.sincronizar);

/**
 * @route GET /facturacion/afip/auth/status
 * @desc Verificar estado de autenticación con AFIP
 * @access Privado
 */
router.get('/afip/auth/status', afipController.verificarAuth);

/**
 * @route GET /facturacion/afip/numeracion
 * @desc Obtener estado de numeración
 * @access Privado
 */
router.get('/afip/numeracion', afipController.obtenerNumeracion);

/**
 * @route POST /facturacion/afip/homo/ta/refresh
 * @desc Renovar Token de Acceso (TA) de homologación
 * @access Privado
 */
router.post('/afip/homo/ta/refresh', afipController.renovarTAHomo);

/**
 * @route GET /facturacion/devoluciones
 * @desc Buscar Notas de Crédito para conciliación
 * @access Privado
 */
router.get('/devoluciones', facturasController.buscarDevoluciones);

// ===== RUTA DE HEALTH CHECK =====

/**
 * @route GET /facturacion/health
 * @desc Health check del módulo
 * @access Público
 */
router.get('/health', (req, res) => {
    console.log('🔍 [FACTURACION-ROUTES] GET /health - Health check');

    res.json({
        success: true,
        module: 'facturacion',
        status: 'active',
        timestamp: new Date().toISOString(),
        version: '1.0.0',
        features: {
            afip_wsaa: true,
            afip_wsfe: true,
            facturacion_interna: true,
            pdf_generation: false // Pendiente
        }
    });
});

// Middleware de error
router.use(errorHandler);

console.log('✅ [FACTURACION-ROUTES] Rutas configuradas:');
console.log('   📄 POST   /facturacion/facturas');
console.log('   📝 PUT    /facturacion/facturas/:id');
console.log('   📤 POST   /facturacion/facturas/:id/emitir');
console.log('   🔍 GET    /facturacion/facturas/:id');
console.log('   📋 GET    /facturacion/facturas');
console.log('   📑 POST   /facturacion/facturas/:id/pdf');
console.log('   🔄 POST   /facturacion/presupuestos/:id/facturar');
console.log('   ✅ GET    /facturacion/facturas/:id/validar-afip');
console.log('   🔢 GET    /facturacion/afip/ultimo');
console.log('   🔄 POST   /facturacion/afip/sincronizar');
console.log('   🔐 GET    /facturacion/afip/auth/status');
console.log('   📊 GET    /facturacion/afip/numeracion');
console.log('   🔑 POST   /facturacion/afip/homo/ta/refresh');
console.log('   🏥 GET    /facturacion/health');

module.exports = router;
