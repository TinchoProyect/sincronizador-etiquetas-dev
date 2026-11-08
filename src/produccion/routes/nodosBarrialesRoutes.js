const express = require('express');
const router = express.Router();
const nodosService = require('../services/nodosBarrialesService');

/**
 * GET /api/produccion/nodos/inicializar
 * Devuelve Nodos Maestro, Catálogo Aislado de Nodos, Propuestas de Fracciones,
 * Ofertas por Gestor y las Fuentes de Costo de los 6 Flujos de la Pizarra.
 */
router.get('/inicializar', async (req, res) => {
    try {
        const data = await nodosService.obtenerEstadoCompletoNodos();
        res.json({ ok: true, ...data });
    } catch (error) {
        console.error('❌ [NodosRoutes] Error en GET /inicializar:', error);
        res.status(500).json({ ok: false, error: error.message });
    }
});

/**
 * POST /api/produccion/nodos/calcular-preview
 * Simulación instantánea de costos de una fracción sobre cualquiera de los 6 Flujos
 */
router.post('/calcular-preview', async (req, res) => {
    try {
        const resultado = nodosService.calcularEstructuraCostosNodo(req.body || {});
        res.json({ ok: true, calculo: resultado });
    } catch (error) {
        res.status(400).json({ ok: false, error: error.message });
    }
});

/**
 * POST /api/produccion/nodos/convertir-logo-zpl
 * Convierte un PNG/JPG base64 o monograma a ZPL ^GFA y devuelve el preview monocromático 1-bit
 */
router.post('/convertir-logo-zpl', async (req, res) => {
    try {
        const conv = await nodosService.convertirLogoAZplGfa(req.body || {});
        res.json({
            ok: true,
            width: conv.width,
            height: conv.height,
            bytesPerRow: conv.bytesPerRow,
            totalBytes: conv.totalBytes,
            logo_zpl_gfa: conv.logo_zpl_gfa,
            logo_mono_preview_base64: conv.logo_mono_preview_base64
        });
    } catch (error) {
        console.error('❌ [NodosRoutes] Error en POST /convertir-logo-zpl:', error);
        res.status(400).json({ ok: false, error: error.message });
    }
});

/**
 * POST /api/produccion/nodos/preview-etiqueta
 * Genera el ZPL en rollo de doble columna (X=23 izquierda / X=443 derecha) con soporte
 * de etiquetas de continuación si hay más de 6 ítems, y renderiza la vista previa PNG.
 */
router.post('/preview-etiqueta', async (req, res) => {
    try {
        const preview = await nodosService.generarPreviewVisualEtiquetaPar(req.body || {});
        res.json({ ok: true, ...preview });
    } catch (error) {
        console.error('❌ [NodosRoutes] Error en POST /preview-etiqueta:', error);
        res.status(400).json({ ok: false, error: error.message });
    }
});

/**
 * POST /api/produccion/nodos/maestro
 * Crea un nuevo Nodo Barrial
 */
router.post('/maestro', async (req, res) => {
    try {
        const nodo = await nodosService.guardarNodoMaestro(req.body || {}, null);
        res.json({ ok: true, nodo });
    } catch (error) {
        console.error('❌ [NodosRoutes] Error creando Nodo:', error);
        res.status(400).json({ ok: false, error: error.message });
    }
});

/**
 * PUT /api/produccion/nodos/maestro/:id
 * Actualiza un Nodo Barrial existente y regenera su gráfico ZPL ^GFA
 */
router.put('/maestro/:id', async (req, res) => {
    try {
        const nodo = await nodosService.guardarNodoMaestro(req.body || {}, req.params.id);
        res.json({ ok: true, nodo });
    } catch (error) {
        console.error('❌ [NodosRoutes] Error actualizando Nodo:', error);
        res.status(400).json({ ok: false, error: error.message });
    }
});

/**
 * POST /api/produccion/nodos/propuestas
 * Crea una nueva solicitud/propuesta de fracción de un gestor de Nodo hacia LAMDA
 */
router.post('/propuestas', async (req, res) => {
    try {
        const propuesta = await nodosService.crearPropuestaFraccion(req.body || {});
        res.json({ ok: true, propuesta });
    } catch (error) {
        console.error('❌ [NodosRoutes] Error creando propuesta:', error);
        res.status(400).json({ ok: false, error: error.message });
    }
});

/**
 * POST /api/produccion/nodos/cotizar-aprobar
 * Cotiza en Pizarra una fracción, la aprueba en el catálogo aislado de Nodos
 * y propaga el Precio Base Nodo a las ofertas de los gestores.
 */
