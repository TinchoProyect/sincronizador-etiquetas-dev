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
 * Crea un nuevo Nodo Barrial (con vínculo automático a bunker_clientes y factura_cuentas_corrientes)
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
 * Cotiza en Pizarra una fracción (nueva o desde propuesta), la aprueba en el catálogo aislado
 * de Nodos y propaga el Precio Base Nodo a las ofertas de los gestores.
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

module.exports = router;
