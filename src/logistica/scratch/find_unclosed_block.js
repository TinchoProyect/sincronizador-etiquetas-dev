const fs = require('fs');
const path = require('path');
const vm = require('vm');

function findUnclosedBlock() {
    const filePath = path.resolve(__dirname, '../../facturacion/pages/facturas.html');
    const content = fs.readFileSync(filePath, 'utf8');
    const scriptMatches = content.match(/<script>([\s\S]*?)<\/script>/gi);
    const jsCode = scriptMatches[0].replace(/<\/?script>/gi, '');

    const lines = jsCode.split('\n');

    for (let i = 1; i <= lines.length; i++) {
        const chunk = lines.slice(0, i).join('\n');
        try {
            new vm.Script(chunk);
            console.log(`Línea ${i}: VÁLIDA HASTA AQUÍ (Cierre completo)`);
        } catch (e) {
            if (!e.message.includes('Unexpected end of input') && !e.message.includes('missing )') && !e.message.includes('Unterminated template')) {
                console.log(`Línea ${i}: ❌ ERROR REAL -> ${e.message}`);
                console.log(`Código en línea ${i}:`, lines[i - 1]);
                break;
            }
        }
    }
}

findUnclosedBlock();
