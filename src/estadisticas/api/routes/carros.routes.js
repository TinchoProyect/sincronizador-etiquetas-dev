const { Router } = require('express');
const ctrl = require('../controllers/carros.controller');
const router = Router();

router.get('/carros/stats', ctrl.getStats);
router.get('/carros/por-periodo', ctrl.getPorPeriodo);
router.get('/carros/distribucion', ctrl.getDistribucion);
router.get('/carros/complejidad', ctrl.getComplejidad);

module.exports = router;
