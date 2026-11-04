const fs = require('fs');
const path = require('path');

function checkHtmlJsSyntax() {
    console.log('================================================================================');
    console.log('🔬 AUDITORÍA DE SINTAXIS JAVASCRIPT EN facturas.html');
    console.log('================================================================================\n');

    try {
        const filePath = path.resolve(__dirname, '../../facturacion/pages/facturas.html');
        const content = fs.readFileSync(filePath, 'utf8');

        // Extraer todo el código dentro de <script> ... </script>
        const scriptMatches = content.match(/<script>([\s\S]*?)<\/script>/gi);

        if (!scriptMatches) {
            console.error('❌ No se encontraron etiquetas <script> en facturas.html');
            process.exit(1);
        }

        let scriptCount = 0;
        for (const match of scriptMatches) {
            scriptCount++;
            const jsCode = match.replace(/<\/?script>/gi, '');

            const vm = require('vm');
            try {
                new vm.Script(jsCode, { filename: 'facturas_inline.js' });
                console.log(`✅ Bloque <script> #${scriptCount} analizado: Sintaxis JS 100% VÁLIDA sin errores.`);
            } catch (syntaxErr) {
                console.error(`❌ ERROR DE SINTAXIS EN BLOQUE <script> #${scriptCount}: ${syntaxErr.message}`);
                if (syntaxErr.stack) {
                    console.error(syntaxErr.stack.split('\n').slice(0, 5).join('\n'));
                }
                process.exit(1);
            }
        }

        process.exit(0);
    } catch (e) {
        console.error(e);
        process.exit(1);
    }
}

checkHtmlJsSyntax();
