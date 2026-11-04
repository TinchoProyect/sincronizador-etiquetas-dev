'use strict';

const express = require('express');
const router = express.Router();
const FotosLotesService = require('../services/fotosLotesService');

console.log('📸 [B2B-FOTOS-LOTES] Configurando rutas de Inspección Visual de Partidas...');

/**
 * GET /api/logistica/b2b-fotos-lotes/articulos
 * Lista todos los artículos para el módulo móvil de Fotos en Depósito,
 * incluyendo indicador de Línea 1, stock físico, último lote y fracciones derivadas de Línea 2.
 */
router.get('/articulos', async (req, res) => {
    try {
        const db = req.db || req.app.get('db');
        await FotosLotesService.evaluarCaducidadAutomaticaLotes(db);
        const articulos = await FotosLotesService.listarArticulosDeposito(db);
        res.json({
            success: true,
            data: articulos
        });
    } catch (error) {
        console.error('❌ [B2B-FOTOS-LOTES] Error en GET /articulos:', error);
        res.status(500).json({
            success: false,
            error: 'No se pudo obtener el listado de artículos de depósito.',
            message: error.message
        });
    }
});

/**
 * GET /api/logistica/b2b-fotos-lotes/mapa
 * Retorna el diccionario compacto { [articulo_id]: infoFotosLote } para uso en Cotizador Móvil / Preventa.
 */
router.get('/mapa', async (req, res) => {
    try {
        const db = req.db || req.app.get('db');
        const mapa = await FotosLotesService.construirMapaImagenesCatalogo(db);
        res.json({
            success: true,
            data: mapa
        });
    } catch (error) {
        console.error('❌ [B2B-FOTOS-LOTES] Error en GET /mapa:', error);
        res.status(500).json({
            success: false,
            error: 'No se pudo construir el mapa de fotos de partidas.',
            message: error.message
        });
    }
});

/**
 * POST /api/logistica/b2b-fotos-lotes/guardar
 * Guarda o actualiza las fotos de una partida en depósito y las publica en tiempo real en el Portal B2B.
 */
router.post('/guardar', async (req, res) => {
    try {
        const db = req.db || req.app.get('db');
        const {
            articulo_id,
            nuevas_imagenes,
            imagenes_nuevas,
            imagenes_conservar_ids,
            imagenes_existentes,
            reemplazar_todas,
            reemplazar,
            lote_codigo_escaneado,
            observacion_tecnica,
            extender_a_derivados,
            derivados_seleccionados,
            es_permanente,
            usuario
        } = req.body || {};

        if (!articulo_id) {
            return res.status(400).json({
                success: false,
                error: 'El código del artículo (articulo_id) es obligatorio.'
            });
        }

        const registro = await FotosLotesService.guardarFotosPartida(db, {
            articulo_id,
            nuevas_imagenes: Array.isArray(nuevas_imagenes) ? nuevas_imagenes : null,
            imagenes_nuevas: Array.isArray(imagenes_nuevas) ? imagenes_nuevas : null,
            imagenes_conservar_ids: Array.isArray(imagenes_conservar_ids) ? imagenes_conservar_ids : null,
            imagenes_existentes: Array.isArray(imagenes_existentes) ? imagenes_existentes : null,
            reemplazar_todas: Boolean(reemplazar_todas),
            reemplazar: Boolean(reemplazar),
            lote_codigo_escaneado: lote_codigo_escaneado || null,
            observacion_tecnica: observacion_tecnica || '',
            extender_a_derivados: Boolean(extender_a_derivados),
            derivados_seleccionados: Array.isArray(derivados_seleccionados) ? derivados_seleccionados : null,
            es_permanente: Boolean(es_permanente),
            usuario: usuario || 'Depósito Móvil'
        });

        res.json({
            success: true,
            message: 'Fotos de la partida publicadas en el Portal B2B.',
            data: registro
        });
    } catch (error) {
        console.error('❌ [B2B-FOTOS-LOTES] Error en POST /guardar:', error);
        res.status(500).json({
            success: false,
            error: 'Error al guardar y publicar las fotos de la partida.',
            message: error.message
        });
    }
});

/**
 * DELETE /api/logistica/b2b-fotos-lotes/:articuloId
 * Elimina todas las fotos activas de una partida y limpia el Storage.
 */
router.delete('/:articuloId', async (req, res) => {
    try {
        const db = req.db || req.app.get('db');
        const articuloId = decodeURIComponent(req.params.articuloId || '').trim();
        if (!articuloId) {
            return res.status(400).json({ success: false, error: 'Artículo no especificado.' });
        }

        await FotosLotesService.eliminarFotosPartida(db, articuloId, 'BAJA_MANUAL_OPERARIO');
        res.json({
            success: true,
            message: 'Fotos de la partida dadas de baja correctamente.'
        });
    } catch (error) {
        console.error('❌ [B2B-FOTOS-LOTES] Error en DELETE /:articuloId:', error);
        res.status(500).json({
            success: false,
            error: 'Error al eliminar las fotos de la partida.',
            message: error.message
        });
    }
});

module.exports = router;
