const fs = require('fs');
const path = require('path');
const { despacharZplAZebra } = require('../services/zebraPrintBridgeService');

async function imprimirEtiquetaLote({ fechaElaboracion, fechaVencimiento, lote, cantidad }) {
    console.log('🖨️ Datos recibidos en imprimirEtiquetaLote:', { fechaElaboracion, fechaVencimiento, lote, cantidad });

    if (!fechaElaboracion || !fechaVencimiento || !lote || !cantidad || cantidad < 1) {
        throw new Error('Faltan datos requeridos para imprimir la etiqueta de lote.');
    }

    const zpl = `
^XA
^CI28
^PW650
^LL320
^LH20,0

^FO0,50^A0N,45,45^FB600,1,0,C^FDFecha de Elab: ${fechaElaboracion}^FS
^FO0,130^A0N,45,45^FB600,1,0,C^FDFecha de Vto: ${fechaVencimiento}^FS
^FO0,210^A0N,55,55^FB600,1,0,C^FDLote: ${lote}^FS

^PQ${cantidad}
^XZ
`.trim();

    const nombreArchivo = path.join(__dirname, `../../temp_lote_${Date.now()}.zpl`);
    fs.writeFileSync(nombreArchivo, zpl, 'utf8');

    return despacharZplAZebra({
        zplContent: zpl,
        zplFilePath: nombreArchivo,
        tipoEtiqueta: 'ETIQUETA_LOTE',
        descripcion: `Lote (${cantidad}x): ${lote} | Vto: ${fechaVencimiento}`,
        nombreImpresora: 'Zebra'
    });
}

module.exports = { imprimirEtiquetaLote };
