const express = require('express');
const router = express.Router();

const carrosCtrl = require('../controllers/carros.controller'); // 👈 import correcto

// callback válido (carrosCtrl.list existe porque lo exportamos arriba)
router.get('/', carrosCtrl.list);

module.exports = router;

