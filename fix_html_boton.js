const fs = require('fs');
const path = require('path');

console.log('🔧 Agregando icono al botón en ingredientes.html...');

const filePath = path.join(__dirname, 'src/produccion/pages/ingredientes.html');
let content = fs.readFileSync(filePath, 'utf8');

// Buscar el botón vacío en la función renderizarTablaUsuario
const lines = content.split('\n');
let modified = false;

for (let i = 0; i < lines.length; i++) {
    // Buscar la línea con el botón que llama a abrirModalAjusteDesdeTabla
    if (lines[i].includes('onclick="window.abrirModalAjusteDesdeTabla') && 
        lines[i].includes('btn-icon') &&
        lines[i].includes('Ajuste Rápido')) {
        
        // Verificar si las siguientes líneas están vacías hasta el </button>
        let j = i + 1;
        while (j < lines.length && !lines[j].includes('</button>')) {
            if (lines[j].trim() === '') {
                // Encontramos la línea vacía, agregar el icono
                lines[j] = '                              ✏️';
                modified = true;
                console.log('✅ Icono agregado en línea', j + 1);
                break;
            }
            j++;
        }
    }
}

if (modified) {
    fs.writeFileSync(filePath, lines.join('\n'), 'utf8');
    console.log('✅ HTML modificado exitosamente!');
    console.log('📍 Archivo:', filePath);
    console.log('🔄 Recarga la página con Ctrl+Shift+R');
} else {
    console.error('❌ No se encontró el botón vacío en el HTML');
    console.log('Buscando patrón alternativo...');
    
    // Método alternativo: buscar directamente el patrón
    const pattern = /(onclick="window\.abrirModalAjusteDesdeTabla[^>]*>\s*\n\s*\n)(\s*<\/button>)/;
    
    if (pattern.test(content)) {
        content = content.replace(pattern, '$1                              ✏️\n$2');
        fs.writeFileSync(filePath, content, 'utf8');
        console.log('✅ HTML modificado con método alternativo!');
        console.log('📍 Archivo:', filePath);
        console.log('🔄 Recarga la página con Ctrl+Shift+R');
    } else {
        console.error('❌ No se pudo modificar el HTML automáticamente');
        process.exit(1);
    }
}
