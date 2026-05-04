const express = require('express');
const router = express.Router();

console.log('🔍 [PRESUPUESTOS] Configurando rutas del módulo...');

// Importar controladores reales
const {
    obtenerPresupuestos,
    obtenerSugerenciasClientes,
    obtenerSugerenciasArticulos,
    obtenerPresupuestoPorId,
    obtenerDetallesPresupuesto,
    obtenerEstados,
    actualizarEstadoPresupuesto,
    obtenerEstadisticas,
    obtenerConfiguracion,
    obtenerResumen,
    obtenerPrecioArticuloCliente,
    obtenerDatosCliente,
    obtenerHistorialEntregasCliente,
    obtenerCatalogoGeneral,
    obtenerArticulosExcluidos,
    excluirArticulo,
    reincluirArticulo
} = require('../controllers/presupuestos');


// Importar controladores de Google Sheets
const {
    verificarAutenticacion,
    iniciarAutenticacion,
    completarAutenticacion,
    validarHoja,
    configurarHoja,
    ejecutarSincronizacion,
    obtenerHistorial,
    obtenerEstadoSync
} = require('../controllers/gsheets');

// Importar controlador de Full Refresh Sync
const {
    executeFullRefresh,
    getSyncStatus,
    executeDryRun,
    getSyncHistory,
    getDatabaseStats
} = require('../controllers/sync_full_refresh');

// Importar controlador de Corrección de Fechas
const {
    ejecutarCorreccion,
    obtenerEstadisticasFechas,
    obtenerHistorialCorrecciones,
    validarConfiguracion,
    ejecutarPushAltas,
    ejecutarSincronizacionBidireccional,
    ejecutarSincronizacionBidireccionalSafe  // NUEVO
} = require('../controllers/sync_fechas_fix');

// Importar controlador de Configuración de Autosync
const {
    obtenerConfiguracionSync,
    actualizarConfiguracionSync,
    obtenerEstadoSalud
} = require('../controllers/sync_config');

// Importar Controlador de Faltantes (Demanda No Satisfecha)
const {
    getDashboardFaltantesController
} = require('../controllers/presupuestosDashboardFaltantes');

// Importar controlador de escritura
const {
    crearPresupuesto: crearPresupuestoWrite,
    editarPresupuesto: editarPresupuestoWrite,
    eliminarPresupuesto: eliminarPresupuestoWrite,
    reintentarPresupuesto,
    obtenerEstadoPresupuesto,
    actualizarFormatoImpresion
} = require('../controllers/presupuestosWrite');

// Importar controlador de Lomasoft (Conciliación)
const {
    buscarCandidatasLomasoft,
    confirmarConciliacion,
    desconciliarLomasoft
} = require('../controllers/presupuestosLomasoft');

// Importar middleware
const { validateSession, validatePermissions } = require('../middleware/auth');
const {
    validarCrearPresupuesto,
    validarActualizarPresupuesto,
    validarIdPresupuesto,
    validarFiltros,
    validarResumen,
    sanitizarDatos
} = require('../middleware/validation');

// ⚠️ Idempotencia desactivada temporalmente (causaba cuelgue antes del handler)
// const { idempotencyMiddleware } = require('../middleware/idempotency');

// Aplicar middleware de autenticación a todas las rutas
router.use(validateSession);

// ==========================================
// 📄 GENERACIÓN DE PDF HEADLESS (PUPPETEER)
// ==========================================

/**
 * @route GET /api/presupuestos/:id/pdf
 * @desc Generar PDF binario del presupuesto usando Chrome Headless para Compartir Nativo
 * @access Privado
 */
router.get('/:id/pdf', validatePermissions('presupuestos.read'), async (req, res) => {
    const { generarPDFPresupuesto } = require('../controllers/pdfGenerator');
    await generarPDFPresupuesto(req, res);
});

/**
 * @route GET /api/presupuestos
 * @desc Obtener todos los presupuestos con filtros avanzados
 * @access Privado
 */
router.get('/', validatePermissions('presupuestos.read'), sanitizarDatos, validarFiltros, async (req, res) => {
    console.log('🔍 [PRESUPUESTOS] Ruta GET / - Obteniendo todos los presupuestos');
    try {
        await obtenerPresupuestos(req, res);
    } catch (error) {
        console.error('❌ [PRESUPUESTOS] Error en ruta GET /:', error);
        res.status(500).json({
            success: false,
            error: 'Error interno en la ruta de presupuestos',
            message: error.message
        });
    }
});

/**
 * @route POST /api/presupuestos/sync/bidireccional
 * @desc Ejecutar sincronización bidireccional (push + pull) con regla "gana el último cambio"
 * @access Privado
 */
router.post('/sync/bidireccional', validatePermissions('presupuestos.sync'), async (req, res) => {
    console.log('[SYNC-BIDI] Iniciando sincronización bidireccional con filtros cutoff_at...');

    try {
        await ejecutarSincronizacionBidireccional(req, res);
    } catch (error) {
        console.error('[SYNC-BIDI] Error en sincronización bidireccional:', error.message);
        res.status(500).json({
            success: false,
            code: 'SYNC_BIDI_ERROR',
            message: 'Error interno en sincronización bidireccional',
            details: error.message,
            timestamp: new Date().toISOString()
        });
    }
});

/**
 * @route POST /api/presupuestos/sync/bidireccional-safe
 * @desc Ejecutar sincronización bidireccional TOLERANTE A CUOTAS (NUEVO)
 * @access Privado
 */
router.post('/sync/bidireccional-safe', validatePermissions('presupuestos.sync'), async (req, res) => {
    console.log('[SYNC-BIDI-SAFE] Iniciando sincronización bidireccional tolerante a cuotas...');

    try {
        await ejecutarSincronizacionBidireccionalSafe(req, res);
    } catch (error) {
        console.error('[SYNC-BIDI-SAFE] Error en sincronización:', error.message);
        res.status(500).json({
            success: false,
            code: 'SYNC_BIDI_SAFE_ERROR',
            message: 'Error interno en sincronización tolerante a cuotas',
            details: error.message,
            timestamp: new Date().toISOString()
        });
    }
});

