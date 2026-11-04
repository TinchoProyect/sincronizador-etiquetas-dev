const path = require('path');
const { execSync } = require('child_process');

function checkCuentasBancariasJs() {
    const file = path.resolve(__dirname, '../../facturacion/pages/cuentas-bancarias.js');
    try {
        execSync(`node --check "${file}"`, { encoding: 'utf8' });
        console.log('✅ JS DE cuentas-bancarias.js ES 100% VÁLIDO SIN ERRORES');
    } catch (e) {
        console.error('❌ ERROR DE SINTAXIS:', e.stderr || e.stdout || e.message);
        process.exit(1);
    }
}

checkCuentasBancariasJs();
