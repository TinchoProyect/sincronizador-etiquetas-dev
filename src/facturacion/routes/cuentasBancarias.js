const express = require('express');
const router = express.Router();
const multer = require('multer');
const cuentasBancariasController = require('../controllers/cuentasBancariasController');

// Configuración de multer en memoria para recibir archivos
const upload = multer({
    storage: multer.memoryStorage(),
    limits: {
        fileSize: 10 * 1024 * 1024 // Limitar a 10MB
    }
});

// Rutas de Cuentas Bancarias y Cheques
router.get('/', cuentasBancariasController.listarCuentas);
router.get('/ia-status', cuentasBancariasController.verificarEstadoIA);
router.get('/bunker-clientes', cuentasBancariasController.listarClientesBunker);

// Rutas de Cheques (deben ir antes de /:id para evitar colisiones)
router.get('/cheques', cuentasBancariasController.listarCheques);
router.put('/cheques/:chequeId/vincular', cuentasBancariasController.vincularCheque);
router.put('/cheques/:chequeId/desvincular', cuentasBancariasController.desvincularCheque);

router.get('/:id/movimientos', cuentasBancariasController.listarMovimientos);
router.post('/:id/ingesta', upload.single('archivo'), cuentasBancariasController.ingestaExtracto);
router.put('/movimientos/:id/vincular-cliente', cuentasBancariasController.vincularCliente);

module.exports = router;
