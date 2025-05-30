/**
 * Rutas para gestionar mixes (ingredientes compuestos).
 * Montadas desde production.js con prefijo "/mixes"
 */

const express = require('express');
const router = express.Router();
const {
  crearMix,
  obtenerComposicionDeMix,
  agregarIngredienteAlMix,
  editarIngredienteDelMix,
  eliminarIngredienteDelMix,
} = require('../controllers/mixes');

// POST /api/produccion/mixes
router.post('/', crearMix);

// GET /api/produccion/mixes/:mix_id/ingredientes
router.get('/:mix_id/ingredientes', obtenerComposicionDeMix);

// POST /api/produccion/mixes/:mix_id/ingredientes
router.post('/:mix_id/ingredientes', agregarIngredienteAlMix);

// PUT /api/produccion/mixes/:mix_id/ingredientes/:ingrediente_id
router.put('/:mix_id/ingredientes/:ingrediente_id', editarIngredienteDelMix);

// DELETE /api/produccion/mixes/:mix_id/ingredientes/:ingrediente_id
router.delete('/:mix_id/ingredientes/:ingrediente_id', eliminarIngredienteDelMix);

module.exports = router;
