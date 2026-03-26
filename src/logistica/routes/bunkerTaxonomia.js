const express = require('express');
const router = express.Router();
const taxonomiaController = require('../controllers/bunkerTaxonomiaController');

console.log('🔍 [BUNKER-TAXONOMIA] Montando mapeos DDL en la API...');

router.get('/rubros', taxonomiaController.obtenerRubros);
router.post('/rubros', taxonomiaController.crearRubro);
router.get('/:rubroId/subrubros', taxonomiaController.obtenerSubrubros);
router.post('/:rubroId/subrubros', taxonomiaController.crearSubrubro);

console.log('✅ [BUNKER-TAXONOMIA] Enlaces de Rubros/Subrubros generados.');
module.exports = router;
