const fs = require('fs');

let jsFile = 'src/produccion/js/ingredientes.js';
let js = fs.readFileSync(jsFile, 'utf8');

js = js.replace(/for \(const \{nombreSector, items\} of gruposArray\)/g, 'for (const {nombreSector, items, letra} of gruposArray)');

const formatearStockRegex = /function formatearStock\(valor\) \{[\s\S]*?\n\}/;
const newFormatearStock = `function formatearStock(valor) {
    let numero = parseFloat(Number(valor).toFixed(3));
    if (numero === 0) numero = 0;
    return numero.toString();
}
window.formatearStock = formatearStock;`;

if (formatearStockRegex.test(js)) {
    js = js.replace(formatearStockRegex, newFormatearStock);
}

fs.writeFileSync(jsFile, js, 'utf8');

let cssFile = 'src/produccion/css/ingredientes-panel.css';
let css = fs.readFileSync(cssFile, 'utf8');

const classList = 'body.modo-impresion-cartel .container,\n    body.modo-impresion-cartel .ingredientes-container,\n    body.modo-impresion-cartel header,\n    body.modo-impresion-cartel footer,';
css = css.replace(/body\.modo-impresion-cartel \.app-container,/, classList);

fs.writeFileSync(cssFile, css, 'utf8');
console.log('Final fixes applied successfully.');
