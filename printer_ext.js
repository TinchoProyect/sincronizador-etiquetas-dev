const fs = require('fs');

// 1. Inyectar Lógica CSS
let cssFile = 'src/produccion/css/ingredientes-panel.css';
let css = fs.readFileSync(cssFile, 'utf8');

const printStyles = `\n
/* ============================================ */
/* MEDIA PRINT - CARTELERIA A4                  */
/* ============================================ */
@media print {
    body.modo-impresion-cartel .app-container,
    body.modo-impresion-cartel nav,
    body.modo-impresion-cartel .header,
    body.modo-impresion-cartel .swal2-container {
        display: none !important;
    }
    
    body.modo-impresion-cartel {
        background: white !important;
        margin: 0;
        padding: 0;
    }

    body.modo-impresion-cartel #cartel-print-container {
        display: flex !important;
        flex-direction: column;
        justify-content: center;
        align-items: center;
        width: 100vw;
        height: 100vh;
        margin: 0;
        padding: 0;
        position: fixed;
        top: 0;
        left: 0;
        background: white;
        z-index: 999999;
        text-align: center;
    }

    body.modo-impresion-cartel #cartel-print-container .cartel-letra {
        font-size: 45vh;
        font-weight: 900;
        line-height: 1;
        margin-bottom: 2vh;
        color: #000;
        font-family: Arial, Helvetica, sans-serif;
    }

    body.modo-impresion-cartel #cartel-print-container .cartel-nombre {
        font-size: 8vh;
        font-weight: bold;
        text-transform: uppercase;
        letter-spacing: 5px;
        color: #000;
        font-family: Arial, Helvetica, sans-serif;
    }

    @page { 
        size: A4 landscape; 
        margin: 0; 
    }
}
`;

if (!css.includes('modo-impresion-cartel')) {
    css += printStyles;
    fs.writeFileSync(cssFile, css, 'utf8');
}


// 2. Modificar JS (Header de Grupo y Lógica de Impresión)
let jsFile = 'src/produccion/js/ingredientes.js';
let js = fs.readFileSync(jsFile, 'utf8');

// The line generating the old header was:
// const tituloCompleto = titulo + (titulo !== nombreSector ? " - " + nombreSector : "");
// groupHeader.innerHTML = \`<h3>\${tituloCompleto}</h3> <div class="sector-divider"></div>\`;
// We extract that exact chunk
const oldHeaderRegex = /const tituloCompleto = titulo[\s\S]*?groupHeader\.innerHTML = \`<h3>\$\{tituloCompleto\}<\/h3> <div class="sector-divider"><\/div>\`;/;

const newHeaderHtml = `
            const nombreLimpio = nombreSector.replace(/'/g, "\\\\'");
            const letraRender = letra || '?';
            
            groupHeader.innerHTML = \`
                <div class="sector-header-flex" style="display: flex; justify-content: space-between; align-items: center; width: 100%; border-bottom: 2px solid #007bff; padding-bottom: 10px; margin-bottom: 15px;">
                    <div class="header-izq" style="font-size: 1.5rem; font-weight: 800; color: #2c3e50; min-width: 120px;">
                        Sector \${letraRender}
                    </div>
                    <div class="header-centro" style="font-size: 1.3rem; font-weight: 600; color: #475569; text-align: center; flex: 1;">
                        \${nombreSector}
                    </div>
                    <div class="header-der" style="min-width: 120px; text-align: right;">
                        <button class="btn-imprimir-cartel" style="background: #17a2b8; color: white; border: none; padding: 6px 14px; border-radius: 6px; font-weight: 600; cursor: pointer; display: inline-flex; align-items: center; gap: 6px; font-size: 0.95rem; box-shadow: 0 2px 4px rgba(0,0,0,0.1); transition: all 0.2s;" onclick="window.imprimirCartelSector('\${letraRender}', '\${nombreLimpio}')">
                            🖨️ Cartel A4
                        </button>
                    </div>
                </div>
            \`;
`;

if (oldHeaderRegex.test(js)) {
    js = js.replace(oldHeaderRegex, newHeaderHtml);
}


// JS Logic printing
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

if (!js.includes('window.imprimirCartelSector')) {
    js += printFunctionScript;
}

fs.writeFileSync(jsFile, js, 'utf8');
console.log('Script Cartel_A4 ejecutado exitosamente.');
