const fs = require('fs');
const file = 'src/produccion/css/ingredientes-panel.css';
let content = fs.readFileSync(file, 'utf8');

// 1. Reducir font-size sidebar
content = content.replace('.accordion-header {', '.accordion-header {\n    font-size: 0.85em;');
content = content.replace('.config-body {', '.config-body {\n    font-size: 0.85em;');
content = content.replace('.sector-item {\n    padding: 10px 12px;', '.sector-item {\n    padding: 6px 10px;\n    font-size: 0.9em;');

// 2. Mejorar tarjeta hover y sombra
const oldTarjeta = `.tarjeta-ingrediente {
    background: rgba(255, 255, 255, 0.7);
    backdrop-filter: blur(10px);
    -webkit-backdrop-filter: blur(10px);
    border: 1px solid rgba(255, 255, 255, 0.6);
    border-radius: 12px;
    padding: 18px;
    box-shadow: 0 8px 32px 0 rgba(31, 38, 135, 0.05);`;

const newTarjeta = `.tarjeta-ingrediente {
    background: rgba(255, 255, 255, 0.85);
    backdrop-filter: blur(10px);
    -webkit-backdrop-filter: blur(10px);
    border: 1px solid rgba(0, 0, 0, 0.12);
    border-radius: 12px;
    padding: 18px;
    box-shadow: 0 4px 14px rgba(0, 0, 0, 0.08);`;

if(content.includes(oldTarjeta)) {
    content = content.replace(oldTarjeta, newTarjeta);
} else {
    // regex fallback
    console.log("No se pudo reemplazar oldTarjeta por coincidencia exacta, intentando fallback");
}

// 3. Mejorar btn-imprimir-rapido
const oldImprimir = `.btn-accion-icono.btn-imprimir-rapido {
    background: rgba(0, 123, 255, 0.1);
    color: #0056b3;
}
.btn-accion-icono.btn-imprimir-rapido:hover {
    background: rgba(0, 123, 255, 0.2);
}`;

const newImprimir = `.btn-accion-icono.btn-imprimir-rapido {
    background: linear-gradient(135deg, #007bff, #0056b3);
    color: white;
    font-size: 1.05rem;
    padding: 8px 16px;
    box-shadow: 0 4px 10px rgba(0, 123, 255, 0.3);
    border-radius: 8px;
}
.btn-accion-icono.btn-imprimir-rapido:hover {
    background: linear-gradient(135deg, #0056b3, #004085);
    box-shadow: 0 6px 14px rgba(0, 123, 255, 0.4);
    transform: translateY(-1px);
}`;

if(content.includes(oldImprimir)) {
    content = content.replace(oldImprimir, newImprimir);
}

fs.writeFileSync(file, content, 'utf8');
console.log('CSS updated');
