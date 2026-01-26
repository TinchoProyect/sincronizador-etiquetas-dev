const express = require('express');
const router = express.Router();
const mantenimientoCtrl = require('../controllers/mantenimiento');

// Middleware para logging
router.use((req, res, next) => {
    console.log(`🛠️ [MANTENIMIENTO API] ${req.method} ${req.url}`);
    next();
});

// Rutas GET (Visualización)
router.get('/stock', mantenimientoCtrl.getStockMantenimiento);
router.post('/conciliar/confirmar', mantenimientoCtrl.confirmarConciliacion);
router.post('/liberar', mantenimientoCtrl.liberarStock);
router.get('/historial', mantenimientoCtrl.getHistorialMantenimiento);
router.get('/conciliar', mantenimientoCtrl.conciliarDevolucion);

module.exports = router;
