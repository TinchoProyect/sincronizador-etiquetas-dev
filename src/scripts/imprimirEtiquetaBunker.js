const fs = require('fs').promises;
const fsSync = require('fs');
const path = require('path');
const { despacharZplAZebra } = require('../services/zebraPrintBridgeService');

function generarParEtiquetasBunker({ descripcion_generada = '', codigo_barras = '0000000000', lote_id = '', lote_codigo_corto = '' }) {
  let fuenteDescripcion = '^CF0,45';
  if (descripcion_generada.length > 30) {
    fuenteDescripcion = '^CF0,23';
  } else if (descripcion_generada.length > 20) {
    fuenteDescripcion = '^CF0,30';
  }

  // Etiqueta 1 (Izquierda): Identidad Comercial
  const etiqueta1 = `${fuenteDescripcion}
^FO23,15^FD${descripcion_generada}^FS
^BY2,2,40
^FO23,55^BCN,65,Y,N,N
^FD${codigo_barras || '0000000000'}^FS`;

  // Etiqueta 2 (Derecha): Trazabilidad de Lote
  let barcodeZplRight = '';
  let textSecondaryRight = '';
  const loteImprimir = lote_codigo_corto || lote_id;

  if (loteImprimir) {
    barcodeZplRight = `^BY2,2,40
^FO443,55^BCN,65,N,N,N
^FD${loteImprimir}^FS`;
    textSecondaryRight = `^CF0,25
^FO443,20^FDL: ${loteImprimir}^FS`;
  } else {
    textSecondaryRight = `^CF0,20
^FO443,20^FDSIN LOTE VINCULADO^FS`;
  }

  const etiqueta2 = `${textSecondaryRight}
${barcodeZplRight}`;

  return `^XA
^LH0,0
^LT0
${etiqueta1}
${etiqueta2}
^XZ`;
}

async function imprimirEtiquetaBunker(datos = {}, cantidadArg = 2) {
  const descripcion_generada = datos.descripcion_generada || datos.nombre || '';
  const codigo_barras = datos.codigo_barras || datos.codigo || '0000000000';
  const lote_id = datos.lote_id || '';
  const lote_codigo_corto = datos.lote_codigo_corto || datos.lote || '';
  const cantidad = Math.max(1, parseInt(cantidadArg || datos.cantidad || 2, 10) || 1);
  const cantidadPar = cantidad % 2 === 0 ? cantidad : cantidad + 1;
  const paresNecesarios = Math.ceil(cantidadPar / 2);

  let contenido = '';
  for (let i = 0; i < paresNecesarios; i++) {
    contenido += generarParEtiquetasBunker({ descripcion_generada, codigo_barras, lote_id, lote_codigo_corto });
  }

  return despacharZplAZebra({
    zplContent: contenido,
    tipoEtiqueta: 'ETIQUETA_BUNKER',
    descripcion: `Búnker (${cantidad}x): ${descripcion_generada} [${lote_codigo_corto || lote_id || 'S/L'}]`,
    nombreImpresora: 'Zebra'
  });
}

async function main() {
  let cantidad = 2;
  let jsonPath = '';

  try {
    if (process.argv.length < 4) {
      throw new Error('Faltan argumentos para la impresión (cantidad y path del json)');
    }

    cantidad = parseInt(process.argv[2], 10);
    jsonPath = process.argv[3];

    if (isNaN(cantidad) || cantidad < 1) {
      throw new Error('Cantidad inválida');
    }

    console.log(`[PRINT-BUNKER] Leyendo archivo JSON de datos temporales: ${jsonPath}`);
    const jsonContent = await fs.readFile(jsonPath, 'utf8');
    const datos = JSON.parse(jsonContent);
    console.log('[PRINT-BUNKER] Datos leídos:', datos);

    const { descripcion_generada = '', codigo_barras = '0000000000', lote_id = '', lote_codigo_corto = '' } = datos;

    const tempDir = path.dirname(jsonPath);
    const nombreArchivo = path.join(tempDir, `etiqueta-bunker-${Date.now()}.zpl`);
    console.log('[PRINT-BUNKER] Generando archivo ZPL:', nombreArchivo);

    const nombreImpresora = 'Zebra';
    const cantidadPar = cantidad % 2 === 0 ? cantidad : cantidad + 1;

    let contenido = '';
    const paresNecesarios = Math.ceil(cantidadPar / 2);
    for (let i = 0; i < paresNecesarios; i++) {
      contenido += generarParEtiquetasBunker({ descripcion_generada, codigo_barras, lote_id, lote_codigo_corto });
    }

    await fs.writeFile(nombreArchivo, contenido, { encoding: 'utf8' });
    console.log('[PRINT-BUNKER] Archivo ZPL escrito con éxito.');

    try {
      await despacharZplAZebra({
        zplContent: contenido,
        zplFilePath: nombreArchivo,
        tipoEtiqueta: 'ETIQUETA_BUNKER',
        descripcion: `Búnker (${cantidad}x): ${descripcion_generada} [${lote_codigo_corto || lote_id || 'S/L'}]`,
        nombreImpresora
      });
      console.log('[PRINT-BUNKER] Impresión enviada a la impresora Zebra con éxito.');
    } finally {
      try {
        if (fsSync.existsSync(nombreArchivo)) {
          fsSync.unlinkSync(nombreArchivo);
          console.log('[PRINT-BUNKER] Archivo ZPL temporal eliminado.');
        }
      } catch (e) {
        console.error('[PRINT-BUNKER] Error borrando ZPL temporal:', e);
      }
    }

    if (require.main === module) {
      process.exit(0);
    }
  } catch (error) {
    console.error('[PRINT-BUNKER] Error en el proceso de impresión:', error.message);
    if (require.main === module) {
      process.exit(1);
    }
    throw error;
  }
}

if (require.main === module) {
  main();
}

module.exports = {
  main,
  generarParEtiquetasBunker,
  imprimirEtiquetaBunker
};
