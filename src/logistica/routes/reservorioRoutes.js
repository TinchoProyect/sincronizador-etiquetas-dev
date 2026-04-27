const express = require('express');
const router = express.Router();
const ReservorioController = require('../controllers/reservorioController');
const multer = require('multer');
const path = require('path');
const fs = require('fs');

// Configuración de multer temporal
const uploadDir = path.join(__dirname, '..', 'temp');
if (!fs.existsSync(uploadDir)) {
    fs.mkdirSync(uploadDir, { recursive: true });
}

const storage = multer.diskStorage({
    destination: function (req, file, cb) {
        cb(null, uploadDir)
    },
    filename: function (req, file, cb) {
        cb(null, 'reservorio_' + Date.now() + '.json')
    }
});

const upload = multer({ storage: storage });

// Rutas de Ingesta
router.post('/ingestar', upload.single('archivo_timeline'), ReservorioController.ingestarJSON);

// Rutas de Lectura Cronológica
router.get('/consultar', ReservorioController.consultarTrazado);

// Rutas de Mantenimiento
router.delete('/vaciar', ReservorioController.vaciarReservorio);

module.exports = router;
