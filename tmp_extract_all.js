const fs = require('fs');
const getFunctionCode = (filePath, funcName) => {
    const code = fs.readFileSync(filePath, 'utf8');
    const tIdx = code.indexOf(funcName);
    if(tIdx !== -1) return code.substring(Math.max(0, tIdx - 150), tIdx + 1500);
    return 'Not found';
};

fs.writeFileSync('tmp_diag_retornaring.js', getFunctionCode('src/produccion/controllers/mantenimiento.js', 'async function retornarIngrediente'));
fs.writeFileSync('tmp_diag_liberarfront.js', getFunctionCode('src/produccion/pages/gestion-mantenimiento.html', 'function liberarStockMantenimiento('));
fs.writeFileSync('tmp_diag_zebra.js', getFunctionCode('src/scripts/imprimirEtiqueta.js', 'generarParEtiquetas'));
