/**
 * Rutas de Artículos
 * Endpoints para gestión de datos de artículos
 */

const express = require('express');
const router = express.Router();
const { actualizarPesoArticulo } = require('../controllers/articulosController');

console.log('🔍 [ARTICULOS-ROUTES] Configurando rutas de artículos...');

/**
 * @route PUT /api/logistica/articulos/:articulo_numero/peso
 * @desc Actualizar peso/kilos de un artículo
 * @access Privado (requiere autenticación)
 */
router.put('/:articulo_numero/peso', actualizarPesoArticulo);

console.log('✅ [ARTICULOS-ROUTES] Rutas de artículos configuradas');
console.log('📋 [ARTICULOS-ROUTES] Rutas disponibles:');
console.log('   - PUT /api/logistica/articulos/:articulo_numero/peso');

module.exports = router;
