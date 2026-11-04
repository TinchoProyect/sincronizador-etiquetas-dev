const fs = require('fs');
const path = require('path');
const { despacharZplAZebra } = require('../services/zebraPrintBridgeService');

async function imprimirEtiquetaIngrediente(ingrediente, sectorLetra) {
    console.log('🖨️ Datos recibidos para etiqueta de ingrediente:', { ingrediente, sectorLetra });
    const { nombre, codigo } = ingrediente;

    if (!nombre || !codigo || !sectorLetra) {
        throw new Error('Faltan datos requeridos (nombre, codigo, sectorLetra) para imprimir la etiqueta.');
    }

    function dividirTexto(texto, maxLinea = 20) {
        const palabras = texto.trim().split(/\s+/);
        let linea1 = '';
        let linea2 = '';

        for (const palabra of palabras) {
            if ((linea1 + ' ' + palabra).trim().length <= maxLinea) {
                linea1 = (linea1 + ' ' + palabra).trim();
            } else if ((linea2 + ' ' + palabra).trim().length <= maxLinea) {
                linea2 = (linea2 + ' ' + palabra).trim();
            } else {
                break;
            }
        }
        return [linea1, linea2];
    }

    const [linea1, linea2] = dividirTexto(nombre, 16);

    let zpl = `
^XA
^CI28
^PW650
^LL320
^LH20,20

^FX --- SECCIÓN SUPERIOR IZQUIERDA: NOMBRE DEL INGREDIENTE ---
^FO10,15^A0N,42,42^FB430,1,0,L^FD${linea1}^FS
`;

    if (linea2) {
        zpl += `^FO10,65^A0N,42,42^FB430,1,0,L^FD${linea2}^FS\n`;
    }

    zpl += `
^FX --- SECCIÓN SUPERIOR DERECHA: LETRA DEL SECTOR DESTACADA ---
^FO460,5^GB140,120,120^FS
^FO460,20^FR^A0N,100,100^FB140,1,0,C^FD${sectorLetra}^FS

^FX --- SECCIÓN INFERIOR: CÓDIGO DE BARRAS ---
^FO80,145^BY3,2,90
^BCN,90,N,N,N
^FD${codigo}^FS

^FO0,250^A0N,32,32^FB600,1,0,C^FD${codigo}^FS

^XZ
`.trim();

    const nombreArchivo = path.join(__dirname, `../../temp_ing_${Date.now()}.zpl`);
    fs.writeFileSync(nombreArchivo, zpl, 'utf8');

    return despacharZplAZebra({
        zplContent: zpl,
        zplFilePath: nombreArchivo,
        tipoEtiqueta: 'ETIQUETA_INGREDIENTE',
        descripcion: `Ingrediente: ${nombre} [${codigo}] Sector ${sectorLetra}`,
        nombreImpresora: 'Zebra'
    });
}

module.exports = { imprimirEtiquetaIngrediente };
