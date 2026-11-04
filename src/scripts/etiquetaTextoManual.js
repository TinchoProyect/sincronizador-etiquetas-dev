const fs = require('fs');
const path = require('path');
const { despacharZplAZebra } = require('../services/zebraPrintBridgeService');

async function imprimirEtiquetaManual({ linea1, linea2 = '', cantidad = 1, tamaño = 'mediano' }) {
  if (!linea1 || cantidad < 1) {
    throw new Error('Datos inválidos para imprimir la etiqueta manual.');
  }

  const tamañosFuente = {
    pequeño: 35,
    mediano: 50,
    grande: 65,
    'muy-grande': 115
  };

  const altoFuente = tamañosFuente[tamaño] || tamañosFuente['mediano'];
  const anchoFuente = altoFuente;

  const alturaTotal = 320;
  const espacioEntreLineas = 30;
  let posY1, posY2;

  if (linea2) {
    const totalTexto = altoFuente * 2 + espacioEntreLineas;
    posY1 = Math.floor((alturaTotal - totalTexto) / 2);
    posY2 = posY1 + altoFuente + espacioEntreLineas;
  } else {
    posY1 = Math.floor((alturaTotal - altoFuente) / 2);
  }

  let zpl = `
^XA
^CI28
^PW650
^LL320
^LH20,0
^FO0,${posY1}^A0N,${altoFuente},${anchoFuente}^FB600,1,0,C^FD${linea1}^FS
`;

  if (linea2) {
    zpl += `^FO0,${posY2}^A0N,${altoFuente},${anchoFuente}^FB600,1,0,C^FD${linea2}^FS\n`;
  }

  zpl += `^PQ${cantidad}\n^XZ`;

  const nombreArchivo = path.join(__dirname, `../../temp_manual_${Date.now()}.zpl`);
  fs.writeFileSync(nombreArchivo, zpl.trim(), 'utf8');

  return despacharZplAZebra({
    zplContent: zpl.trim(),
    zplFilePath: nombreArchivo,
    tipoEtiqueta: 'ETIQUETA_MANUAL',
    descripcion: `Manual (${cantidad}x): ${linea1} ${linea2}`.trim(),
    nombreImpresora: 'Zebra'
  });
}

module.exports = { imprimirEtiquetaManual };
