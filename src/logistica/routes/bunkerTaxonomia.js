const express = require('express');
const router = express.Router();
const taxonomiaController = require('../controllers/bunkerTaxonomiaController');

console.log('🔍 [BUNKER-TAXONOMIA] Montando mapeos DDL en la API...');

router.get('/rubros', taxonomiaController.obtenerRubros);
router.post('/rubros', taxonomiaController.crearRubro);
router.get('/:rubroId/subrubros', taxonomiaController.obtenerSubrubros);
router.post('/:rubroId/subrubros', taxonomiaController.crearSubrubro);

router.get('/familias/:familiaId/categorias', taxonomiaController.obtenerCategoriasPorFamilia);
router.post('/familias/:familiaId/categorias', taxonomiaController.agregarCategoriaAFamilia);
router.delete('/familias/:familiaId/categorias/:categoria', taxonomiaController.eliminarCategoriaDeFamilia);
router.put('/familias/:familiaId/reordenar', taxonomiaController.reordenarCategoriasFamilia);
router.post('/familias', taxonomiaController.crearFamilia);
router.put('/familias/:familiaId', taxonomiaController.actualizarFamilia);
router.delete('/familias/:familiaId', taxonomiaController.eliminarFamilia);
router.get('/categorias-globales', taxonomiaController.obtenerCategoriasGlobales);
router.post('/categorias', taxonomiaController.crearCategoriaMaestra);
router.put('/categorias/renombrar', taxonomiaController.renombrarCategoria);
router.get('/auditoria-ejes-historicos', taxonomiaController.auditarEjesHistoricos);
router.post('/consolidar-eje-historico', taxonomiaController.consolidarEjeHistorico);

console.log('✅ [BUNKER-TAXONOMIA] Enlaces de Rubros/Subrubros/Categorías generados.');
module.exports = router;
