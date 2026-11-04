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
    obtenerArticulosHabitualesCliente,
    obtenerCatalogoGeneral,
    obtenerArticulosExcluidos,
    excluirArticulo,
    reincluirArticulo,
    obtenerAuditoriaRentabilidadBunker
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
    getDashboardFaltantesController,
    cambiarEstadoFaltanteController
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
 * @route POST /api/presupuestos/:id/whatsapp
 * @desc Generar PDF del presupuesto en el backend y enviarlo vía WhatsApp por el puerto 3004
 * @access Privado
 */
router.post('/:id/whatsapp', validatePermissions('presupuestos.read'), async (req, res) => {
    const { enviarPDFPresupuestoWhatsApp } = require('../controllers/pdfGenerator');
    await enviarPDFPresupuestoWhatsApp(req, res);
});

/**
 * @route POST /api/presupuestos/:id/email
 * @desc Generar PDF del presupuesto en el backend y enviarlo vía Email por el puerto 3004
 * @access Privado
 */
router.post('/:id/email', validatePermissions('presupuestos.read'), async (req, res) => {
    const { enviarPDFPresupuestoEmail } = require('../controllers/pdfGenerator');
    await enviarPDFPresupuestoEmail(req, res);
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
 * @route POST /api/presupuestos/sync/b2b-force
 * @desc Forzar sincronización en caliente del portal B2B (Ingesta + Estados)
 * @access Privado
 */
router.post('/sync/b2b-force', validatePermissions('presupuestos.sync'), async (req, res) => {
    console.log('🔄 [PRESUPUESTOS-SYNC] Forzando sincronización en caliente de pedidos y estados B2B...');
    const { exec } = require('child_process');
    const path = require('path');

    const scriptPedidos = path.join(__dirname, '../../actualizaPrecios/syncB2BPedidos.js');
    const scriptEstados = path.join(__dirname, '../../actualizaPrecios/syncB2BEstados.js');

    // Ejecutar primero la ingesta de pedidos y luego la actualización de estados
    exec(`node "${scriptPedidos}"`, (errPedidos, stdoutPedidos, stderrPedidos) => {
        if (errPedidos) {
            console.error('❌ Error ejecutando syncB2BPedidos:', errPedidos);
        }
        console.log('stdoutPedidos:', stdoutPedidos);

        exec(`node "${scriptEstados}"`, (errEstados, stdoutEstados, stderrEstados) => {
            if (errEstados) {
                console.error('❌ Error ejecutando syncB2BEstados:', errEstados);
            }
            console.log('stdoutEstados:', stdoutEstados);

            res.json({
                success: true,
                message: 'Sincronización en caliente B2B completada con éxito',
                details: {
                    pedidos: stdoutPedidos,
                    estados: stdoutEstados
                }
            });
        });
    });
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
 * @route POST /api/presupuestos/faltantes/:id/estado
 * @route PATCH /api/presupuestos/faltantes/:id/estado
 * @desc Actualizar estado de una demanda no satisfecha (Cubierto, Desestimado, Pendiente)
 * @access Privado
 */
router.post('/faltantes/:id/estado', validatePermissions('presupuestos.update'), async (req, res) => {
    try {
        await cambiarEstadoFaltanteController(req, res);
    } catch (error) {
        res.status(500).json({ success: false, error: 'Error del enrutador', message: error.message });
    }
});

router.patch('/faltantes/:id/estado', validatePermissions('presupuestos.update'), async (req, res) => {
    try {
        await cambiarEstadoFaltanteController(req, res);
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
 * @route GET /api/presupuestos/clientes/:id_cliente/articulos-habituales
 * @desc Obtener artículos habituales del cliente (Búnker con frecuencia y última fecha)
 * @access Privado
 */
router.get('/clientes/:id_cliente/articulos-habituales', validatePermissions('presupuestos.read'), async (req, res) => {
    console.log(`🔍 [PRESUPUESTOS] Ruta GET /clientes/${req.params.id_cliente}/articulos-habituales - Obteniendo artículos habituales`);

    try {
        await obtenerArticulosHabitualesCliente(req, res);
    } catch (error) {
        console.error('❌ [PRESUPUESTOS] Error en ruta GET /clientes/:id_cliente/articulos-habituales:', error);
        res.status(500).json({
            success: false,
            error: 'Error interno al obtener artículos habituales',
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
 * @route POST /api/presupuestos/auditoria-rentabilidad
 * @desc Obtener desglose y trazabilidad completa de costos y rentabilidad estimada Búnker
 * @access Privado
 */
router.post('/auditoria-rentabilidad', validatePermissions('presupuestos.read'), async (req, res) => {
    console.log('🔍 [PRESUPUESTOS] Ruta POST /auditoria-rentabilidad - Generando informe de trazabilidad');
    try {
        await obtenerAuditoriaRentabilidadBunker(req, res);
    } catch (error) {
        console.error('❌ [PRESUPUESTOS] Error en ruta POST /auditoria-rentabilidad:', error);
        res.status(500).json({
            success: false,
            error: 'Error interno al auditar rentabilidad Búnker',
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

// ==========================================
// 🏷️ MOTOR UNIVERSAL DE POLÍTICAS COMERCIALES
// ==========================================
const PoliticasDescuentoService = require('../services/politicasDescuentoService');

/**
 * @route GET /api/presupuestos/listas-precios
 * @desc Obtener listas de precios disponibles para asociar a políticas comerciales
 */
router.get('/listas-precios', async (req, res) => {
    try {
        const query = 'SELECT id, nombre, descripcion FROM public.bunker_listas_precios ORDER BY id ASC';
        const result = await req.db.query(query);
        res.json({ success: true, data: result.rows });
    } catch (error) {
        console.error('❌ [LISTAS] Error al obtener listas de precios:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

/**
 * @route GET /api/presupuestos/politicas
 * @desc Obtener todas las políticas comerciales configuradas con tramos y excepciones
 */
router.get('/politicas', async (req, res) => {
    try {
        const politicas = await PoliticasDescuentoService.obtenerPoliticas(req.db);
        res.json({ success: true, data: politicas });
    } catch (error) {
        console.error('❌ [POLITICAS] Error al obtener políticas:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

/**
 * @route GET /api/presupuestos/politicas/cliente/:clienteId
 * @desc Obtener la política comercial asignada a la lista de un cliente para listas personalizadas
 */
router.get('/politicas/cliente/:clienteId', async (req, res) => {
    try {
        const info = await PoliticasDescuentoService.obtenerPoliticaPorCliente(req.params.clienteId, req.db);
        res.json({ success: true, data: info });
    } catch (error) {
        console.error('❌ [POLITICAS] Error al consultar política por cliente:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

/**
 * @route GET /api/presupuestos/portal/info-comercial/:clienteId
 * @route GET /api/presupuestos/contexto-comercial/:clienteId
 * @desc Obtener información comercial integral para el Portal B2B: ofertas dinámicas, política de volumen con saldo, formas de pago y asistencia financiera (4 ventanas)
 * @access Público / Portal B2B
 */
const resolverInfoComercialCliente = async (req, res) => {
    const { clienteId } = req.params;
    console.log(`🔍 [PORTAL-COMERCIAL] Obteniendo contexto comercial para cliente: ${clienteId}`);

    try {
        const OfertasDinamicasService = require('../services/ofertasDinamicasService');
        const salvavidasService = require('../../logistica/services/salvavidasService');

        // 1. Resolver cliente
        const qCli = `
            SELECT bc.id as bunker_cliente_id, bc.codigo_bunker_cliente, bc.cliente_nombre, bc.razon_social,
                   COALESCE(clp.bunker_lista_precio_id::text, c.lista_precios) as lista_precio_id,
                   bc.salvavidas_modo, bc.salvavidas_tasa_tem, bc.salvavidas_dias_estandar, bc.salvavidas_dias_cortesia
            FROM public.bunker_clientes bc
            LEFT JOIN public.clientes c ON (
                bc.lomas_soft_id = LPAD(c.cliente_id::text, 4, '0') OR bc.lomas_soft_id = c.cliente_id::text OR bc.id = c.cliente_id
            )
            LEFT JOIN public.bunker_cliente_listas_precios clp ON clp.bunker_cliente_id = bc.id
            WHERE bc.codigo_bunker_cliente = $1 
               OR bc.lomas_soft_id = $1 
               OR bc.lomas_soft_id = LPAD($1, 4, '0')
               OR (CASE WHEN $1 ~ '^[0-9]+$' THEN bc.id = CAST($1 AS integer) ELSE false END)
            LIMIT 1
        `;
        const resCli = await req.db.query(qCli, [clienteId]);
        const cliente = resCli.rows[0];

        const numClienteId = cliente ? cliente.bunker_cliente_id : null;
        const numListaId = cliente && cliente.lista_precio_id ? parseInt(cliente.lista_precio_id, 10) : null;

        // 2. Ofertas Dinámicas Activas para este cliente / lista
        let ofertasAplicables = [];
        try {
            const todasOfertas = await OfertasDinamicasService.obtenerOfertas(req.db, true);
            ofertasAplicables = todasOfertas.filter(ofr => {
                if (numClienteId && ofr.excepciones && ofr.excepciones.length > 0) {
                    const exc = ofr.excepciones.find(e => e.cliente_id === numClienteId);
                    if (exc && exc.tipo_excepcion === 'EXCLUIDO') return false;
                }
                if (numListaId && ofr.listas && ofr.listas.length > 0) {
                    const matchLista = ofr.listas.some(l => l.bunker_lista_precio_id === numListaId);
                    if (!matchLista) return false;
                }
                return true;
            }).map(o => ({
                id: o.id,
                titulo: o.titulo,
                descripcion: o.descripcion,
                tipo_beneficio: o.tipo_beneficio,
                descuento_porcentaje: o.descuento_porcentaje,
                precio_fijo_oferta: o.precio_fijo_oferta,
                cuota_disponible: o.cuota_disponible,
                cuota_total: o.cuota_total,
                unidad_cuota: o.unidad_cuota,
                condicion_cierre: o.condicion_cierre,
                fecha_fin: o.fecha_fin,
                no_acumulable_con_politica: o.no_acumulable_con_politica,
                articulos: (o.articulos || []).map(a => ({
                    articulo_numero: a.articulo_numero,
                    descripcion: a.descripcion_generada || a.articulo_descripcion || a.descripcion,
                    kilos_unidad: a.kilos_unidad,
                    precio_fijo_oferta: a.precio_fijo_oferta
                }))
            }));
        } catch (errOfertas) {
            console.warn('⚠️ [PORTAL-COMERCIAL] Error al obtener ofertas:', errOfertas.message);
        }

        // 3. Política Comercial de Bonificación por Volumen (con saldo en tiempo real)
        let politicaComercial = null;
        try {
            if (numClienteId) {
                const infoPol = await PoliticasDescuentoService.obtenerPoliticaPorCliente(numClienteId, req.db);
                if (infoPol && infoPol.tiene_politica && infoPol.politica && infoPol.politica.tramos && infoPol.politica.tramos.length > 0) {
                    politicaComercial = {
                        id: infoPol.politica.id,
                        nombre: infoPol.politica.nombre,
                        descripcion: infoPol.politica.descripcion,
                        lista_id: infoPol.lista_id,
                        lista_nombre: infoPol.lista_nombre || 'General',
                        tipo_calculo: infoPol.politica.tipo_calculo,
                        aplica_sobre: infoPol.politica.aplica_sobre,
                        exige_saldo_cero: infoPol.politica.exige_saldo_cero !== false,
                        tolerancia_saldo: parseFloat(infoPol.politica.tolerancia_saldo) || 150.00,
                        no_acumulable: infoPol.politica.no_acumulable !== false,
                        saldo_cuenta_corriente: infoPol.saldo_cuenta_corriente || 0,
                        tramos: infoPol.politica.tramos || [],
                        excepcion: infoPol.excepcion
                    };
                }
            } else if (numListaId) {
                const polDirecta = await PoliticasDescuentoService.obtenerPoliticaPorLista(numListaId, req.db);
                if (polDirecta && polDirecta.tramos && polDirecta.tramos.length > 0) {
                    politicaComercial = {
                        id: polDirecta.id,
                        nombre: polDirecta.nombre,
                        descripcion: polDirecta.descripcion,
                        lista_id: numListaId,
                        lista_nombre: polDirecta.lista_nombre || 'General',
                        tipo_calculo: polDirecta.tipo_calculo,
                        aplica_sobre: polDirecta.aplica_sobre,
                        exige_saldo_cero: polDirecta.exige_saldo_cero !== false,
                        tolerancia_saldo: parseFloat(polDirecta.tolerancia_saldo) || 150.00,
                        no_acumulable: polDirecta.no_acumulable !== false,
                        saldo_cuenta_corriente: 0,
                        tramos: polDirecta.tramos || [],
                        excepcion: null
                    };
                }
            }
        } catch (errPol) {
            console.warn('⚠️ [PORTAL-COMERCIAL] Error al obtener política comercial:', errPol.message);
        }

        // 4. Formas de Pago Oficiales
        const formasPago = {
            banco: {
                nombre: 'Banco Galicia',
                alias: 'LAMDA.SER.MARTIN'
            },
            ensobrado: {
                titulo: 'Ensobrado (Servicio LAMDA)',
                canales: [
                    'Portal de Clientes LAMDA (función Pagos en Efectivo / Ensobrado)',
                    'Enlace Móvil por WhatsApp (asistente interactivo sin claves para celular)'
                ],
                instruccion: 'Anota el monto, el sistema asiste el conteo y arqueo de billetes, se rotula el sobre con el N° asignado (ej: SOB-XXXX), cliente e importe, se cargan 2 fotos (frente y dorso) y al finalizar envía confirmación automática por WhatsApp. Queda listo para entregar al chofer o en depósito.'
            },
            cajero: {
                titulo: 'Cajeros y Terminales Autoservicio Galicia',
                cuenta: 'Caja de Ahorro 4007844-1 373-4',
                titular: 'Martin Ignacio Serrano',
                disponibilidad: 'Lobbies 24 hs habilitados todos los días',
                sucursales_la_plata: [
                    'La Plata Centro: Calle 7 N° 875 (e/ 49 y 50) • Calle 13 N° 665 (Plaza Paso) • Av. 7 N° 59 (Plaza Olazábal)',
                    'Los Hornos / Acceso Sur: Av. 44 N° 1724 (esq. 29)',
                    'City Bell / Gonnet: Plaza Gral. Belgrano N° 57/63 (City Bell)'
                ]
            }
        };

        // 5. Asistencia Financiera / Intereses (4 Ventanas de Contención Comercial)
        let politicaIntereses = null;
        try {
            const codigoCli = cliente?.codigo_bunker_cliente || clienteId;
            const reglas = await salvavidasService.resolverReglasFinanciacion(codigoCli, req.db);
            politicaIntereses = {
                habilitado: reglas.habilitado !== false,
                salvavidas_modo: reglas.salvavidas_modo,
                dias_ventana_estandar: reglas.dias_ventana_estandar || 7,
                dias_gracia_natural: reglas.dias_gracia_natural || 3,
                dias_tope_sin_comodin: (reglas.dias_ventana_estandar || 7) + (reglas.dias_gracia_natural || 3),
                dias_ventana_cortesia: reglas?.dias_ventana_cortesia ?? 7,
                dias_total_cortesia: (reglas?.dias_ventana_estandar || 7) + (reglas?.dias_ventana_cortesia ?? 7),
                cupo_cortesias_anual: reglas?.cupo_cortesias_anual ?? 3,
                cortesias_usadas_anio: reglas?.cortesias_usadas_anio ?? 0,
                cortesias_disponibles_anio: reglas?.cortesias_disponibles_anio ?? reglas?.cortesias_restantes_anio ?? 3,
                cortesias_restantes_anio: reglas?.cortesias_disponibles_anio ?? reglas?.cortesias_restantes_anio ?? 3,
                tasa_servicio_financiero: reglas.tasa_servicio_financiero || 3.0,
                tasa_tem: reglas.tasa_tem || 3.0,
                tasa_diaria: reglas.tasa_diaria || 0.001,
                iva_porcentaje: 21,
                modo_sistema: reglas.modo_sistema || 'SOMBRA',
                motivo_excepcion: reglas.motivo_excepcion || null
            };
        } catch (eSalv) {
            politicaIntereses = {
                habilitado: true,
                dias_ventana_estandar: 7,
                dias_ventana_cortesia: reglas?.dias_ventana_cortesia ?? 7,
                dias_total_cortesia: (reglas?.dias_ventana_estandar || 7) + (reglas?.dias_ventana_cortesia ?? 7),
                cupo_cortesias_anual: reglas?.cupo_cortesias_anual ?? 3,
                cortesias_usadas_anio: reglas?.cortesias_usadas_anio ?? 0,
                cortesias_restantes_anio: reglas?.cortesias_restantes_anio ?? 3,
                tasa_servicio_financiero: 3.0,
                tasa_tem: 3.0,
                tasa_diaria: 0.001,
                modo_sistema: 'SOMBRA'
            };
        }

        res.json({
            success: true,
            data: {
                cliente: cliente ? {
                    id: cliente.bunker_cliente_id,
                    codigo_bunker_cliente: cliente.codigo_bunker_cliente,
                    cliente_nombre: cliente.cliente_nombre,
                    razon_social: cliente.razon_social,
                    lista_id: cliente.lista_precio_id
                } : null,
                promos: ofertasAplicables,
                politica_comercial: politicaComercial,
                formas_pago: formasPago,
                politica_intereses: politicaIntereses
            }
        });

    } catch (error) {
        console.error(`❌ [PORTAL-COMERCIAL] Error al obtener info comercial para ${clienteId}:`, error);
        res.status(500).json({
            success: false,
            error: 'Error interno al obtener información comercial',
            message: error.message
        });
    }
};

router.get('/portal/info-comercial/:clienteId', resolverInfoComercialCliente);
router.get('/contexto-comercial/:clienteId', resolverInfoComercialCliente);

/**
 * @route GET /api/presupuestos/politicas/lista/:listaId
 * @desc Obtener la política comercial activa para una lista de precios
 */
router.get('/politicas/lista/:listaId', async (req, res) => {
    try {
        const politica = await PoliticasDescuentoService.obtenerPoliticaPorLista(req.params.listaId, req.db);
        res.json({ success: true, data: politica });
    } catch (error) {
        console.error('❌ [POLITICAS] Error al consultar política por lista:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

/**
 * @route GET /api/presupuestos/politicas/:id
 * @desc Obtener detalle de una política por ID
 */
router.get('/politicas/:id', async (req, res) => {
    try {
        const politica = await PoliticasDescuentoService.obtenerPoliticaPorId(req.params.id, req.db);
        if (!politica) return res.status(404).json({ success: false, error: 'Política no encontrada' });
        res.json({ success: true, data: politica });
    } catch (error) {
        console.error('❌ [POLITICAS] Error al obtener política por ID:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

/**
 * @route POST /api/presupuestos/politicas
 * @desc Crear o actualizar una política comercial de forma transaccional
 */
router.post('/politicas', async (req, res) => {
    try {
        const guardada = await PoliticasDescuentoService.guardarPolitica(req.body, req.db);
        res.json({ success: true, message: 'Política comercial guardada con éxito', data: guardada });
    } catch (error) {
        console.error('❌ [POLITICAS] Error al guardar política:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

/**
 * @route DELETE /api/presupuestos/politicas/:id
 * @desc Eliminar una política comercial
 */
router.delete('/politicas/:id', async (req, res) => {
    try {
        const ok = await PoliticasDescuentoService.eliminarPolitica(req.params.id, req.db);
        if (!ok) return res.status(404).json({ success: false, error: 'Política no encontrada' });
        res.json({ success: true, message: 'Política eliminada con éxito' });
    } catch (error) {
        console.error('❌ [POLITICAS] Error al eliminar política:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

/**
 * @route POST /api/presupuestos/politicas/evaluar
 * @desc Evaluar en tiempo real qué porcentaje y tramo corresponde según cliente, lista y montos
 */
router.post('/politicas/evaluar', async (req, res) => {
    try {
        const evaluacion = await PoliticasDescuentoService.evaluarDescuento(req.body, req.db);
        res.json({ success: true, data: evaluacion });
    } catch (error) {
        console.error('❌ [POLITICAS] Error al evaluar política:', error);
        res.status(500).json({ success: false, error: error.message });
    }
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
 * @route GET /api/presupuestos/:id/impresion-extras
 * @desc Obtener datos complementarios para preimpresión: ofertas activas del cliente, formas de pago y política de intereses
 * @access Privado
 */
router.get('/:id/impresion-extras', validatePermissions('presupuestos.read'), validarIdPresupuesto, async (req, res) => {
    const { id } = req.params;
    console.log(`🔍 [PRESUPUESTOS] Ruta GET /:id/impresion-extras - Obteniendo complementos para presupuesto ID: ${id}`);

    try {
        const OfertasDinamicasService = require('../services/ofertasDinamicasService');
        const salvavidasService = require('../../logistica/services/salvavidasService');

        // 1. Obtener presupuesto y vinculación de cliente
        const qPresu = `
            SELECT p.id, p.id_cliente, bc.id as bunker_cliente_id, bc.codigo_bunker_cliente,
                   COALESCE(bc.cliente_nombre, c.nombre || ' ' || COALESCE(c.apellido, '')) as cliente_nombre,
                   COALESCE(clp.bunker_lista_precio_id::text, c.lista_precios) as lista_precio_id
            FROM public.presupuestos p
            LEFT JOIN public.clientes c ON (
                CASE WHEN p.id_cliente ~ '^[0-9]+$' THEN c.cliente_id = CAST(p.id_cliente AS integer) ELSE false END
            )
            LEFT JOIN public.bunker_clientes bc ON (
                (c.cliente_id IS NOT NULL AND (bc.lomas_soft_id = LPAD(c.cliente_id::text, 4, '0') OR bc.lomas_soft_id = c.cliente_id::text OR bc.id = c.cliente_id))
                OR (p.id_cliente ~ '^[0-9]+$' AND (bc.lomas_soft_id = LPAD(p.id_cliente, 4, '0') OR bc.lomas_soft_id = p.id_cliente))
                OR bc.codigo_bunker_cliente = p.id_cliente
            )
            LEFT JOIN public.bunker_cliente_listas_precios clp ON clp.bunker_cliente_id = bc.id
            WHERE p.id = $1
        `;
        const resPresu = await req.db.query(qPresu, [parseInt(id)]);
        if (resPresu.rows.length === 0) {
            return res.status(404).json({ success: false, error: 'Presupuesto no encontrado' });
        }
        const presupuesto = resPresu.rows[0];

        // 2. Ofertas Dinámicas Activas aplicables a este cliente
        let ofertasAplicables = [];
        try {
            const todasOfertas = await OfertasDinamicasService.obtenerOfertas(req.db, true);
            const numClienteId = presupuesto.bunker_cliente_id || (presupuesto.id_cliente ? parseInt(presupuesto.id_cliente, 10) : null);
            const numListaId = presupuesto.lista_precio_id ? parseInt(presupuesto.lista_precio_id, 10) : null;

            ofertasAplicables = todasOfertas.filter(ofr => {
                if (numClienteId && ofr.excepciones && ofr.excepciones.length > 0) {
                    const exc = ofr.excepciones.find(e => e.cliente_id === numClienteId);
                    if (exc && exc.tipo_excepcion === 'EXCLUIDO') return false;
                }
                if (numListaId && ofr.listas && ofr.listas.length > 0) {
                    const matchLista = ofr.listas.some(l => l.bunker_lista_precio_id === numListaId);
                    if (!matchLista) return false;
                }
                return true;
            }).map(o => ({
                id: o.id,
                titulo: o.titulo,
                descripcion: o.descripcion,
                tipo_beneficio: o.tipo_beneficio,
                descuento_porcentaje: o.descuento_porcentaje,
                cuota_disponible: o.cuota_disponible,
                cuota_total: o.cuota_total,
                unidad_cuota: o.unidad_cuota,
                condicion_cierre: o.condicion_cierre,
                fecha_fin: o.fecha_fin,
                no_acumulable_con_politica: o.no_acumulable_con_politica,
                articulos: (o.articulos || []).map(a => ({
                    articulo_numero: a.articulo_numero,
                    descripcion: a.descripcion_generada || a.articulo_descripcion || a.descripcion,
                    kilos_unidad: a.kilos_unidad,
                    precio_fijo_oferta: a.precio_fijo_oferta
                }))
            }));
        } catch (errOfertas) {
            console.warn('⚠️ [PRESUPUESTOS] Error al obtener ofertas activas:', errOfertas.message);
        }

        // 2b. Política Comercial de Bonificación por Volumen (Escala Comercial)
        let politicaComercial = null;
        try {
            const numClienteId = presupuesto.bunker_cliente_id || (presupuesto.id_cliente ? parseInt(presupuesto.id_cliente, 10) : null);
            const numListaId = presupuesto.lista_precio_id ? parseInt(presupuesto.lista_precio_id, 10) : null;
            
            let infoPol = null;
            if (numClienteId) {
                infoPol = await PoliticasDescuentoService.obtenerPoliticaPorCliente(numClienteId, req.db);
            } else if (numListaId) {
                const polDirecta = await PoliticasDescuentoService.obtenerPoliticaPorLista(numListaId, req.db);
                if (polDirecta) {
                    infoPol = {
                        tiene_politica: true,
                        lista_id: numListaId,
                        lista_nombre: polDirecta.lista_nombre,
                        politica: polDirecta,
                        excepcion: null
                    };
                }
            }

            if (infoPol && infoPol.tiene_politica && infoPol.politica && infoPol.politica.tramos && infoPol.politica.tramos.length > 0) {
                politicaComercial = {
                    id: infoPol.politica.id,
                    nombre: infoPol.politica.nombre,
                    descripcion: infoPol.politica.descripcion,
                    lista_id: infoPol.lista_id,
                    lista_nombre: infoPol.lista_nombre || 'General',
                    tipo_calculo: infoPol.politica.tipo_calculo,
                    aplica_sobre: infoPol.politica.aplica_sobre,
                    exige_saldo_cero: infoPol.politica.exige_saldo_cero !== false,
                    tolerancia_saldo: parseFloat(infoPol.politica.tolerancia_saldo) || 150.00,
                    no_acumulable: infoPol.politica.no_acumulable !== false,
                    saldo_cuenta_corriente: infoPol.saldo_cuenta_corriente || 0,
                    tramos: infoPol.politica.tramos || [],
                    excepcion: infoPol.excepcion
                };
            }
        } catch (errPol) {
            console.warn('⚠️ [PRESUPUESTOS] Error al obtener política comercial:', errPol.message);
        }

        // 3. Reglas de Asistencia Financiera (Modo Sombra)
        let politicaIntereses = null;
        try {
            const codigoCli = presupuesto.codigo_bunker_cliente || '';
            const reglas = await salvavidasService.resolverReglasFinanciacion(codigoCli, req.db);
            politicaIntereses = {
                habilitado: reglas.habilitado !== false,
                salvavidas_modo: reglas.salvavidas_modo,
                dias_ventana_estandar: reglas.dias_ventana_estandar || 7,
                dias_gracia_natural: reglas.dias_gracia_natural || 3,
                dias_tope_sin_comodin: (reglas.dias_ventana_estandar || 7) + (reglas.dias_gracia_natural || 3),
                dias_ventana_cortesia: reglas?.dias_ventana_cortesia ?? 7,
                dias_total_cortesia: (reglas?.dias_ventana_estandar || 7) + (reglas?.dias_ventana_cortesia ?? 7),
                cupo_cortesias_anual: reglas?.cupo_cortesias_anual ?? 3,
                cortesias_usadas_anio: reglas?.cortesias_usadas_anio ?? 0,
                cortesias_disponibles_anio: reglas?.cortesias_disponibles_anio ?? reglas?.cortesias_restantes_anio ?? 3,
                cortesias_restantes_anio: reglas?.cortesias_disponibles_anio ?? reglas?.cortesias_restantes_anio ?? 3,
                tasa_servicio_financiero: reglas.tasa_servicio_financiero || 3.0,
                tasa_tem: reglas.tasa_tem || 3.0,
                tasa_diaria: reglas.tasa_diaria || 0.001,
                iva_porcentaje: 21,
                modo_sistema: reglas.modo_sistema || 'SOMBRA',
                motivo_excepcion: reglas.motivo_excepcion || null
            };
        } catch (errSalvavidas) {
            console.warn('⚠️ [PRESUPUESTOS] Error al resolver reglas financieras:', errSalvavidas.message);
            politicaIntereses = {
                habilitado: true,
                dias_ventana_estandar: 7,
                dias_ventana_cortesia: reglas?.dias_ventana_cortesia ?? 7,
                dias_total_cortesia: (reglas?.dias_ventana_estandar || 7) + (reglas?.dias_ventana_cortesia ?? 7),
                cupo_cortesias_anual: reglas?.cupo_cortesias_anual ?? 3,
                cortesias_usadas_anio: reglas?.cortesias_usadas_anio ?? 0,
                cortesias_restantes_anio: reglas?.cortesias_restantes_anio ?? 3,
                tasa_servicio_financiero: 3.0,
                tasa_tem: 3.0,
                tasa_diaria: 0.001,
                modo_sistema: 'SOMBRA'
            };
        }

        // 4. Formas de Pago Oficiales
        const formasPago = {
            banco: {
                nombre: 'Banco Galicia',
                alias: 'LAMDA.SER.MARTIN'
            },
            ensobrado: {
                titulo: 'Ensobrado',
                canales: [
                    'Portal de Clientes LAMDA (función Pagos en Efectivo / Ensobrado)',
                    'Enlace Móvil por WhatsApp (asistente interactivo sin claves para celular)'
                ],
                instruccion: 'Anota el monto, el sistema acompaña el conteo exacto de billetes, se rotula el sobre con el N° asignado (ej: SOB-XXXX), se cargan 2 fotos (frente y dorso) y al finalizar envía confirmación automática por WhatsApp.'
            },
            cajero: {
                titulo: 'Cajero Automático / Terminal Autoservicio Galicia',
                cuenta: 'Caja de Ahorro Galicia 4007844-1 373-4',
                titular: 'Martin Ignacio Serrano',
                disponibilidad: 'Lobbies 24 hs habilitados todos los días',
                sucursales_la_plata: [
                    'La Plata Centro: Calle 7 N° 875 (e/ 49 y 50) | Calle 13 N° 665 (Plaza Paso) | Av. 7 N° 59 (Plaza Olazábal)',
                    'Los Hornos / Acceso Sur: Av. 44 N° 1724 (esq. 29)',
                    'City Bell / Gonnet / Zona Norte: Plaza Gral. Belgrano N° 57/63 (City Bell)'
                ]
            }
        };

        res.json({
            success: true,
            data: {
                promos: ofertasAplicables,
                politica_comercial: politicaComercial,
                formas_pago: formasPago,
                politica_intereses: politicaIntereses
            }
        });

    } catch (error) {
        console.error(`❌ [PRESUPUESTOS] Error en ruta GET /:id/impresion-extras (${id}):`, error);
        res.status(500).json({
            success: false,
            error: 'Error interno al obtener complementos de impresión',
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
 * @route POST /api/presupuestos/:id/archivar
 * @desc Archivar presupuesto (ocultar de la vista activa)
 * @access Privado
 */
router.post('/:id/archivar',
    validatePermissions('presupuestos.delete'),
    validarIdPresupuesto,
    async (req, res) => {
        const { id } = req.params;
        console.log(`🗂️ [PRESUPUESTOS-WRITE] Ruta POST /:id/archivar - Archivando presupuesto ID: ${id}`);

        try {
            const query = 'UPDATE public.presupuestos SET archivado = true WHERE id = $1';
            await req.db.query(query, [id]);
            res.json({
                success: true,
                message: 'Presupuesto archivado correctamente'
            });
        } catch (error) {
            console.error(`❌ [PRESUPUESTOS-WRITE] Error en ruta POST /:id/archivar (${id}):`, error);
            res.status(500).json({
                success: false,
                error: 'Error interno al archivar presupuesto',
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

/**
 * @route PUT /api/presupuestos/clientes/:clienteId/preferencia-facturacion
 * @desc Actualizar la preferencia de facturación del cliente
 * @access Privado
 */
router.put('/clientes/:clienteId/preferencia-facturacion', validatePermissions('presupuestos.write'), async (req, res) => {
    const { clienteId } = req.params;
    const { preferencia_facturacion } = req.body;

    console.log(`[CLIENTES] Ruta PUT /clientes/${clienteId}/preferencia-facturacion - preferencia: ${preferencia_facturacion}`);

    try {
        const query = `
            UPDATE public.clientes 
            SET preferencia_facturacion = $1 
            WHERE cliente_id = $2
            RETURNING cliente_id, preferencia_facturacion
        `;
        const result = await req.db.query(query, [preferencia_facturacion, parseInt(clienteId, 10)]);

        if (result.rowCount === 0) {
            return res.status(404).json({
                success: false,
                error: 'Cliente no encontrado en la base de datos'
            });
        }

        res.json({
            success: true,
            message: 'Preferencia de facturación actualizada con éxito',
            data: result.rows[0]
        });
    } catch (error) {
        console.error('❌ [CLIENTES] Error actualizando preferencia:', error);
        res.status(500).json({
            success: false,
            error: 'Error interno al actualizar preferencia de facturación',
            message: error.message
        });
    }
});

// ==========================================
// ⚖️ RUTAS PARA SALDO DE INGREDIENTE EN PRESUPUESTOS
// ==========================================

/**
 * GET /api/presupuestos/saldo-ingrediente/cable?codigo=...&descripcion=...
 * Resuelve el "Cable" Artículo <-> Ingrediente y los kilos de la unidad comercial.
 */
router.get('/saldo-ingrediente/cable', async (req, res) => {
    try {
        const codigo = String(req.query.codigo || '').trim();
        const descripcion = String(req.query.descripcion || '').trim();

        if (!codigo && !descripcion) {
            return res.status(400).json({ success: false, error: 'Se requiere codigo o descripcion del artículo' });
        }

        const artRes = await req.db.query(`
            SELECT
                COALESCE(src.articulo_numero, a.numero, ba.articulo_id) AS numero,
                COALESCE(src.codigo_barras, a.codigo_barras, ba.articulo_id) AS codigo_barras,
                COALESCE(src.descripcion, a.nombre, ba.descripcion) AS nombre,
                COALESCE(NULLIF(src.kilos_unidad::numeric, 0), NULLIF(ba.kilos_unidad::numeric, 0)) AS kilos_unidad
            FROM (SELECT $1::text AS cod, $2::text AS desc_txt) q
            LEFT JOIN public.stock_real_consolidado src
                ON src.articulo_numero = q.cod OR src.codigo_barras = q.cod OR LOWER(TRIM(src.descripcion)) = LOWER(q.desc_txt)
            LEFT JOIN public.articulos a
                ON a.numero = q.cod OR a.codigo_barras = q.cod OR LOWER(TRIM(a.nombre)) = LOWER(q.desc_txt)
            LEFT JOIN public.bunker_articulos ba
                ON ba.articulo_id = q.cod OR LOWER(TRIM(ba.descripcion)) = LOWER(q.desc_txt)
            LIMIT 1
        `, [codigo, descripcion]);

        const art = artRes.rows[0] || null;
        let kilosUnidad = art && Number(art.kilos_unidad) > 0 ? Number(art.kilos_unidad) : null;

        const textoRef = (art?.nombre || descripcion || '');
        if (!kilosUnidad && textoRef) {
            const mKg = textoRef.match(/(?:x|\bpor\b|\bde\b|\b)\s*(\d+(?:[.,]\d+)?)\s*(?:kg|kilo|kilos)\b/i);
            if (mKg) {
                kilosUnidad = parseFloat(mKg[1].replace(',', '.'));
            } else {
                const mGr = textoRef.match(/(?:x|\bpor\b|\bde\b|\b)\s*(\d+(?:[.,]\d+)?)\s*(?:gr|grs|g|gramos)\b/i);
                if (mGr) {
                    kilosUnidad = parseFloat(mGr[1].replace(',', '.')) / 1000;
                }
            }
        }
        if (!kilosUnidad || kilosUnidad <= 0) kilosUnidad = 1;

        const codigosBusqueda = Array.from(new Set([codigo, art?.numero, art?.codigo_barras].filter(Boolean)));

        const ingRes = await req.db.query(`
            WITH candidatos AS (
                SELECT ian.ingrediente_id, 'Nutriente directo (Artículo → Ingrediente)' AS origen_cable, 1 AS prioridad
                FROM public.ingrediente_articulos_nutrientes ian
                WHERE ian.articulo_numero = ANY($1::text[]) AND COALESCE(ian.activo, true) = true
                UNION ALL
                SELECT iba.ingrediente_id, 'Vínculo Búnker (Artículo ↔ Ingrediente)' AS origen_cable, 2 AS prioridad
                FROM public.ingrediente_bunker_articulos iba
                WHERE iba.bunker_articulo_id::text = ANY($1::text[])
                UNION ALL
                SELECT i.id AS ingrediente_id, 'Artículo vinculado directo' AS origen_cable, 3 AS prioridad
                FROM public.ingredientes i
                WHERE i.articulo_vinculado_numero = ANY($1::text[])
                UNION ALL
                SELECT ri.ingrediente_id, 'Receta del artículo' AS origen_cable, 4 AS prioridad
                FROM public.recetas r
                JOIN public.receta_ingredientes ri ON ri.receta_id = r.id
                WHERE r.articulo_numero = ANY($1::text[])
            ),
            unicos AS (
                SELECT DISTINCT ON (ingrediente_id) ingrediente_id, origen_cable, prioridad
                FROM candidatos
                ORDER BY ingrediente_id, prioridad ASC
            )
            SELECT
                i.id,
                i.codigo,
                i.nombre,
                i.unidad_medida,
                COALESCE(i.stock_actual, 0)::numeric(10,3) AS stock_actual,
                COALESCE(s.nombre, s.descripcion) AS sector_letra,
                c.nombre AS categoria,
                u.origen_cable,
                u.prioridad
            FROM unicos u
            JOIN public.ingredientes i ON i.id = u.ingrediente_id
            LEFT JOIN public.sectores_ingredientes s ON s.id = i.sector_id
            LEFT JOIN public.categorias_ingredientes c ON c.id = i.categoria_id
            ORDER BY u.prioridad ASC, i.stock_actual DESC
        `, [codigosBusqueda]);

        res.json({
            success: true,
            articulo: {
                numero: art?.numero || codigo,
                codigo_barras: art?.codigo_barras || codigo,
                nombre: art?.nombre || descripcion,
                kilos_unidad: kilosUnidad
            },
            ingredientes_vinculados: ingRes.rows
        });
    } catch (error) {
        console.error('❌ [SALDO-INGREDIENTE] Error en /saldo-ingrediente/cable:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

/**
 * GET /api/presupuestos/saldo-ingrediente/ingredientes
 * Lista todos los ingredientes activos con su stock actual y sector para el buscador manual / escáner.
 */
router.get('/saldo-ingrediente/ingredientes', async (req, res) => {
    try {
        const result = await req.db.query(`
            SELECT
                i.id,
                i.codigo,
                i.nombre,
                i.unidad_medida,
                COALESCE(i.stock_actual, 0)::numeric(10,3) AS stock_actual,
                COALESCE(s.nombre, s.descripcion) AS sector_letra,
                c.nombre AS categoria,
                c.nombre AS nombre_categoria
            FROM public.ingredientes i
            LEFT JOIN public.sectores_ingredientes s ON s.id = i.sector_id
            LEFT JOIN public.categorias_ingredientes c ON c.id = i.categoria_id
            ORDER BY i.nombre ASC
        `);
        res.json({ success: true, data: result.rows });
    } catch (error) {
        console.error('❌ [SALDO-INGREDIENTE] Error en /saldo-ingrediente/ingredientes:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

/**
 * POST /api/presupuestos/saldo-ingrediente/etiqueta
 * Imprime en Zebra la etiqueta del artículo comercial con la aclaración del saldo en KG
 * utilizando el motor oficial del taller (src/scripts/imprimirEtiqueta.js -> \\localhost\Zebra).
 */
router.post('/saldo-ingrediente/etiqueta', async (req, res) => {
    const fs = require('fs');
    const path = require('path');
    const { exec } = require('child_process');
    try {
        const {
            articulo_numero,
            articulo_nombre,
            nombre,
            codigo_barras,
            kilos_saldo,
            cantidad_equivalente,
            ingrediente_nombre,
            cantidad_etiquetas
        } = req.body || {};

        const nombreArt = String(articulo_nombre || nombre || '').trim();
        const barArt = String(codigo_barras || articulo_numero || '').trim();

        if (!nombreArt || !barArt) {
            return res.status(400).json({ success: false, error: 'Faltan datos del artículo para imprimir etiqueta' });
        }

        const kgNum = Number(kilos_saldo) || 0;
        const cantNum = Number(cantidad_equivalente) || 0;
        const kilosPunto = kgNum.toFixed(3).replace(/\.?0+$/, '');
        const kilosComa = kilosPunto.replace('.', ',');
        const cantEqComa = cantNum.toFixed(3).replace(/\.?0+$/, '').replace('.', ',');

        // Reemplazar la presentación comercial (ej: "x 5kg") en el nombre de la etiqueta por el peso real ingresado a mano (ej: "x 1,8kg")
        const regexPresentacion = /(\b(?:x|por)\s*\d+(?:[.,]\d+)?\s*(?:kg|kilo|kilos|gr|grs|g)\.?)/i;
        let presentacionOriginal = '';
        let nombreConSaldo = nombreArt;
        const matchPres = nombreArt.match(regexPresentacion);
        if (matchPres) {
            presentacionOriginal = matchPres[1].trim();
            nombreConSaldo = nombreArt.replace(regexPresentacion, `x ${kilosComa}kg`);
        } else {
            nombreConSaldo = `${nombreArt} (${kilosComa}kg)`;
        }

        const subtLinea = presentacionOriginal
            ? `SALDO ${kilosComa}kg (de ${presentacionOriginal} = ${cantEqComa}u)`
            : `SALDO: ${kilosComa} KG (${cantEqComa} u)`;

        const cantCopias = Math.max(1, parseInt(cantidad_etiquetas, 10) || 2);
        const datosEtiqueta = {
            articulo: {
                numero: subtLinea,
                nombre: nombreConSaldo.substring(0, 65),
                codigo_barras: barArt
            },
            cantidad: cantCopias
        };

        const scriptPath = path.resolve(__dirname, '../../scripts/imprimirEtiqueta.js');
        const tempDir = path.resolve(__dirname, '../../app-etiquetas/temp');
        if (!fs.existsSync(tempDir)) {
            fs.mkdirSync(tempDir, { recursive: true });
        }

        const uniqueId = `${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
        const customTempPath = path.join(tempDir, `temp-data-${uniqueId}.json`);
        const defaultTempPath = path.join(tempDir, 'temp-data.json');
        const jsonPayload = JSON.stringify(datosEtiqueta, null, 2);

        fs.writeFileSync(customTempPath, jsonPayload, 'utf8');
        try { fs.writeFileSync(defaultTempPath, jsonPayload, 'utf8'); } catch (_) {}

        const srcDir = path.resolve(__dirname, '../..');
        const command = `cd "${srcDir}" && node "${scriptPath}" ${cantCopias} "${customTempPath}"`;

        await new Promise((resolve, reject) => {
            exec(command, (error, stdout, stderr) => {
                if (error) {
                    console.error('❌ [SALDO-INGREDIENTE] Error ejecutando imprimirEtiqueta.js:', error, stderr);
                    return reject(new Error(stderr || error.message || 'Error al enviar impresión a Zebra'));
                }
                resolve(stdout);
            });
        });

        res.json({ success: true, message: 'Etiqueta de saldo enviada a Zebra correctamente', datos: datosEtiqueta });
    } catch (error) {
        console.error('❌ [SALDO-INGREDIENTE] Error imprimiendo etiqueta:', error);
        res.status(500).json({ success: false, error: error.message });
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
