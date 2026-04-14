const fs = require('fs');
const m = fs.readFileSync('src/logistica/public/mobile/js/controllers/RutaActivaUI.js','utf8');

const toggleStart = m.indexOf('window.toggleEstadoRuta = async');
const toggleSlice = m.slice(toggleStart, toggleStart + 600);
console.log('toggleEstadoRuta definition slice:\n', toggleSlice);