router.post('/cotizar-aprobar', async (req, res) => {
    try {
        const resultado = await nodosService.cotizarYAprobarArticuloNodo(req.body || {});
        res.json({ ok: true, ...resultado });
    } catch (error) {
        console.error('❌ [NodosRoutes] Error cotizando/aprobando artículo de Nodo:', error);
        res.status(400).json({ ok: false, error: error.message });
    }
});

/**
 * POST /api/produccion/nodos/recalcular-cascada
 * Sincroniza todo el catálogo de Nodos con los costos vivos de los 6 Flujos de la Pizarra
 */
router.post('/recalcular-cascada', async (req, res) => {
    try {
        const costosSimulados = (req.body && req.body.costos_simulados) || {};
        const resultado = await nodosService.recalcularCascadaCatalogoNodos(costosSimulados);
        res.json({ ok: true, ...resultado });
    } catch (error) {
        console.error('❌ [NodosRoutes] Error recalculando cascada Nodos:', error);
        res.status(500).json({ ok: false, error: error.message });
    }
});

/**
 * PUT /api/produccion/nodos/ofertas-gestor/:id
 * Actualiza el margen del gestor y/o el estado de publicación para sus vecinos
 */
router.put('/ofertas-gestor/:id', async (req, res) => {
    try {
        const oferta = await nodosService.actualizarOfertaGestor(req.params.id, req.body || {});
        res.json({ ok: true, oferta });
    } catch (error) {
        console.error('❌ [NodosRoutes] Error actualizando oferta gestor:', error);
        res.status(400).json({ ok: false, error: error.message });
    }
});

// ============================================================================
// ENDPOINTS ETAPA 2: TIENDA MARCA BLANCA DEL VECINO Y PANEL DEL GESTOR
// ============================================================================

/**
 * GET /api/produccion/nodos/portal/:slug
 * Devuelve el catálogo publicado, horarios de corte, próxima entrega, pedidos y ofertas del Nodo
 */
router.get('/portal/:slug', async (req, res) => {
    try {
        const fechaSimulada = req.query.fecha_simulada || null;
        const data = await nodosService.obtenerDatosPortalNodo(req.params.slug, fechaSimulada);
        res.json({ ok: true, ...data });
    } catch (error) {
        console.error('❌ [NodosRoutes] Error en GET /portal/:slug:', error);
        res.status(400).json({ ok: false, error: error.message });
    }
});

/**
 * PUT /api/produccion/nodos/gestor/:nodoId/config-logistica
 * Actualiza desde el Panel del Gestor los días de entrega, horarios de corte,
 * ventanas de retiro y costo de envío barrial (100% para el gestor).
 */
router.put('/gestor/:nodoId/config-logistica', async (req, res) => {
    try {
        const nodo = await nodosService.actualizarConfiguracionGestorNodo(req.params.nodoId, req.body || {});
        res.json({ ok: true, nodo });
    } catch (error) {
        console.error('❌ [NodosRoutes] Error en PUT /gestor/:nodoId/config-logistica:', error);
        res.status(400).json({ ok: false, error: error.message });
    }
});

/**
 * POST /api/produccion/nodos/tienda/:slug/pedido
 * Registra el pedido de un vecino desde la Tienda Marca Blanca
 */
router.post('/tienda/:slug/pedido', async (req, res) => {
    try {
        const resultado = await nodosService.crearPedidoVecinoTienda(req.params.slug, req.body || {});
        res.json({ ok: true, ...resultado });
    } catch (error) {
        console.error('❌ [NodosRoutes] Error en POST /tienda/:slug/pedido:', error);
        res.status(400).json({ ok: false, error: error.message });
    }
});

/**
 * GET /api/produccion/nodos/pedidos/:pedidoId/etiqueta
 * Devuelve la etiqueta térmica Zebra en doble columna (PNG + ZPL) de un pedido vecinal
 */
router.get('/pedidos/:pedidoId/etiqueta', async (req, res) => {
    try {
        const etiqueta = await nodosService.generarEtiquetaDePedidoExistente(req.params.pedidoId);
        res.json({ ok: true, ...etiqueta });
    } catch (error) {
        console.error('❌ [NodosRoutes] Error en GET /pedidos/:pedidoId/etiqueta:', error);
        res.status(400).json({ ok: false, error: error.message });
    }
});

// ============================================================================
// ENDPOINTS ETAPA 3: MESA DE ARMADO, 4° DEPÓSITO (ESTACION_NODOS) Y QR MAESTRO
// ============================================================================

/**
 * GET /api/produccion/nodos/deposito/tablero
 * Devuelve los Canastos de ESTACION_NODOS, el resumen consolidado a fraccionar y las bolsas por vecino
 */
