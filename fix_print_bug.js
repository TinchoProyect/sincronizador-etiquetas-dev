const fs = require('fs');
let jsFile = 'src/produccion/js/ingredientes.js';
let js = fs.readFileSync(jsFile, 'utf8');

const printFunctionScript = `
// ============================================
// FUNCION IMPRESION CARTELERIA A4
// ============================================
window.imprimirCartelSector = function(letra, nombre) {
    let container = document.getElementById('cartel-print-container');
    if (!container) {
        container = document.createElement('div');
        container.id = 'cartel-print-container';
        document.body.appendChild(container);
    }
    
    container.style.display = 'none'; // oculto normalmente
    container.innerHTML = \`
        <div class="cartel-letra">\${letra}</div>
        <div class="cartel-nombre">\${nombre}</div>
    \`;
    
    document.body.classList.add('modo-impresion-cartel');
    
    // Un pequeño timeout asegura que el render del CSS se aplique antes de lanzar spooler
    setTimeout(() => {
        window.print();
        setTimeout(() => {
            document.body.classList.remove('modo-impresion-cartel');
        }, 800);
    }, 150);
};
`;

if (!js.includes('window.imprimirCartelSector = function(')) {
    js += printFunctionScript;
    fs.writeFileSync(jsFile, js, 'utf8');
}
