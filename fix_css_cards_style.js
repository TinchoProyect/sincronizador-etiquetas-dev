const fs = require('fs');
const FILE_PATH = 'src/produccion/css/ingredientes-panel.css';
let content = fs.readFileSync(FILE_PATH, 'utf8');

const oldTarjetaRegex = /\.tarjeta-ingrediente\s*\{[\s\S]*?box-shadow:\s*[^;]*;/;

// Reemplazamos la definición base para que limite fuerte (border-left acentuado y solid border)
const newTarjeta = `.tarjeta-ingrediente {
    background: #ffffff;
    backdrop-filter: none;
    border: 1px solid #d1d5db;
    border-left: 4px solid #475569; /* Gris oscuro para delimitación o corporativo */
    border-radius: 8px;
    padding: 16px 18px;
    box-shadow: 0 2px 4px rgba(0, 0, 0, 0.05);`;

content = content.replace(oldTarjetaRegex, newTarjeta);

// Agregamos el nth-child even justo después de transition: transform
const hoverRegex = /\.tarjeta-ingrediente:hover\s*\{/;
const nthChildRules = `
.tarjeta-ingrediente:nth-child(even) {
    background: #f8fafc;
}

.tarjeta-ingrediente:hover {`;

content = content.replace(hoverRegex, nthChildRules);

fs.writeFileSync(FILE_PATH, content, 'utf8');
console.log('Actualización visual de tarjetas exitosa.');