router.get('/deposito/tablero', async (req, res) => {
    try {
        const data = await nodosService.obtenerTableroMesaArmadoDeposito({
            nodo_id: req.query.nodo_id || 0
        });
        res.json({ ok: true, ...data });
    } catch (error) {
        console.error('❌ [NodosRoutes] Error en GET /deposito/tablero:', error);
        res.status(500).json({ ok: false, error: error.message });
    }
});

/**
 * POST /api/produccion/nodos/deposito/pedidos/:pedidoId/armar-bolsa
 * Marca el pedido de un vecino como preparado, lo aloja en el Canasto de ESTACION_NODOS
 * y devuelve su par gemelo de etiquetas térmicas Zebra.
 */
router.post('/deposito/pedidos/:pedidoId/armar-bolsa', async (req, res) => {
    try {
        const resultado = await nodosService.armarBolsaPedidoVecino(req.params.pedidoId, req.body || {});
        res.json({ ok: true, ...resultado });
    } catch (error) {
        console.error('❌ [NodosRoutes] Error en POST /deposito/pedidos/:pedidoId/armar-bolsa:', error);
        res.status(400).json({ ok: false, error: error.message });
    }
});

/**
 * POST /api/produccion/nodos/deposito/canastos/:canastoId/armar-todo
 * Marca todas las bolsas pendientes del Canasto como listas en ESTACION_NODOS
 */
router.post('/deposito/canastos/:canastoId/armar-todo', async (req, res) => {
    try {
        const resultado = await nodosService.armarTodasBolsasDeCanasto(req.params.canastoId, req.body || {});
        res.json({ ok: true, ...resultado });
    } catch (error) {
        console.error('❌ [NodosRoutes] Error en POST /deposito/canastos/:canastoId/armar-todo:', error);
        res.status(400).json({ ok: false, error: error.message });
    }
});

/**
 * GET /api/produccion/nodos/deposito/canastos/:canastoId/etiqueta-qr
 * Genera la Etiqueta Maestra del Canasto con su QR Maestro y manifiesto de bolsas
 */
router.get('/deposito/canastos/:canastoId/etiqueta-qr', async (req, res) => {
    try {
        const etiqueta = await nodosService.generarEtiquetaQrMaestroCanasto(req.params.canastoId);
        res.json({ ok: true, ...etiqueta });
    } catch (error) {
        console.error('❌ [NodosRoutes] Error en GET /deposito/canastos/:canastoId/etiqueta-qr:', error);
        res.status(400).json({ ok: false, error: error.message });
    }
});

/**
 * POST /api/produccion/nodos/deposito/canastos/:canastoId/entregar-gestor
 * Confirma el retiro del Canasto por el Gestor (escaneo QR Maestro), pasa los pedidos
 * a "En reparto / En poder del Gestor" e impacta el Débito por Costo Base LAMDA en Cta. Cte.
 */
router.post('/deposito/canastos/:canastoId/entregar-gestor', async (req, res) => {
    try {
        const resultado = await nodosService.confirmarRetiroCanastoPorGestor(req.params.canastoId, req.body || {});
        res.json({ ok: true, ...resultado });
    } catch (error) {
        console.error('❌ [NodosRoutes] Error en POST /deposito/canastos/:canastoId/entregar-gestor:', error);
        res.status(400).json({ ok: false, error: error.message });
    }
});

/**
 * POST /api/produccion/nodos/deposito/canastos/:canastoId/reabrir-prueba
 * Permite en Modo Laboratorio reabrir un Canasto entregado para volver a probar el flujo
 */
router.post('/deposito/canastos/:canastoId/reabrir-prueba', async (req, res) => {
    try {
        const tablero = await nodosService.reabrirCanastoParaPruebaLaboratorio(req.params.canastoId);
        res.json({ ok: true, tablero });
    } catch (error) {
        console.error('❌ [NodosRoutes] Error en POST /deposito/canastos/:canastoId/reabrir-prueba:', error);
        res.status(400).json({ ok: false, error: error.message });
    }
});

// ============================================================================
// ENDPOINTS ETAPA 4: CONCILIACIÓN DE COBROS Y LIQUIDACIÓN DE CUENTA CORRIENTE
// ============================================================================

/**
 * GET /api/produccion/nodos/liquidacion/tablero
 * Devuelve los lotes, el cuadro de liquidación y compensación automática,
 * los titulares bancarios aprendidos y el libro mayor de Cuenta Corriente del Nodo.
 */
router.get('/liquidacion/tablero', async (req, res) => {
    try {
        const data = await nodosService.obtenerTableroLiquidacionCobros({
            nodo_id: req.query.nodo_id || 0
        });
        res.json({ ok: true, ...data });
    } catch (error) {
        console.error('❌ [NodosRoutes] Error en GET /liquidacion/tablero:', error);
        res.status(500).json({ ok: false, error: error.message });
    }
});

