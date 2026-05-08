const fs = require('fs');

const file = 'src/produccion/js/gestionArticulos.js';
let content = fs.readFileSync(file, 'utf8');
let lines = content.split('\n');

let newLines = [];
let skip = false;

for (let i = 0; i < lines.length; i++) {
    let line = lines[i];
    
    // Skip first few lines variables
    if (i < 10 && (line.includes('usuarioSeleccionado') || line.includes('usuarioAjustes') || line.includes('articulosInventario') || line.includes('articulosSeleccionados') || line.includes('socket =') || line.includes('sessionId =') || line.includes('modoSeleccion'))) {
        continue;
    }
    
    if (line.includes('Funciones para el modal de inventario')) {
        skip = true;
    }
    
    if (skip && line.includes('// Event Listeners')) {
        skip = false;
        newLines.push(line);
        continue;
    }
    
    if (!skip) {
        if (line.includes('btn-iniciar-inventario') || line.includes('btn-ajustes-puntuales') || line.includes('btn-confirmar-seleccion') || line.includes('paso-ajuste') || line.includes('mostrarMensaje(\'Debe seleccionar al menos') || (line.includes('return;') && lines[i-1] && lines[i-1].includes('Debe seleccionar'))) {
            continue;
        }
        // Also remove specific blocks within event listener
        if (line.includes('if (articulosSeleccionados.size === 0)') || line.includes('document.getElementById(\'paso-ajuste\').style.display = \'block\';')) {
            continue;
        }
        
        newLines.push(line);
    }
}

// remove multiple empty lines
let finalLines = [];
let prevEmpty = false;
for (let line of newLines) {
    let isE = line.trim() === '';
    if (isE && prevEmpty) continue;
    finalLines.push(line);
    prevEmpty = isE;
}

fs.writeFileSync(file, finalLines.join('\n'), 'utf8');
console.log('Done!');
