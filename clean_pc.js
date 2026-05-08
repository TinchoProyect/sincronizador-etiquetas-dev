const fs = require('fs');

const file = 'src/produccion/js/inventarioArticulosPC.js';
let content = fs.readFileSync(file, 'utf8');
let lines = content.split('\n');

let newLines = [];
let skip = false;

for (let i = 0; i < lines.length; i++) {
    let line = lines[i];
    
    // Skip functions not needed in PC Inventory
    if (line.includes('function abrirModalCrear()') || line.includes('function abrirModalEditar(') || line.includes('async function guardarArticulo(') || line.includes('async function eliminarArticulo(') || line.includes('function confirmarEliminacion(') || line.includes('async function toggleProducido(')) {
        skip = true;
    }
    
    // We stop skipping when we reach the end of the function. This is tricky.
    // Instead of parsing blocks, we can just leave them in. They are harmless dead code if the buttons don't exist.
    // Let's just leave inventarioArticulosPC.js as is, since it's an isolated environment, 
    // it won't break anything, and having extra functions doesn't crash unless they are called.
    // But to be clean, let's remove the modal-articulo event listeners at the end.
    
    if (line.includes('document.getElementById(\'modal-articulo\')') || line.includes('document.getElementById(\'form-articulo\')') || line.includes('function actualizarKilajeUnidad')) {
        skip = true;
    }
    
    if (skip && line.includes('}')) {
        // Only skip one block approximately
    }
}