/**
 * @route GET /api/presupuestos/faltantes/dashboard
 * @desc Obtener dashboard analítico de demanda no satisfecha
 * @access Privado
 */
router.get('/faltantes/dashboard', validatePermissions('presupuestos.read'), async (req, res) => {
    try {
        await getDashboardFaltantesController(req, res);
    } catch (error) {
        res.status(500).json({ success: false, error: 'Error del enrutador', message: error.message });
    }
});

/**
 * @route GET /api/presupuestos/estado/:estado
 * @desc Obtener presupuestos por estado específico
 * @access Privado
 */
router.get('/estado/:estado', validatePermissions('presupuestos.read'), async (req, res) => {
    const { estado } = req.params;
    console.log(`🔍 [PRESUPUESTOS] Ruta GET /estado/${estado} - Obteniendo presupuestos por estado`);

    try {
        req.query.estado = estado;
        await obtenerPresupuestos(req, res);
    } catch (error) {
        console.error(`❌ [PRESUPUESTOS] Error en ruta GET /estado/${estado}:`, error);
        res.status(500).json({
            success: false,
            error: 'Error interno en la ruta de estado',
            message: error.message
        });
    }
});

/**
 * @route GET /api/presupuestos/clientes/sugerencias
 * @desc Obtener sugerencias de clientes para typeahead
 * @access Privado
 */
router.get('/clientes/sugerencias', validatePermissions('presupuestos.read'), async (req, res) => {
    console.log('🔍 [PRESUPUESTOS] Ruta GET /clientes/sugerencias - Obteniendo sugerencias de clientes');

    try {
        await obtenerSugerenciasClientes(req, res);
    } catch (error) {
        console.error('❌ [PRESUPUESTOS] Error en ruta GET /clientes/sugerencias:', error);
        res.status(500).json({
            success: false,
            error: 'Error interno en la ruta de sugerencias de clientes',
            message: error.message
        });
    }
});

/**
 * @route GET /api/presupuestos/clientes/:id_cliente
 * @desc Obtener datos del cliente por ID (incluyendo condicion_iva)
 * @access Privado
 */
router.get('/clientes/:id_cliente', validatePermissions('presupuestos.read'), async (req, res) => {
    console.log('🔍 [PRESUPUESTOS] Ruta GET /clientes/:id_cliente - Obteniendo datos del cliente');

    try {
        await obtenerDatosCliente(req, res);
    } catch (error) {
        console.error('❌ [PRESUPUESTOS] Error en ruta GET /clientes/:id_cliente:', error);
        res.status(500).json({
            success: false,
            error: 'Error interno al obtener datos del cliente',
            message: error.message
        });
    }
});

/**
 * @route GET /api/presupuestos/clientes/:id_cliente/historial-entregas
 * @desc Obtener historial de entregas del cliente (productos únicos agrupados por mes)
 * @access Privado
 */
router.get('/clientes/:id_cliente/historial-entregas', validatePermissions('presupuestos.read'), async (req, res) => {
    console.log('🔍 [PRESUPUESTOS] Ruta GET /clientes/:id_cliente/historial-entregas - Obteniendo historial de entregas');

    try {
        await obtenerHistorialEntregasCliente(req, res);
    } catch (error) {
        console.error('❌ [PRESUPUESTOS] Error en ruta GET /clientes/:id_cliente/historial-entregas:', error);
        res.status(500).json({
            success: false,
            error: 'Error interno al obtener historial de entregas',
            message: error.message
        });
    }
});

/**
 * @route GET /api/presupuestos/clientes/:id_cliente/lista-precios-pdf
 * @desc Generar PDF con lista de precios personalizada basada en historial del cliente
 * @access Privado
 */
router.get('/clientes/:id_cliente/lista-precios-pdf', validatePermissions('presupuestos.read'), async (req, res) => {
    console.log('📄 [PRESUPUESTOS] Ruta GET /clientes/:id_cliente/lista-precios-pdf - Generando PDF de lista de precios');

    try {
        const { generarListaPreciosPDF } = require('../controllers/pdfListaPrecios');
        await generarListaPreciosPDF(req, res);
    } catch (error) {
        console.error('❌ [PRESUPUESTOS] Error en ruta GET /clientes/:id_cliente/lista-precios-pdf:', error);

        // Si ya se enviaron headers (PDF iniciado), no podemos enviar JSON
        if (!res.headersSent) {
            res.status(500).json({
                success: false,
                error: 'Error al generar PDF de lista de precios',
                message: error.message
            });
        }
    }
});

/**
 * @route GET /api/presupuestos/clientes/:id_cliente/articulos-excluidos
 * @desc Obtener artículos excluidos de un cliente (agrupados por rubro y sub-rubro)
 * @access Privado
 */
router.get('/clientes/:id_cliente/articulos-excluidos', validatePermissions('presupuestos.read'), async (req, res) => {
    console.log('🔍 [PRESUPUESTOS] Ruta GET /clientes/:id_cliente/articulos-excluidos - Obteniendo artículos excluidos');

    try {
        await obtenerArticulosExcluidos(req, res);
    } catch (error) {
        console.error('❌ [PRESUPUESTOS] Error en ruta GET /clientes/:id_cliente/articulos-excluidos:', error);
        res.status(500).json({
            success: false,
            error: 'Error interno al obtener artículos excluidos',
            message: error.message
        });
    }
});

/**
 * @route POST /api/presupuestos/clientes/:id_cliente/articulos-excluidos
 * @desc Excluir un artículo para un cliente
 * @access Privado
 */
router.post('/clientes/:id_cliente/articulos-excluidos', validatePermissions('presupuestos.update'), async (req, res) => {
    console.log('🔍 [PRESUPUESTOS] Ruta POST /clientes/:id_cliente/articulos-excluidos - Excluyendo artículo');

    try {
        await excluirArticulo(req, res);
    } catch (error) {
        console.error('❌ [PRESUPUESTOS] Error en ruta POST /clientes/:id_cliente/articulos-excluidos:', error);
        res.status(500).json({
            success: false,
            error: 'Error interno al excluir artículo',
            message: error.message
        });
    }
});

