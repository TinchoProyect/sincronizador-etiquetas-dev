'use strict';

const express = require('express');
const router = express.Router();

const {
    obtenerSolicitudPublica,
    geocodificarPublico,
    geocodificarInversoPublico,
    confirmarSolicitudPublica
} = require('../controllers/domicilioSolicitudesController');

router.get('/:token', obtenerSolicitudPublica);
router.get('/:token/geocodificar', geocodificarPublico);
router.get('/:token/geocodificar-inverso', geocodificarInversoPublico);
router.post('/:token/confirmar', confirmarSolicitudPublica);

module.exports = router;
