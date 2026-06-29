const express = require('express');
const router = express.Router();
const clientesBunkerController = require('../controllers/clientesBunkerController');

console.log('🔍 [CLIENTES-BUNKER-ROUTES] Preparando rutas de la entidad...');

// Obtener todos los clientes (con filtro opcional de búsqueda '?search=...')
router.get('/', clientesBunkerController.obtenerTodos);

// Sugerir un código legacy (Lomasoft ID) único de 3 dígitos disponible
router.get('/sugerir-legacy', clientesBunkerController.sugerirLegacy);

// Obtener un cliente específico por ID
router.get('/:id', clientesBunkerController.obtenerPorId);

// Crear un nuevo cliente
router.post('/', clientesBunkerController.crear);

// Consultar datos de padrón de contribuyente en ARCA (ex-AFIP)
router.post('/consultar-arca', clientesBunkerController.consultarArca);

// Actualizar un cliente existente
router.put('/:id', clientesBunkerController.actualizar);

// Actualizar solo contactos de WhatsApp de un cliente (acoplamiento flexible)
router.patch('/:id/whatsapp-contacts', clientesBunkerController.actualizarContactosWhatsapp);

// Actualizar las listas de precios Bunker asociadas a un cliente
router.put('/:id/listas', clientesBunkerController.actualizarListas);

// Eliminar un cliente
router.delete('/:id', clientesBunkerController.eliminar);

console.log('✅ [CLIENTES-BUNKER-ROUTES] Rutas de Clientes Búnker expuestas.');
module.exports = router;
