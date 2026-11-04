const express = require('express');
const router = express.Router();
const diccionarioController = require('../controllers/bunkerDiccionarioController');

console.log('🔍 [BUNKER-DICCIONARIO] Configurando rutas ABM separadas...');

router.get('/', diccionarioController.obtenerDiccionario);
router.post('/', diccionarioController.crearTerminoEnCategoria);
router.post('/crear-termino-en-categoria', diccionarioController.crearTerminoEnCategoria);
router.get('/familias', diccionarioController.obtenerFamilias);
router.get('/principales', diccionarioController.obtenerArticulosPrincipales);
router.get('/principales/buscar', diccionarioController.buscarArticulosPrincipalesDiccionario);
router.post('/articulos-principales', diccionarioController.crearArticuloPrincipal);
router.delete('/articulos-principales/desvincular', diccionarioController.desvincularArticuloPrincipal);
router.post('/jerarquia/desvincular', diccionarioController.desvincularTerminoJerarquia);
router.get('/jerarquia/:terminoPrincipal', diccionarioController.obtenerJerarquiaPorPrincipal);
router.put('/:id', diccionarioController.actualizarTermino);
router.put('/:id/marcado', diccionarioController.actualizarMarcadoRevision);
router.get('/impacto/:id', diccionarioController.obtenerImpactoEliminacion);
router.delete('/forzado/:id', diccionarioController.eliminarTerminoForzado);
router.delete('/:id', diccionarioController.eliminarTermino);

console.log('✅ [BUNKER-DICCIONARIO] ABM routes set successfully');
module.exports = router;
