const fs = require('fs');

let js = fs.readFileSync('src/produccion/js/ingredientes.js', 'utf8');

const t1 = `        const stocks = [
            { id: 'con-stock', label: 'Con Stock' },
            { id: 'sin-stock', label: 'Sin Stock' }
        ];`;
const r1 = `        const stocks = [
            { id: 'con-stock', label: 'Con Stock' },
            { id: 'sin-stock', label: 'Sin Stock' },
            { id: 'stock-negativo', label: 'Con Stock Negativo' }
        ];`;

const t2 = `            if (filtrosStockActivos.size > 0) {
                const stockActual = parseFloat(ing.stock_actual) || 0;
                const tolerancia = 0.001;

                if (filtrosStockActivos.has('con-stock') && stockActual > tolerancia) {
                    pasaStock = true;
                }
                if (filtrosStockActivos.has('sin-stock') && stockActual <= tolerancia) {
                    pasaStock = true;
                }
            }`;
            
const r2 = `            if (filtrosStockActivos.size > 0) {
                // Alineación simétrica con window.obtenerColorStock para colores de UI
                let numRedondeado = parseFloat(Number(ing.stock_actual).toFixed(3));
                if (Object.is(numRedondeado, -0) || isNaN(numRedondeado)) numRedondeado = 0;

                if (filtrosStockActivos.has('con-stock') && numRedondeado > 0) {
                    pasaStock = true;
                }
                if (filtrosStockActivos.has('sin-stock') && numRedondeado === 0) {
                    pasaStock = true;
                }
                if (filtrosStockActivos.has('stock-negativo') && numRedondeado < 0) {
                    pasaStock = true;
                }
            }`;

if (js.includes(t1) && js.includes(t2)) {
    js = js.replace(t1, r1);
    js = js.replace(t2, r2);
    fs.writeFileSync('src/produccion/js/ingredientes.js', js, 'utf8');
    console.log('UI patch applied precisely.');
} else {
    // maybe try cleaning whitespace
    console.log('Target string not found, falling back to splice method.');
    const lines = js.split('\\n');
    let s1 = lines.findIndex(l => l.includes("const stocks = ["));
    if(s1 !== -1) {
        lines.splice(s1, 4, ...r1.split('\\n'));
    }
    let s2 = lines.findIndex(l => l.includes("const stockActual = parseFloat(ing.stock_actual) || 0;")) - 1;
    if(s2 !== -2) {
        lines.splice(s2, 11, ...r2.split('\\n'));
    }
    fs.writeFileSync('src/produccion/js/ingredientes.js', lines.join('\\n'), 'utf8');
    console.log('Splice patch executed.');
}
