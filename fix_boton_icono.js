const fs = require('fs');
const path = require('path');

console.log('🔧 Agregando icono al botón de ajuste...');

const filePath = path.join(__dirname, 'src/produccion/js/ingredientes.js');
let content = fs.readFileSync(filePath, 'utf8');

// Buscar el patrón del botón vacío y agregar el emoji
// Patrón: buscar botón con onclick que llama a abrirModalAjusteDesdeTabla y está vacío
const pattern = /(<button class="btn-icon"[^>]*onclick="window\.abrirModalAjusteDesdeTabla[^>]*>)\s*(\n\s*<\/button>)/g;

const replacement = '$1\n                          ✏️\n                      $2';

if (pattern.test(content)) {
    content = content.replace(pattern, replacement);
    fs.writeFileSync(filePath, content, 'utf8');
    console.log('✅ Icono agregado exitosamente!');
    console.log('📍 Archivo modificado:', filePath);
    console.log('🔄 Reinicia el servidor y recarga con Ctrl+F5');
} else {
    console.error('❌ No se encontró el patrón del botón');
    console.log('Intentando método alternativo...');
    
    // Método alternativo: buscar líneas específicas
    const lines = content.split('\n');
    let modified = false;
    
    for (let i = 0; i < lines.length; i++) {
        if (lines[i].includes('onclick="window.abrirModalAjusteDesdeTabla') && 
            lines[i].includes('btn-icon') &&
            i + 1 < lines.length &&
            lines[i + 1].trim() === '' &&
            i + 2 < lines.length &&
            lines[i + 2].includes('</button>')) {
            
            // Insertar el emoji en la línea vacía
            lines[i + 1] = '                          ✏️';
            modified = true;
            console.log('✅ Icono agregado en línea', i + 2);
        }
    }
    
    if (modified) {
        fs.writeFileSync(filePath, lines.join('\n'), 'utf8');
        console.log('✅ Icono agregado exitosamente con método alternativo!');
        console.log('📍 Archivo modificado:', filePath);
        console.log('🔄 Reinicia el servidor y recarga con Ctrl+F5');
    } else {
        console.error('❌ No se pudo agregar el icono automáticamente');
        process.exit(1);
    }
}
