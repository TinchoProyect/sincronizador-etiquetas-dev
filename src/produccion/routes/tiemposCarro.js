// routes/tiemposCarro.js
const express = require('express');
const { iniciarEtapaCarro, finalizarEtapaCarro } = require('../controllers/tiemposCarro');
const router = express.Router();

const tiemposCtrl = require('../controllers/tiemposCarro'); // nuevo controlador- temporizador- Mari
//Temporizacion -Mari
router.post('/carro/:carroId/articulo/:numero/iniciar', tiemposCtrl.iniciarTemporizadorArticulo);
router.post('/carro/:carroId/articulo/:numero/finalizar', tiemposCtrl.finalizarTemporizadorArticulo);
router.get('/carro/:carroId/tiempo-total', tiemposCtrl.obtenerTiempoTotalCarro);

router.post('/carro/:carroId/etapa/:etapa/iniciar', iniciarEtapaCarro);   // etapa ∈ {1,2,3}
router.post('/carro/:carroId/etapa/:etapa/finalizar', finalizarEtapaCarro);

router.get('/carro/:carroId/etapas/estado', tiemposCtrl.estadoEtapasCarro);

module.exports = router;