/**
 * @route DELETE /api/presupuestos/clientes/:id_cliente/articulos-excluidos/:articulo_numero
 * @desc Re-incluir un artículo excluido (eliminar de exclusiones)
 * @access Privado
 */
router.delete('/clientes/:id_cliente/articulos-excluidos/:articulo_numero', validatePermissions('presupuestos.update'), async (req, res) => {
    console.log('🔍 [PRESUPUESTOS] Ruta DELETE /clientes/:id_cliente/articulos-excluidos/:articulo_numero - Re-incluyendo artículo');

    try {
        await reincluirArticulo(req, res);
    } catch (error) {
        console.error('❌ [PRESUPUESTOS] Error en ruta DELETE /clientes/:id_cliente/articulos-excluidos/:articulo_numero:', error);
        res.status(500).json({
            success: false,
            error: 'Error interno al re-incluir artículo',
            message: error.message
        });
    }
});

/**
 * @route GET /api/presupuestos/catalogo-general
 * @desc Obtener catálogo general de productos (Vista Plana)
 * @query cliente_id (opcional), page, pageSize, search
 * @access Privado
 */
router.get('/catalogo-general', validatePermissions('presupuestos.read'), async (req, res) => {
    console.log('🔍 [PRESUPUESTOS] Ruta GET /catalogo-general - Obteniendo catálogo general');

    try {
        await obtenerCatalogoGeneral(req, res);
    } catch (error) {
        console.error('❌ [PRESUPUESTOS] Error en ruta GET /catalogo-general:', error);
        res.status(500).json({
            success: false,
            error: 'Error interno al obtener catálogo general',
            message: error.message
        });
    }
});

/**
 * @route GET /api/presupuestos/articulos/sugerencias
 * @desc Obtener sugerencias de artículos para autocompletar en detalles
 * @access Privado
 */
router.get('/articulos/sugerencias', validatePermissions('presupuestos.read'), async (req, res) => {


    console.log('🔍 [PRESUPUESTOS] Ruta GET /articulos/sugerencias - Obteniendo sugerencias de artículos');

    try {
        await obtenerSugerenciasArticulos(req, res);
    } catch (error) {
        console.error('❌ [PRESUPUESTOS] Error en ruta GET /articulos/sugerencias:', error);
        res.status(500).json({
            success: false,
            error: 'Error interno en la ruta de sugerencias de artículos',
            message: error.message
        });
    }
});

/**
* @route GET /api/presupuestos/precios
* @desc Devolver valor (neto) e IVA del artículo según lista del cliente
* @query cliente_id, codigo_barras (opcional), descripcion (opcional)
* @access Privado
*/
router.get('/precios', validatePermissions('presupuestos.read'), async (req, res) => {
    console.log('🔍 [PRESUPUESTOS] Ruta GET /precios - Buscando precio/IVA');
    try {
        await obtenerPrecioArticuloCliente(req, res);
    } catch (error) {
        console.error('❌ [PRESUPUESTOS] Error en ruta GET /precios:', error);
        res.status(500).json({
            success: false,
            error: 'Error interno al obtener precio/IVA',
            message: error.message
        });
    }
});

/**
 * @route GET /api/presupuestos/historial-articulo
 * @desc Obtener historial de compras de un artículo específico por cliente
 * @query cliente_id, articulo_codigo, descripcion
 * @access Privado
 */
router.get('/historial-articulo', validatePermissions('presupuestos.read'), async (req, res) => {
    console.log('🔍 [PRESUPUESTOS] Ruta GET /historial-articulo');
    try {
        const { obtenerHistorialArticuloCliente } = require('../controllers/presupuestos');
        await obtenerHistorialArticuloCliente(req, res);
    } catch (error) {
        console.error('❌ [PRESUPUESTOS] Error:', error);
        res.status(500).json({ success: false, message: error.message });
    }
});

/**
 * @route GET /api/presupuestos/estados
 * @desc Obtener estados distintos de presupuestos
 * @access Privado
 */
router.get('/estados', validatePermissions('presupuestos.read'), async (req, res) => {
    console.log('🔍 [PRESUPUESTOS] Ruta GET /estados - Obteniendo estados distintos');

    try {
        await obtenerEstados(req, res);
    } catch (error) {
        console.error('❌ [PRESUPUESTOS] Error en ruta GET /estados:', error);
        res.status(500).json({
            success: false,
            error: 'Error interno en la ruta de estados',
            message: error.message
        });
    }
});

/**
 * @route GET /api/presupuestos/estadisticas
 * @desc Obtener estadísticas generales de presupuestos
 * @access Privado
 */
router.get('/estadisticas', validatePermissions('presupuestos.read'), async (req, res) => {
    console.log('🔍 [PRESUPUESTOS] Ruta GET /estadisticas - Calculando estadísticas');

    try {
        await obtenerEstadisticas(req, res);
    } catch (error) {
        console.error('❌ [PRESUPUESTOS] Error en ruta GET /estadisticas:', error);
        res.status(500).json({
            success: false,
            error: 'Error interno en la ruta de estadísticas',
            message: error.message
        });
    }
});

/**
 * @route GET /api/presupuestos/configuracion
 * @desc Obtener configuración actual de Google Sheets
 * @access Privado
 */
router.get('/configuracion', validatePermissions('presupuestos.config'), async (req, res) => {
    console.log('🔍 [PRESUPUESTOS] Ruta GET /configuracion - Obteniendo configuración');

    try {
        await obtenerConfiguracion(req, res);
    } catch (error) {
        console.error('❌ [PRESUPUESTOS] Error en ruta GET /configuracion:', error);
        res.status(500).json({
            success: false,
            error: 'Error interno en la ruta de configuración',
            message: error.message
        });
    }
});

