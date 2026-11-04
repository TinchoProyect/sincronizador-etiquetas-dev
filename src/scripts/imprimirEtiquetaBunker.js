const fs = require('fs');
const path = require('path');
const { despacharZplAZebra } = require('../services/zebraPrintBridgeService');

/**
 * Normaliza un texto para impresión ZPL eliminando tildes y eñes
 * para evitar problemas de codificación en impresoras térmicas.
 */
function normalizarZPL(texto) {
  if (!texto) return '';
  return String(texto)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/ñ/g, 'n')
    .replace(/Ñ/g, 'N')
    .replace(/[\^~]/g, ' ') // Caracteres de control ZPL
    .trim();
}

/**
 * Divide un texto en líneas que no superen maxChars sin cortar palabras.
 */
function dividirEnLineas(texto, maxChars = 28, maxLineas = 3) {
  const limpio = normalizarZPL(texto);
  if (!limpio) return ['SIN DESCRIPCION'];

  const palabras = limpio.split(/\s+/);
  const lineas = [];
  let lineaActual = '';

  for (const palabra of palabras) {
    if (!lineaActual) {
      lineaActual = palabra.substring(0, maxChars);
    } else if ((lineaActual + ' ' + palabra).length <= maxChars) {
      lineaActual += ' ' + palabra;
    } else {
      lineas.push(lineaActual);
      if (lineas.length >= maxLineas) {
        return lineas;
      }
      lineaActual = palabra.substring(0, maxChars);
    }
  }

  if (lineaActual && lineas.length < maxLineas) {
    lineas.push(lineaActual);
  }

  return lineas;
}

/**
 * Imprime una etiqueta física en la impresora Zebra para un Artículo del Búnker.
 */
async function imprimirEtiquetaBunker({ codigo, nombre, codigo_barras = '', cantidad = 1 }) {
  console.log('🖨️ [BUNKER-ZPL] Solicitud de impresión:', { codigo, nombre, codigo_barras, cantidad });

  if (!codigo || !nombre) {
    throw new Error('Faltan datos obligatorios (código y nombre) para imprimir la etiqueta del Búnker.');
  }

  const cant = Math.max(1, Math.min(50, parseInt(cantidad, 10) || 1));
  const codigoLimpio = normalizarZPL(codigo).toUpperCase();
  const lineasNombre = dividirEnLineas(nombre.toUpperCase(), 26, 3);

  const numLineas = lineasNombre.length;
  const tamFuenteNombre = numLineas === 1 ? 44 : (numLineas === 2 ? 38 : 32);
  const saltoLinea = tamFuenteNombre + 6;
  const inicioNombreY = numLineas === 3 ? 8 : 14;

  let bloqueNombreZPL = '';
  lineasNombre.forEach((linea, idx) => {
    const posY = inicioNombreY + (idx * saltoLinea);
    bloqueNombreZPL += `^FO0,${posY}^A0N,${tamFuenteNombre},${tamFuenteNombre}^FB610,1,0,C^FD${linea}^FS\n`;
  });

  const finNombreY = inicioNombreY + (numLineas * saltoLinea);
  const lineaSeparadoraY = finNombreY + 2;

  const barcodeY = lineaSeparadoraY + 12;
  const barcodeHeight = numLineas === 3 ? 85 : 95;

  const anchoEstimadoBarcode = (codigoLimpio.length * 24) + 70;
  const barcodeX = Math.max(40, Math.floor((610 - anchoEstimadoBarcode) / 2));

  const textoCodigoY = barcodeY + barcodeHeight + 12;

  const eanLimpio = normalizarZPL(codigo_barras);
  const mostrarEan = eanLimpio && eanLimpio !== '0' && eanLimpio !== '0000000000' && eanLimpio !== codigoLimpio;
  const textoInferior = mostrarEan ? `COD: ${codigoLimpio}   |   EAN: ${eanLimpio}` : `COD: ${codigoLimpio}`;

  const zpl = `
^XA
^CI28
^PW650
^LL320
^LH20,15

${bloqueNombreZPL.trim()}
^FO30,${lineaSeparadoraY}^GB550,2,2^FS

^FO${barcodeX},${barcodeY}^BY2,2,${barcodeHeight}
^BCN,${barcodeHeight},N,N,N
^FD${codigoLimpio}^FS

^FO0,${textoCodigoY}^A0N,32,32^FB610,1,0,C^FD${textoInferior}^FS

^PQ${cant}
^XZ
`.trim();

  const nombreArchivo = path.join(__dirname, `../../temp_bunker_${Date.now()}.zpl`);
  fs.writeFileSync(nombreArchivo, zpl, 'utf8');

  return despacharZplAZebra({
    zplContent: zpl,
    zplFilePath: nombreArchivo,
    tipoEtiqueta: 'ETIQUETA_BUNKER',
    descripcion: `Búnker (${cant}x): ${nombre} [${codigoLimpio}]`,
    nombreImpresora: 'Zebra'
  });
}

module.exports = { imprimirEtiquetaBunker };