/**
 * POST /api/produccion/nodos/liquidacion/pedidos/:pedidoId/conciliar-pago
 * Concilia una transferencia vecinal en Banco LAMDA (acreditando a favor del Nodo y
 * aprendiendo el titular) o registra el cobro en efectivo en mano del Gestor.
 */
router.post('/liquidacion/pedidos/:pedidoId/conciliar-pago', async (req, res) => {
    try {
        const tablero = await nodosService.conciliarPagoPedidoVecino(req.params.pedidoId, req.body || {});
        res.json({ ok: true, tablero });
    } catch (error) {
        console.error('❌ [NodosRoutes] Error en POST /liquidacion/pedidos/:pedidoId/conciliar-pago:', error);
        res.status(400).json({ ok: false, error: error.message });
    }
});

/**
 * POST /api/produccion/nodos/liquidacion/canastos/:canastoId/conciliar-todo
 * Concilia todos los cobros pendientes del lote (transferencias + efectivo)
 */
router.post('/liquidacion/canastos/:canastoId/conciliar-todo', async (req, res) => {
    try {
        const tablero = await nodosService.conciliarTodosLosPagosPendientesCanasto(req.params.canastoId);
        res.json({ ok: true, tablero });
    } catch (error) {
        console.error('❌ [NodosRoutes] Error en POST /liquidacion/canastos/:canastoId/conciliar-todo:', error);
        res.status(400).json({ ok: false, error: error.message });
    }
});

/**
 * POST /api/produccion/nodos/liquidacion/canastos/:canastoId/cerrar-liquidacion
 * Ejecuta la compensación automática y deja saldada la Cuenta Corriente del lote
 */
router.post('/liquidacion/canastos/:canastoId/cerrar-liquidacion', async (req, res) => {
    try {
        const tablero = await nodosService.cerrarLiquidacionCanasto(req.params.canastoId, req.body || {});
        res.json({ ok: true, tablero });
    } catch (error) {
        console.error('❌ [NodosRoutes] Error en POST /liquidacion/canastos/:canastoId/cerrar-liquidacion:', error);
        res.status(400).json({ ok: false, error: error.message });
    }
});

/**
 * POST /api/produccion/nodos/liquidacion/canastos/:canastoId/reabrir-prueba
 * Permite en Modo Laboratorio reabrir los cobros y la liquidación del lote para repetir la prueba
 */
router.post('/liquidacion/canastos/:canastoId/reabrir-prueba', async (req, res) => {
    try {
        const tablero = await nodosService.reabrirLiquidacionCanastoPrueba(req.params.canastoId);
        res.json({ ok: true, tablero });
    } catch (error) {
        console.error('❌ [NodosRoutes] Error en POST /liquidacion/canastos/:canastoId/reabrir-prueba:', error);
        res.status(400).json({ ok: false, error: error.message });
    }
});

// ============================================================================
// ENDPOINTS INTEGRACIÓN CON EL CIRCUITO OPERATIVO HABITUAL DE LAMDA
// (Pizarra Principal :3000 -> Producción/Carro Personal -> Imprimir -> Armar/Chequeo -> Reparto :3005)
// ============================================================================

/**
 * GET /api/produccion/nodos/circuito-lamda/estado
 * Devuelve el estado sincronizado de todos los Canastos de Nodos dentro del circuito operativo LAMDA
 */
router.get('/circuito-lamda/estado', async (req, res) => {
    try {
        const data = await nodosService.obtenerEstadoCircuitoOperativoLamda();
        res.json({ ok: true, ...data });
    } catch (error) {
        console.error('❌ [NodosRoutes] Error en GET /circuito-lamda/estado:', error);
        res.status(500).json({ ok: false, error: error.message });
    }
});

/**
 * POST /api/produccion/nodos/circuito-lamda/canastos/:canastoId/etapa
 * Permite avanzar o situar un Canasto en una etapa específica del circuito habitual de LAMDA
 */
router.post('/circuito-lamda/canastos/:canastoId/etapa', async (req, res) => {
    try {
        const etapa = req.body?.etapa || 'IMPRIMIR_CON_FALTANTES';
        const data = await nodosService.cambiarEtapaCircuitoLamdaCanasto(req.params.canastoId, etapa);
        res.json({ ok: true, ...data });
    } catch (error) {
        console.error('❌ [NodosRoutes] Error en POST /circuito-lamda/canastos/:canastoId/etapa:', error);
        res.status(400).json({ ok: false, error: error.message });
    }
});

module.exports = router;