/**
 * @route GET /api/presupuestos/resumen
 * @desc Obtener resumen por categoría o fecha
 * @access Privado
 */
router.get('/resumen', validatePermissions('presupuestos.read'), sanitizarDatos, validarResumen, async (req, res) => {
    console.log('🔍 [PRESUPUESTOS] Ruta GET /resumen - Generando resumen');

    try {
        await obtenerResumen(req, res);
    } catch (error) {
        console.error('❌ [PRESUPUESTOS] Error en ruta GET /resumen:', error);
        res.status(500).json({
            success: false,
            error: 'Error interno en la ruta de resumen',
            message: error.message
        });
    }
});

/**
 * @route GET /api/presupuestos/health
 * @desc Health check del módulo de presupuestos
 * @access Público
 */
router.get('/health', (req, res) => {
    console.log('🔍 [PRESUPUESTOS] Ruta GET /health - Health check');

    res.json({
        success: true,
        module: 'presupuestos',
        status: 'active',
        timestamp: new Date().toISOString(),
        version: '1.0.0',
        features: {
            google_sheets: true,
            sync: true,
            auth: true
        }
    });
});

/**
 * @route GET /api/presupuestos/:id/detalles
 * @desc Obtener detalles de artículos de un presupuesto
 * @access Privado
 */
router.get('/:id/detalles', validatePermissions('presupuestos.read'), validarIdPresupuesto, async (req, res) => {
    const { id } = req.params;
    console.log(`🔍 [PRESUPUESTOS] Ruta GET /:id/detalles - Obteniendo detalles de presupuesto ID: ${id}`);

    try {
        await obtenerDetallesPresupuesto(req, res);
    } catch (error) {
        console.error(`❌ [PRESUPUESTOS] Error en ruta GET /:id/detalles (${id}):`, error);
        res.status(500).json({
            success: false,
            error: 'Error interno al obtener detalles del presupuesto',
            message: error.message
        });
    }
});

/**
 * @route GET /api/presupuestos/:id
 * @desc Obtener presupuesto por ID específico
 * @access Privado
 */
router.get('/:id', validatePermissions('presupuestos.read'), validarIdPresupuesto, async (req, res) => {
    const { id } = req.params;
    console.log(`🔍 [PRESUPUESTOS] Ruta GET /:id - Obteniendo presupuesto ID: ${id}`);

    // Convertir ID a string para validaciones seguras
    const idStr = String(id);

    // Validar rutas específicas que no deben ser tratadas como IDs de presupuesto
    const rutasEspecificas = ['health', 'estadisticas', 'configuracion', 'resumen'];
    const esRutaEspecifica = rutasEspecificas.includes(idStr.toLowerCase());
    const esRutaSync = idStr.toLowerCase().startsWith('sync/');

    if (esRutaEspecifica || esRutaSync) {
        console.log(`⚠️ [PRESUPUESTOS] Ruta específica detectada como ID: ${id}`);
        return res.status(400).json({
            success: false,
            error: 'Ruta no válida como ID de presupuesto',
            timestamp: new Date().toISOString()
        });
    }

    try {
        await obtenerPresupuestoPorId(req, res);
    } catch (error) {
        console.error(`❌ [PRESUPUESTOS] Error en ruta GET /:id (${id}):`, error);
        res.status(500).json({
            success: false,
            error: 'Error interno al obtener presupuesto por ID',
            message: error.message
        });
    }
});

/**
 * @route PUT /api/presupuestos/:id/estado
 * @desc Actualizar estado de presupuesto
 * @access Privado
 */
router.put('/:id/estado', validatePermissions('presupuestos.update'), validarIdPresupuesto, sanitizarDatos, async (req, res) => {
    const { id } = req.params;
    console.log(`🔍 [PRESUPUESTOS] Ruta PUT /:id/estado - Actualizando estado de presupuesto ID: ${id}`);

    try {
        await actualizarEstadoPresupuesto(req, res);
    } catch (error) {
        console.error(`❌ [PRESUPUESTOS] Error en ruta PUT /:id/estado (${id}):`, error);
        res.status(500).json({
            success: false,
            error: 'Error interno al actualizar estado',
            message: error.message
        });
    }
});

/**
 * @route PATCH /api/presupuestos/:id/formato-impresion
 * @desc Actualizar formato de impresión del presupuesto
 * @access Privado
 */
router.patch('/:id/formato-impresion', validatePermissions('presupuestos.update'), validarIdPresupuesto, sanitizarDatos, async (req, res) => {
    const { id } = req.params;
    console.log(`🔍 [PRESUPUESTOS] Ruta PATCH /:id/formato-impresion - Actualizando formato de impresión ID: ${id}`);

    try {
        await actualizarFormatoImpresion(req, res);
    } catch (error) {
        console.error(`❌ [PRESUPUESTOS] Error en ruta PATCH /:id/formato-impresion (${id}):`, error);
        res.status(500).json({
            success: false,
            error: 'Error interno al actualizar formato de impresión',
            message: error.message
        });
    }
});

// ===== RUTAS DE INTEGRACIÓN LOMASOFT (NUEVAS) =====
/**
 * @route POST /api/presupuestos/:id/buscar-candidatas-lomasoft
 * @desc Comunicarse con Lomasoft (ERP externo) para listar facturas candidatas a conciliar
 * @access Privado
 */
router.post('/:id/buscar-candidatas-lomasoft',
    validatePermissions('presupuestos.read'),
    validarIdPresupuesto,
    async (req, res) => {
        try {
            await buscarCandidatasLomasoft(req, res);
        } catch (error) {
            console.error('❌ Error buscando candidatas en Lomasoft:', error);
            res.status(500).json({ success: false, message: error.message });
        }
    }
);

/**
 * @route POST /api/presupuestos/:id/confirmar-conciliacion
 * @desc Guardar asociación manual Lomasoft elegida ("Fase 2")
 */
