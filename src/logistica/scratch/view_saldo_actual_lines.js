const fs = require('fs');
const path = require('path');

const files = [
    'src/facturacion/services/cuentaCorrienteService.js',
    'src/facturacion/services/cuentasBancariasService.js',
    'src/logistica/controllers/cuentaCorrienteController.js',
    'src/logistica/services/cuentaCorrienteService.js',
    'src/produccion/controllers/finalizarProduccion.js'
];

for (const relPath of files) {
    const fullPath = path.join(__dirname, '..', '..', '..', relPath);
    if (!fs.existsSync(fullPath)) {
        console.log('File not found:', fullPath);
        continue;
    }
    const lines = fs.readFileSync(fullPath, 'utf8').split('\n');
    console.log(`=== ${relPath} ===`);
    lines.forEach((line, idx) => {
        if (line.toLowerCase().includes('saldo actual') || line.toLowerCase().includes('saldo_actual')) {
            console.log(`${idx + 1}: ${line.trim()}`);
            // print 2 lines before and after
            for (let i = Math.max(0, idx - 3); i < Math.min(lines.length, idx + 4); i++) {
                if (i !== idx) console.log(`   [${i + 1}] ${lines[i].trim()}`);
            }
        }
    });
}
