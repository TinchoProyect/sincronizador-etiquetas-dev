const fs = require('fs');

const func = `
window.imprimirCartelSector = (letra, nombre) => {
    const textoPrincipal = letra ? letra : nombre;
    const ventanaImpresion = window.open('', '_blank', 'width=800,height=1000');
    
    if (!ventanaImpresion) {
        Swal.fire({
            title: 'Bloqueado',
            text: 'Por favor, permite las ventanas emergentes (pop-ups) para generar el cartel A4.',
            icon: 'warning'
        });
        return;
    }

    const html = \`
        <!DOCTYPE html>
        <html lang="es">
        <head>
            <meta charset="UTF-8">
            <title>Cartel Sector \${textoPrincipal}</title>
            <style>
                @page {
                    size: A4 portrait;
                    margin: 1.5cm;
                }
                * {
                    box-sizing: border-box;
                }
                body, html {
                    margin: 0;
                    padding: 0;
                    width: 100vw;
                    height: 100vh;
                    display: flex;
                    justify-content: center;
                    align-items: center;
                    font-family: system-ui, -apple-system, sans-serif;
                    background: white;
                }
                .cartel-container {
                    text-align: center;
                    width: 95vw;
                    height: 95vh;
                    display: flex;
                    flex-direction: column;
                    justify-content: center;
                    align-items: center;
                    border: 15px solid #0f172a;
                    border-radius: 20px;
                    padding: 2cm;
                }
                .cartel-titulo {
                    font-size: 14rem;
                    font-weight: 900;
                    color: #0f172a;
                    margin: 0;
                    text-transform: uppercase;
                    line-height: 1;
                    word-break: break-word;
                }
                .cartel-subtitulo {
                    font-size: 4rem;
                    font-weight: 800;
                    color: #475569;
                    margin-top: 2rem;
                    text-transform: uppercase;
                }
                @media print {
                    body {
                        -webkit-print-color-adjust: exact;
                        print-color-adjust: exact;
                        background: white !important;
                    }
                    .cartel-container { height: 98vh; width: 98vw; border-width: 10px; }
                }
            </style>
        </head>
        <body>
            <div class="cartel-container">
                <h1 class="cartel-titulo">\${textoPrincipal}</h1>
                \${letra && nombre && letra !== nombre ? \`<h2 class="cartel-subtitulo">\${nombre}</h2>\` : ''}
            </div>
            <script>
                window.onload = function() {
                    setTimeout(() => { 
                        window.print(); 
                        setTimeout(() => { window.close(); }, 500);
                    }, 800);
                };
            </script>
        </body>
        </html>
    \`;

    ventanaImpresion.document.open();
    ventanaImpresion.document.write(html);
    ventanaImpresion.document.close();
};
`;

let content = fs.readFileSync('src/produccion/js/ingredientes.js', 'utf8');
if (!content.includes('imprimirCartelSector')) {
    fs.writeFileSync('src/produccion/js/ingredientes.js', content + func);
    console.log('Appended function.');
} else {
    console.log('Function already exists or pattern found.');
}