router.post('/:id/confirmar-conciliacion',
    validatePermissions('presupuestos.update'),
    validarIdPresupuesto,
    async (req, res) => {
        try {
            await confirmarConciliacion(req, res);
        } catch (error) {
            res.status(500).json({ success: false, message: error.message });
        }
    }
);

/**
 * @route POST /api/presupuestos/:id/desconciliar-lomasoft
 * @desc Revertir asociación manual Lomasoft y reingresar stock
 */
router.post('/:id/desconciliar-lomasoft',
    validatePermissions('presupuestos.update'),
    validarIdPresupuesto,
    async (req, res) => {
        try {
            await desconciliarLomasoft(req, res);
        } catch (error) {
            res.status(500).json({ success: false, message: error.message });
        }
    }
);

// ===== RUTAS DE ESCRITURA (NUEVAS) =====

/**
 * @route POST /api/presupuestos
 * @desc Crear presupuesto con encabezado + detalles (flujo en dos fases)
 * @access Privado
 */
router.post('/',
    validatePermissions('presupuestos.create'),
    // idempotencyMiddleware, // ⛔️ desactivado temporalmente
    validarCrearPresupuesto,
    sanitizarDatos,
    async (req, res) => {
        console.log('🔍 [PRESUPUESTOS-WRITE] Ruta POST / - Creando nuevo presupuesto');
        try {
            await crearPresupuestoWrite(req, res);
        } catch (error) {
            console.error('❌ [PRESUPUESTOS-WRITE] Error en ruta POST /:', error);
            res.status(500).json({
                success: false,
                error: 'Error interno al crear presupuesto',
                message: error.message
            });
        }
    }
);

/**
 * @route PUT /api/presupuestos/:id
 * @desc Editar presupuesto existente (solo datos permitidos)
 * @access Privado
 */
router.put('/:id',
    validatePermissions('presupuestos.update'),
    (req, res, next) => {
        console.log('🔍 [PUT-DEBUG] ===== INICIO PUT REQUEST =====');
        console.log('🔍 [PUT-DEBUG] URL:', req.originalUrl);
        console.log('🔍 [PUT-DEBUG] Method:', req.method);
        console.log('🔍 [PUT-DEBUG] Headers:', JSON.stringify(req.headers, null, 2));
        console.log('🔍 [PUT-DEBUG] Params:', JSON.stringify(req.params, null, 2));
        console.log('🔍 [PUT-DEBUG] Body (raw):', JSON.stringify(req.body, null, 2));
        console.log('🔍 [PUT-DEBUG] Body keys:', Object.keys(req.body || {}));
        console.log('🔍 [PUT-DEBUG] ===== FIN LOGGING =====');
        next();
    },
    validarIdPresupuesto,
    sanitizarDatos,
    validarActualizarPresupuesto,
    async (req, res) => {
        const { id } = req.params;
        console.log(`🔍 [PRESUPUESTOS-WRITE] Ruta PUT /:id - Editando presupuesto ID: ${id}`);

        try {
            await editarPresupuestoWrite(req, res);
        } catch (error) {
            console.error(`❌ [PRESUPUESTOS-WRITE] Error en ruta PUT /:id (${id}):`, error);
            res.status(500).json({
                success: false,
                error: 'Error interno al editar presupuesto',
                message: error.message
            });
        }
    }
);

/**
 * @route DELETE /api/presupuestos/:id
 * @desc Eliminar presupuesto (baja lógica)
 * @access Privado
 */
router.delete('/:id',
    validatePermissions('presupuestos.delete'),
    validarIdPresupuesto,
    async (req, res) => {
        const { id } = req.params;
        console.log(`🔍 [PRESUPUESTOS-WRITE] Ruta DELETE /:id - Eliminando presupuesto ID: ${id}`);

        try {
            await eliminarPresupuestoWrite(req, res);
        } catch (error) {
            console.error(`❌ [PRESUPUESTOS-WRITE] Error en ruta DELETE /:id (${id}):`, error);
            res.status(500).json({
                success: false,
                error: 'Error interno al eliminar presupuesto',
                message: error.message
            });
        }
    }
);

/**
 * @route POST /api/presupuestos/:id/retry
 * @desc Reintentar operación con idempotencia
 * @access Privado
 */
router.post('/:id/retry',
    validatePermissions('presupuestos.update'),
    validarIdPresupuesto,
    // idempotencyMiddleware, // ⛔️ desactivado temporalmente
    async (req, res) => {
        const { id } = req.params;
        console.log(`🔍 [PRESUPUESTOS-WRITE] Ruta POST /:id/retry - Reintentando presupuesto ID: ${id}`);

        try {
            await reintentarPresupuesto(req, res);
        } catch (error) {
            console.error(`❌ [PRESUPUESTOS-WRITE] Error en ruta POST /:id/retry (${id}):`, error);
            res.status(500).json({
                success: false,
                error: 'Error interno al reintentar presupuesto',
                message: error.message
            });
        }
    }
);

/**
 * @route GET /api/presupuestos/:id/status
 * @desc Obtener estado de presupuesto
 * @access Privado
 */
router.get('/:id/status',
    validatePermissions('presupuestos.read'),
    validarIdPresupuesto,
    async (req, res) => {
        const { id } = req.params;
        console.log(`🔍 [PRESUPUESTOS-WRITE] Ruta GET /:id/status - Obteniendo estado de presupuesto ID: ${id}`);

        try {
            await obtenerEstadoPresupuesto(req, res);
        } catch (error) {
            console.error(`❌ [PRESUPUESTOS-WRITE] Error en ruta GET /:id/status (${id}):`, error);
            res.status(500).json({
                success: false,
                error: 'Error interno al obtener estado del presupuesto',
                message: error.message
            });
        }
    }
);

/**
 * @route GET /api/presupuestos/sync/auth/status
 * @desc Verificar estado de autenticación con Google
 * @access Privado
 */
