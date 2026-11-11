const express = require('express');
const router = express.Router();
const clientesBunkerController = require('../controllers/clientesBunkerController');

console.log('🔍 [CLIENTES-BUNKER-ROUTES] Preparando rutas de la entidad...');

// Obtener todos los clientes (con filtro opcional de búsqueda '?search=...')
router.get('/', clientesBunkerController.obtenerTodos);

// Sugerir un código legacy (Lomasoft ID) único de 3 dígitos disponible
router.get('/sugerir-legacy', clientesBunkerController.sugerirLegacy);

// Subcuentas y operatoria contable de Vecinos de Nodos Barriales (antes de '/:id')
router.get('/nodos-vecinos/:vecinoId/subcuenta', clientesBunkerController.obtenerSubcuentaVecinoNodo);
router.post('/nodos-pedidos/:pedidoId/conciliar-pago', clientesBunkerController.conciliarPagoPedidoVecinoNodo);
router.post('/nodos-pedidos/:pedidoId/anular', clientesBunkerController.anularPedidoVecinoNodo);
router.post('/nodos-pedidos/:pedidoId/nota-credito', clientesBunkerController.aplicarNotaCreditoPedidoVecinoNodo);

// Obtener estructura en Árbol de un Nodo Barrial (cuadratura en vivo + clientes vecinos)
router.get('/:id/arbol-nodo', clientesBunkerController.obtenerArbolNodo);

// Obtener historial de artículos comprados/facturados por cliente
router.get('/:id/articulos-comprados', clientesBunkerController.obtenerArticulosComprados);

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
