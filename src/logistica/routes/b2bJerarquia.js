const express = require('express');
const router = express.Router();
const jerarquiaController = require('../controllers/b2bJerarquiaController');

// Obtener árbol de jerarquía y configuraciones
router.get('/', jerarquiaController.obtenerJerarquiaB2B);

// Guardar configuración de Nivel 3 y Nivel 4 para un artículo principal
router.post('/', jerarquiaController.guardarJerarquiaB2B);

// Obtener y guardar configuración de modalidad de IVA por lista de precios
router.get('/listas-iva', jerarquiaController.obtenerListasConfigIva);
router.post('/listas-iva', jerarquiaController.guardarListaConfigIva);

// Disparar sincronización manual directa de catálogo B2B
router.post('/sincronizar', jerarquiaController.sincronizarCatalogoB2B);

module.exports = router;
