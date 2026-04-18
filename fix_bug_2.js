const fs = require('fs');
const file = 'src/produccion/pages/ingredientes.html';
let content = fs.readFileSync(file, 'utf8');

const regexActivar = /function activarTabDeposito\([^)]*\)\s*\{[\s\S]*?tabActiva\s*=\s*'deposito';/;
const match = content.match(regexActivar);

if (match) {
    const rep = match[0] + `
            // Mostrar todos los acordeones
            document.querySelectorAll('.config-accordion').forEach(acc => {
                acc.style.display = '';
            });
            // Mostrar busqueda
            const searchContainer = document.querySelector('.filtro-nombre-container');
            if(searchContainer) searchContainer.style.display = '';
`;
    content = content.replace(match[0], rep);
    fs.writeFileSync(file, content, 'utf8');
    console.log('Fixed activarTabDeposito');
} else {
    console.log('No match for activarTabDeposito');
}
