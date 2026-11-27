'use strict';

const express = require('express');
const router = express.Router();
const db = require('../config/database');
const costosGrafoService = require('../services/costosGrafoService');

function normalizarPayloadCascada(body = {}) {
    const src = (body && typeof body === 'object') ? body : {};
    const disparador = (src.disparador && typeof src.disparador === 'object')
        ? { ...src.disparador }
        : {
            tipo: src.tipo || 'FULL_GRAPH',
            ingrediente_id: src.ingrediente_id,
            nuevo_costo_patron: src.nuevo_costo_patron,
            articulo_id: src.articulo_id,
            nuevo_costo_base: src.nuevo_costo_base,
            ingrediente_calidad_id: src.ingrediente_calidad_id,
            usar_vinculo_primario: src.usar_vinculo_primario,
            relacion_id: src.relacion_id,
            ingrediente_espejo_id: src.ingrediente_espejo_id,
            merma_default_pct: src.merma_default_pct,
            tarifa_maquila_default: src.tarifa_maquila_default,
            unidades_por_tanda_default: src.unidades_por_tanda_default
        };

    const filtrosSrc = (src.filtros && typeof src.filtros === 'object') ? src.filtros : src;
    const opciones = {
        ldns_seleccionadas: Array.isArray(filtrosSrc.ldns_seleccionadas) ? filtrosSrc.ldns_seleccionadas : undefined,
        listas_seleccionadas: Array.isArray(filtrosSrc.listas_seleccionadas) ? filtrosSrc.listas_seleccionadas : undefined,
        ninguna_lista_b2b: Boolean(filtrosSrc.ninguna_lista_b2b),
        articulos_excluidos: Array.isArray(filtrosSrc.articulos_excluidos) ? filtrosSrc.articulos_excluidos : undefined,
        min_diff_precio: filtrosSrc.min_diff_precio !== undefined && filtrosSrc.min_diff_precio !== null
            ? Number(filtrosSrc.min_diff_precio)
            : undefined,
        incluir_canal_nodos: filtrosSrc.incluir_canal_nodos !== undefined ? Boolean(filtrosSrc.incluir_canal_nodos) : true,
        incluir_manuales_ids: Array.isArray(filtrosSrc.incluir_manuales_ids) ? filtrosSrc.incluir_manuales_ids : undefined,
        sobrescribir_manuales: Boolean(filtrosSrc.sobrescribir_manuales),
        usuario: src.usuario ? String(src.usuario).trim().slice(0, 80) : 'OPERADOR_PIZARRA',
        origen_cambio: src.origen_cambio ? String(src.origen_cambio).trim().slice(0, 60) : 'CASCADA_COSTOS'
    };

    return { disparador, opciones };
}

/**
 * GET /api/produccion/costos-grafo/radar
 * Auditoría 100% solo lectura de desfases aguas arriba vs. precios publicados en LDN 1..8, Listas B2B y Canal Nodos.
 */
router.get('/radar', async (_req, res) => {
    try {
        const data = await costosGrafoService.obtenerRadarCostos(db, { incluirCatalogoSelectores: true });
        return res.json(data);
    } catch (err) {
        console.error('❌ [CostosGrafoRoutes] Error en GET /radar:', err);
        return res.status(err.statusCode || 500).json({ ok: false, error: err.message });
    }
});

/**
 * POST /api/produccion/costos-grafo/simular
 * Simulación determinista en modo sombra (0 escrituras en DB).
 */
router.post('/simular', async (req, res) => {
    try {
        const { disparador, opciones } = normalizarPayloadCascada(req.body);
        const sim = await costosGrafoService.simularCascada(db, disparador, opciones);
        return res.json(sim);
    } catch (err) {
        console.error('❌ [CostosGrafoRoutes] Error en POST /simular:', err);
        return res.status(err.statusCode || 500).json({ ok: false, error: err.message, detalle: err.detalle || null });
    }
});

/**
 * POST /api/produccion/costos-grafo/aplicar
 * Aplica atómicamente la cascada seleccionada, registra historial/notificaciones B2B y actualiza Canal Nodos.
 */
router.post('/aplicar', async (req, res) => {
    try {
        const { disparador, opciones } = normalizarPayloadCascada(req.body);
        const resApl = await costosGrafoService.aplicarCascada(db, disparador, opciones);
        return res.json(resApl);
    } catch (err) {
        console.error('❌ [CostosGrafoRoutes] Error en POST /aplicar:', err);
        return res.status(err.statusCode || 500).json({ ok: false, error: err.message, detalle: err.detalle || null });
    }
});

module.exports = router;
