const fs = require('fs');
const FILE_PATH = 'src/produccion/js/ingredientes.js';
let content = fs.readFileSync(FILE_PATH, 'utf8');

// The code block for creating buttons:
// btn.textContent = sector.nombre;
// We replace it to: 
// btn.textContent = (typeof window.obtenerLetraSector === "function" ? window.obtenerLetraSector(sector.id) : null) || sector.nombre.charAt(0).toUpperCase();

const regex = /btn\.textContent\s*=\s*sector\.nombre;/g;
content = content.replace(regex, `// Obtener solo la letra del sector en lugar del nombre completo
            const letra = window.obtenerLetraSector ? window.obtenerLetraSector(sector.id) : sector.nombre.charAt(0).toUpperCase();
            btn.textContent = letra || sector.nombre;`);

fs.writeFileSync(FILE_PATH, content, 'utf8');
console.log('Se reemplazó la lógica de renderización del botón de sector en ingredientes.js');
