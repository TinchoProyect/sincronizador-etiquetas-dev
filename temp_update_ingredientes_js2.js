const fs = require('fs');
const file = 'c:\\Users\\Martin\\Documents\\sincronizador-etiquetas - copia\\src\\produccion\\js\\ingredientes.js';
let content = fs.readFileSync(file, 'utf8');

const targetStr = `const sectorValue = document.getElementById('sector').value;`;
const insertStr = `const sectorValue = document.getElementById('sector').value;

        const catIdValue = document.getElementById('categoria-id').value;
        if (!catIdValue) {
            alert('Por favor, seleccione o guarde la nueva categoría en el formulario antes de continuar.');
            return;
        }`;

content = content.replace(targetStr, insertStr);
fs.writeFileSync(file, content, 'utf8');
console.log('Actualizado JS');