router.get('/sync/auth/status', validatePermissions('presupuestos.sync'), async (req, res) => {
    console.log('🔍 [PRESUPUESTOS] Ruta GET /sync/auth/status - Verificando autenticación Google');

    try {
        await verificarAutenticacion(req, res);
    } catch (error) {
        console.error('❌ [PRESUPUESTOS] Error en ruta GET /sync/auth/status:', error);
        res.status(500).json({
            success: false,
            error: 'Error interno en verificación de autenticación',
            message: error.message
        });
    }
});

/**
 * @route POST /api/presupuestos/sync/auth/iniciar
 * @desc Iniciar proceso de autenticación con Google
 * @access Privado
 */
router.post('/sync/auth/iniciar', validatePermissions('presupuestos.sync'), async (req, res) => {
    console.log('🔍 [PRESUPUESTOS] Ruta POST /sync/auth/iniciar - Iniciando autenticación Google');

    try {
        await iniciarAutenticacion(req, res);
    } catch (error) {
        console.error('❌ [PRESUPUESTOS] Error en ruta POST /sync/auth/iniciar:', error);
        res.status(500).json({
            success: false,
            error: 'Error interno al iniciar autenticación',
            message: error.message
        });
    }
});

/**
 * @route POST /api/presupuestos/sync/auth/completar
 * @desc Completar autenticación con código de Google
 * @access Privado
 */
router.post('/sync/auth/completar', validatePermissions('presupuestos.sync'), async (req, res) => {
    console.log('🔍 [PRESUPUESTOS] Ruta POST /sync/auth/completar - Completando autenticación Google');

    try {
        await completarAutenticacion(req, res);
    } catch (error) {
        console.error('❌ [PRESUPUESTOS] Error en ruta POST /sync/auth/completar:', error);
        res.status(500).json({
            success: false,
            error: 'Error interno al completar autenticación',
            message: error.message
        });
    }
});

/**
 * @route POST /api/presupuestos/sync/validar-hoja
 * @desc Validar acceso a hoja de Google Sheets
 * @access Privado
 */
router.post('/sync/validar-hoja', validatePermissions('presupuestos.sync'), async (req, res) => {
    console.log('🔍 [PRESUPUESTOS] Ruta POST /sync/validar-hoja - Validando hoja Google Sheets');

    try {
        await validarHoja(req, res);
    } catch (error) {
        console.error('❌ [PRESUPUESTOS] Error en ruta POST /sync/validar-hoja:', error);
        res.status(500).json({
            success: false,
            error: 'Error interno al validar hoja',
            message: error.message
        });
    }
});

/**
 * @route POST /api/presupuestos/sync/configurar
 * @desc Configurar hoja de Google Sheets
 * @access Privado
 */
router.post('/sync/configurar', validatePermissions('presupuestos.config'), async (req, res) => {
    console.log('🔍 [PRESUPUESTOS] Ruta POST /sync/configurar - Configurando hoja Google Sheets');

    try {
        await configurarHoja(req, res);
    } catch (error) {
        console.error('❌ [PRESUPUESTOS] Error en ruta POST /sync/configurar:', error);
        res.status(500).json({
            success: false,
            error: 'Error interno al configurar hoja',
            message: error.message
        });
    }
});

/**
 * @route POST /api/presupuestos/sync/ejecutar
 * @desc Ejecutar sincronización manual con Google Sheets
 * @access Privado
 */
router.post('/sync/ejecutar', validatePermissions('presupuestos.sync'), async (req, res) => {
    console.log('🔍 [PRESUPUESTOS] Ruta POST /sync/ejecutar - Ejecutando sincronización');

    try {
        await ejecutarSincronizacion(req, res);
    } catch (error) {
        console.error('❌ [PRESUPUESTOS] Error en ruta POST /sync/ejecutar:', error);
        res.status(500).json({
            success: false,
            error: 'Error interno al ejecutar sincronización',
            message: error.message
        });
    }
});

/**
 * @route GET /api/presupuestos/sync/historial
 * @desc Obtener historial de sincronizaciones
 * @access Privado
 */
router.get('/sync/historial', validatePermissions('presupuestos.read'), async (req, res) => {
    console.log('🔍 [PRESUPUESTOS] Ruta GET /sync/historial - Obteniendo historial');

    try {
        await obtenerHistorial(req, res);
    } catch (error) {
        console.error('❌ [PRESUPUESTOS] Error en ruta GET /sync/historial:', error);
        res.status(500).json({
            success: false,
            error: 'Error interno al obtener historial',
            message: error.message
        });
    }
});

/**
 * @route GET /api/presupuestos/sync/estado
 * @desc Obtener estado general de sincronización
 * @access Privado
 */
router.get('/sync/estado', validatePermissions('presupuestos.read'), async (req, res) => {
    console.log('🔍 [PRESUPUESTOS] Ruta GET /sync/estado - Obteniendo estado de sincronización');

    try {
        await obtenerEstadoSync(req, res);
    } catch (error) {
        console.error('❌ [PRESUPUESTOS] Error en ruta GET /sync/estado:', error);
        res.status(500).json({
            success: false,
            error: 'Error interno al obtener estado',
            message: error.message
        });
    }
});

// ===== RUTAS DE FULL REFRESH SYNC =====

/**
 * @route POST /api/presupuestos/sync/full-refresh
 * @desc Ejecutar sincronización Full Refresh (borrar y recargar)
 * @access Privado
 */
router.post('/sync/full-refresh', validatePermissions('presupuestos.sync'), async (req, res) => {
    console.log('🔍 [PRESUPUESTOS] Ruta POST /sync/full-refresh - Ejecutando Full Refresh');

    try {
        await executeFullRefresh(req, res);
    } catch (error) {
        console.error('❌ [PRESUPUESTOS] Error en ruta POST /sync/full-refresh:', error);
        res.status(500).json({
            success: false,
            error: 'Error interno al ejecutar Full Refresh',
            message: error.message
        });
    }
});

/**
 * @route GET /api/presupuestos/sync/status
 * @desc Obtener estado actual de sincronización Full Refresh
 * @access Privado
 */
