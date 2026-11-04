const fs = require('fs');
const path = require('path');

function parseAstSyntax() {
    const filePath = path.resolve(__dirname, '../../facturacion/pages/facturas.html');
    const content = fs.readFileSync(filePath, 'utf8');
    const scriptMatches = content.match(/<script>([\s\S]*?)<\/script>/gi);
    const jsCode = scriptMatches[0].replace(/<\/?script>/gi, '');

    // Escribir a un archivo js temporal para pasárselo a node --check
    const tmpFile = path.resolve(__dirname, 'tmp_check.js');
    fs.writeFileSync(tmpFile, jsCode, 'utf8');

    const { execSync } = require('child_process');
    try {
        execSync(`node --check "${tmpFile}"`, { encoding: 'utf8' });
        console.log('✅ SINTAXIS JS 100% PERFECTA!');
    } catch (e) {
        console.log('❌ ERROR DE SINTAXIS DETECTADO POR NODE:');
        console.log(e.stderr || e.stdout || e.message);
    } finally {
        if (fs.existsSync(tmpFile)) fs.unlinkSync(tmpFile);
    }
}

parseAstSyntax();
