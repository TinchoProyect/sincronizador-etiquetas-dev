const express = require('express');
const router = express.Router();
const diccionarioController = require('../controllers/bunkerDiccionarioController');

console.log('🔍 [BUNKER-DICCIONARIO] Configurando rutas ABM separadas...');

router.get('/', diccionarioController.obtenerDiccionario);
router.put('/:id', diccionarioController.actualizarTermino);
router.delete('/:id', diccionarioController.eliminarTermino);

console.log('✅ [BUNKER-DICCIONARIO] ABM routes set successfully');
module.exports = router;
