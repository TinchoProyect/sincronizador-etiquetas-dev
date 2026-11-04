const fs = require('fs');
const path = require('path');
const { despacharZplAZebra } = require('../services/zebraPrintBridgeService');

async function imprimirEtiquetaZPL(articulo) {
  console.log('🖨️ Datos recibidos en imprimirEtiquetaZPL:', articulo);
  const { descripcion, codigo_barras, numero } = articulo;

  if (!descripcion || !numero) {
    throw new Error('Faltan datos requeridos para imprimir la etiqueta.');
  }

  const codigoParaImprimir = (codigo_barras && codigo_barras !== '0000000000' && codigo_barras !== '0')
    ? codigo_barras
    : numero;

  // Dividir descripción en hasta 2 líneas de máximo 30 caracteres sin cortar palabras
  function dividirDescripcion(texto, maxLinea = 30) {
    const palabras = texto.trim().split(/\s+/);
    let linea1 = '';
    let linea2 = '';

    for (const palabra of palabras) {
      if ((linea1 + ' ' + palabra).trim().length <= maxLinea) {
        linea1 = (linea1 + ' ' + palabra).trim();
      } else if ((linea2 + ' ' + palabra).trim().length <= maxLinea) {
        linea2 = (linea2 + ' ' + palabra).trim();
      } else {
        break; // No agregamos más si supera las dos líneas
      }
    }

    return [linea1, linea2];
  }

  const [linea1, linea2] = dividirDescripcion(descripcion);

  let zpl = `
^XA
^CI28
^PW650
^LL320
^LH20,20

^FO0,0^A0N,38,38^FB600,1,0,C^FD${linea1}^FS
`;

  if (linea2) {
    zpl += `^FO0,45^A0N,38,38^FB600,1,0,C^FD${linea2}^FS\n`;
  }

  const alturaCodigo = linea2 ? 95 : 70;
  const textoDebajoY = alturaCodigo + 100 + 20;

  zpl += `
^FO150,${alturaCodigo}^BY2,2,100
^BCN,100,N,N,N
^FD${codigoParaImprimir}^FS

^FO0,${textoDebajoY}^A0N,30,30^FB600,1,0,C^FD${codigoParaImprimir}^FS

^XZ
`.trim();

  const nombreArchivo = path.join(__dirname, `../../temp_${Date.now()}.zpl`);
  fs.writeFileSync(nombreArchivo, zpl, 'utf8');

  return despacharZplAZebra({
    zplContent: zpl,
    zplFilePath: nombreArchivo,
    tipoEtiqueta: 'ETIQUETA_ARTICULO',
    descripcion: `${descripcion} (${codigoParaImprimir})`,
    nombreImpresora: 'Zebra'
  });
}

module.exports = { imprimirEtiquetaZPL };