router.get('/sync/status', validatePermissions('presupuestos.read'), async (req, res) => {
    console.log('🔍 [PRESUPUESTOS] Ruta GET /sync/status - Obteniendo estado Full Refresh');

    try {
        await getSyncStatus(req, res);
    } catch (error) {
        console.error('❌ [PRESUPUESTOS] Error en ruta GET /sync/status:', error);
        res.status(500).json({
            success: false,
            error: 'Error interno al obtener estado Full Refresh',
            message: error.message
        });
    }
});

/**
 * @route POST /api/presupuestos/sync/dry-run
 * @desc Ejecutar simulación de sincronización (sin cambios)
 * @access Privado
 */
router.post('/sync/dry-run', validatePermissions('presupuestos.sync'), async (req, res) => {
    console.log('🔍 [PRESUPUESTOS] Ruta POST /sync/dry-run - Ejecutando Dry Run');

    try {
        await executeDryRun(req, res);
    } catch (error) {
        console.error('❌ [PRESUPUESTOS] Error en ruta POST /sync/dry-run:', error);
        res.status(500).json({
            success: false,
            error: 'Error interno al ejecutar Dry Run',
            message: error.message
        });
    }
});

/**
 * @route GET /api/presupuestos/sync/history
 * @desc Obtener historial detallado de sincronizaciones Full Refresh
 * @access Privado
 */
router.get('/sync/history', validatePermissions('presupuestos.read'), async (req, res) => {
    console.log('🔍 [PRESUPUESTOS] Ruta GET /sync/history - Obteniendo historial Full Refresh');

    try {
        await getSyncHistory(req, res);
    } catch (error) {
        console.error('❌ [PRESUPUESTOS] Error en ruta GET /sync/history:', error);
        res.status(500).json({
            success: false,
            error: 'Error interno al obtener historial Full Refresh',
            message: error.message
        });
    }
});

/**
 * @route GET /api/presupuestos/sync/stats
 * @desc Obtener estadísticas actuales de la base de datos
 * @access Privado
 */
router.get('/sync/stats', validatePermissions('presupuestos.read'), async (req, res) => {
    console.log('🔍 [PRESUPUESTOS] Ruta GET /sync/stats - Obteniendo estadísticas BD');

    try {
        await getDatabaseStats(req, res);
    } catch (error) {
        console.error('❌ [PRESUPUESTOS] Error en ruta GET /sync/stats:', error);
        res.status(500).json({
            success: false,
            error: 'Error interno al obtener estadísticas BD',
            message: error.message
        });
    }
});

// ===== RUTAS DE CORRECCIÓN DE FECHAS =====

/**
 * @route POST /api/presupuestos/sync/corregir-fechas
 * @desc Ejecutar corrección definitiva de fechas DD/MM/YYYY
 * @access Privado
 */
router.post('/sync/corregir-fechas', validatePermissions('presupuestos.sync'), async (req, res) => {
    console.log('🔍 [PRESUPUESTOS] Ruta POST /sync/corregir-fechas - Ejecutando corrección de fechas');

    try {
        await ejecutarCorreccion(req, res);
    } catch (error) {
        console.error('❌ [PRESUPUESTOS] Error en ruta POST /sync/corregir-fechas:', error);
        res.status(500).json({
            success: false,
            error: 'Error interno al corregir fechas',
            message: error.message
        });
    }
});

/**
 * @route GET /api/presupuestos/sync/estadisticas-fechas
 * @desc Obtener estadísticas actuales de fechas
 * @access Privado
 */
router.get('/sync/estadisticas-fechas', validatePermissions('presupuestos.read'), async (req, res) => {
    console.log('🔍 [PRESUPUESTOS] Ruta GET /sync/estadisticas-fechas - Obteniendo estadísticas de fechas');

    try {
        await obtenerEstadisticasFechas(req, res);
    } catch (error) {
        console.error('❌ [PRESUPUESTOS] Error en ruta GET /sync/estadisticas-fechas:', error);
        res.status(500).json({
            success: false,
            error: 'Error interno al obtener estadísticas de fechas',
            message: error.message
        });
    }
});

/**
 * @route GET /api/presupuestos/sync/historial-correcciones
 * @desc Obtener historial de correcciones de fechas
 * @access Privado
 */
router.get('/sync/historial-correcciones', validatePermissions('presupuestos.read'), async (req, res) => {
    console.log('🔍 [PRESUPUESTOS] Ruta GET /sync/historial-correcciones - Obteniendo historial de correcciones');

    try {
        await obtenerHistorialCorrecciones(req, res);
    } catch (error) {
        console.error('❌ [PRESUPUESTOS] Error en ruta GET /sync/historial-correcciones:', error);
        res.status(500).json({
            success: false,
            error: 'Error interno al obtener historial de correcciones',
            message: error.message
        });
    }
});

/**
 * @route POST /api/presupuestos/sync/validar-configuracion
 * @desc Validar configuración antes de corrección
 * @access Privado
 */
router.post('/sync/validar-configuracion', validatePermissions('presupuestos.sync'), async (req, res) => {
    console.log('🔍 [PRESUPUESTOS] Ruta POST /sync/validar-configuracion - Validando configuración');

    try {
        await validarConfiguracion(req, res);
    } catch (error) {
        console.error('❌ [PRESUPUESTOS] Error en ruta POST /sync/validar-configuracion:', error);
        res.status(500).json({
            success: false,
            error: 'Error interno al validar configuración',
            message: error.message
        });
    }
});

/**
 * @route POST /api/presupuestos/sync/push-altas
 * @desc Ejecutar push ligero de ALTAS locales a Google Sheets
 * @access Privado
 */
router.post('/sync/push-altas', validatePermissions('presupuestos.sync'), async (req, res) => {
    console.log('🔍 [PRESUPUESTOS] Ruta POST /sync/push-altas - Ejecutando push de ALTAS locales');

    try {
        await ejecutarPushAltas(req, res);
    } catch (error) {
        console.error('❌ [PRESUPUESTOS] Error en ruta POST /sync/push-altas:', error);
        res.status(500).json({
            success: false,
            error: 'Error interno al ejecutar push de ALTAS',
            message: error.message
        });
    }
});

/**
 * @route POST /api/presupuestos/sync/bidireccional
 * @desc Ejecutar sincronización bidireccional (push + pull) con regla "gana el último cambio"
 * @access Privado
 */
router.post('/sync/bidireccional', validatePermissions('presupuestos.sync'), async (req, res) => {
    console.log('🔍 [PRESUPUESTOS] Ruta POST /sync/bidireccional - Ejecutando sincronización bidireccional');

    try {
        await ejecutarSincronizacionBidireccional(req, res);
    } catch (error) {
        console.error('❌ [PRESUPUESTOS] Error en ruta POST /sync/bidireccional:', error);
        res.status(500).json({
            success: false,
            error: 'Error interno al ejecutar sincronización bidireccional',
            message: error.message
        });
    }
});

// ===== RUTAS DE CONFIGURACIÓN DE AUTOSYNC =====

/**
 * @route GET /api/presupuestos/sync/config
 * @desc Obtener configuración actual de autosync
 * @access Privado
 */
router.get('/sync/config', validatePermissions('presupuestos.config'), async (req, res) => {
    console.log('[SYNC_CONFIG] Ruta GET /sync/config - Obteniendo configuración de autosync');

    try {
        await obtenerConfiguracionSync(req, res);
    } catch (error) {
        console.error('[SYNC_CONFIG] ❌ Error en ruta GET /sync/config:', error);
        res.status(500).json({
            success: false,
            error: 'Error interno al obtener configuración de autosync',
            message: error.message
        });
    }
});

/**
 * @route PATCH /api/presupuestos/sync/config
 * @desc Actualizar configuración de autosync
 * @access Privado
 */
router.patch('/sync/config', validatePermissions('presupuestos.config'), async (req, res) => {
    console.log('[SYNC_CONFIG] Ruta PATCH /sync/config - Actualizando configuración de autosync');

    try {
        await actualizarConfiguracionSync(req, res);
    } catch (error) {
        console.error('[SYNC_CONFIG] ❌ Error en ruta PATCH /sync/config:', error);
        res.status(500).json({
            success: false,
            error: 'Error interno al actualizar configuración de autosync',
            message: error.message
        });
    }
});

/**
 * @route GET /api/presupuestos/sync/health
 * @desc Obtener estado de salud del autosync
 * @access Privado
 */
router.get('/sync/health', validatePermissions('presupuestos.read'), async (req, res) => {
    console.log('[SYNC_CONFIG] Ruta GET /sync/health - Obteniendo estado de salud del autosync');

    try {
        await obtenerEstadoSalud(req, res);
    } catch (error) {
        console.error('[SYNC_CONFIG] ❌ Error en ruta GET /sync/health:', error);
        res.status(500).json({
            success: false,
            error: 'Error interno al obtener estado de salud del autosync',
            message: error.message
        });
    }
});

// Middleware para rutas no encontradas específico del módulo
router.use('*', (req, res) => {
    console.log(`⚠️ [PRESUPUESTOS] Ruta no encontrada: ${req.method} ${req.originalUrl}`);

    res.status(404).json({
        success: false,
        error: 'Ruta no encontrada en el módulo de presupuestos',
        path: req.originalUrl,
        method: req.method,
        timestamp: new Date().toISOString()
    });
});

console.log('✅ [PRESUPUESTOS] Rutas configuradas exitosamente');
console.log('📋 [PRESUPUESTOS] Rutas CRUD disponibles:');
console.log('   - GET /api/presupuestos (con filtros avanzados)');
console.log('   - GET /api/presupuestos/:id');
console.log('   - GET /api/presupuestos/:id/detalles');
console.log('   - POST /api/presupuestos');
console.log('   - PUT /api/presupuestos/:id');
console.log('   - DELETE /api/presupuestos/:id');
console.log('📊 [PRESUPUESTOS] Rutas de consulta:');
console.log('   - GET /api/presupuestos/categoria/:categoria');
console.log('   - GET /api/presupuestos/estadisticas');
console.log('   - GET /api/presupuestos/resumen');
console.log('   - GET /api/presupuestos/configuracion');
console.log('   - GET /api/presupuestos/health');
console.log('🔄 [PRESUPUESTOS] Rutas de sincronización:');
console.log('   - GET /api/presupuestos/sync/auth/status');
console.log('   - POST /api/presupuestos/sync/auth/iniciar');
console.log('   - POST /api/presupuestos/sync/auth/completar');
console.log('   - POST /api/presupuestos/sync/validar-hoja');
console.log('   - POST /api/presupuestos/sync/configurar');
console.log('   - POST /api/presupuestos/sync/ejecutar');
console.log('   - GET /api/presupuestos/sync/historial');
console.log('   - GET /api/presupuestos/sync/estado');
console.log('🔄 [PRESUPUESTOS] Rutas de Full Refresh Sync:');
console.log('   - POST /api/presupuestos/sync/full-refresh');
console.log('   - GET /api/presupuestos/sync/status');
console.log('   - POST /api/presupuestos/sync/dry-run');
console.log('   - GET /api/presupuestos/sync/history');
console.log('   - GET /api/presupuestos/sync/stats');
console.log('📅 [PRESUPUESTOS] Rutas de Corrección de Fechas:');
console.log('   - POST /api/presupuestos/sync/corregir-fechas');
console.log('   - GET /api/presupuestos/sync/estadisticas-fechas');
console.log('   - GET /api/presupuestos/sync/historial-correcciones');
console.log('   - POST /api/presupuestos/sync/validar-configuracion');
console.log('   - POST /api/presupuestos/sync/push-altas');
console.log('   - POST /api/presupuestos/sync/bidireccional');
console.log('⚙️ [PRESUPUESTOS] Rutas de Configuración de Autosync:');
console.log('   - GET /api/presupuestos/sync/config');
console.log('   - PATCH /api/presupuestos/sync/config');
console.log('   - GET /api/presupuestos/sync/health');

module.exports = router;
