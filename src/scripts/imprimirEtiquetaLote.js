const fs = require('fs').promises;
const fsSync = require('fs');
const path = require('path');
const { despacharZplAZebra } = require('../services/zebraPrintBridgeService');

function generarParEtiquetasLote(id, desc) {
  let fuenteDescripcion = '^CF0,30'; // fuente grande por defecto
  if (desc.length > 30) {
    fuenteDescripcion = '^CF0,20'; // fuente chica
  } else if (desc.length > 20) {
    fuenteDescripcion = '^CF0,25'; // fuente mediana
  }

  const etiqueta1 = `${fuenteDescripcion}
^FO23,20^FD${desc}^FS
^CF0,25
^FO23,55^FDL: ${id}^FS
^BY3,2,55
^FO23,85^BCN,55,N,N,N
^FD${id}^FS`;

  const etiqueta2 = `${fuenteDescripcion}
^FO443,20^FD${desc}^FS
^CF0,25
^FO443,55^FDL: ${id}^FS
^BY3,2,55
^FO443,85^BCN,55,N,N,N
^FD${id}^FS`;

  return `^XA
^LH0,0
^LT0
${etiqueta1}
${etiqueta2}
^XZ`;
}

async function imprimirEtiquetaLote(datos = {}, cantidadArg = 2) {
  const idCorto = datos.id_corto || datos.lote || '';
  const descripcion = datos.descripcion || datos.nombre || 'S/D';
  const cantidad = Math.max(1, parseInt(cantidadArg || datos.cantidad || 2, 10) || 1);
  const cantidadPar = cantidad % 2 === 0 ? cantidad : cantidad + 1;
  const paresNecesarios = Math.ceil(cantidadPar / 2);

  let contenido = '';
  for (let i = 0; i < paresNecesarios; i++) {
    contenido += generarParEtiquetasLote(idCorto, descripcion);
  }

  return despacharZplAZebra({
    zplContent: contenido,
    tipoEtiqueta: 'ETIQUETA_LOTE',
    descripcion: `Lote (${cantidad}x): ${descripcion} [${idCorto}]`,
    nombreImpresora: 'Zebra'
  });
}

async function main() {
  try {
    if (process.argv.length < 4) {
      throw new Error('Faltan argumentos: node imprimirEtiquetaLote.js <cantidad> <archivo_json>');
    }

    const cantidad = parseInt(process.argv[2], 10);
    const jsonPath = process.argv[3];

    if (isNaN(cantidad) || cantidad < 1) {
      throw new Error('Cantidad inválida');
    }

    console.log('Leyendo archivo JSON:', jsonPath);
    const jsonContent = await fs.readFile(jsonPath, 'utf8');
    const datos = JSON.parse(jsonContent);
    console.log('Datos del lote parseados:', datos);

    const idCorto = datos.id_corto;
    const descripcion = datos.descripcion || 'S/D';

    const tempDir = path.resolve(__dirname, '../app-etiquetas/temp');
    try {
      await fs.mkdir(tempDir, { recursive: true });
    } catch (_) {}

    const nombreArchivo = path.join(tempDir, `etiqueta_lote_${Date.now()}.zpl`);
    const nombreImpresora = 'Zebra';
    const cantidadPar = cantidad % 2 === 0 ? cantidad : cantidad + 1;

    let contenido = '';
    const paresNecesarios = Math.ceil(cantidadPar / 2);
    for (let i = 0; i < paresNecesarios; i++) {
      contenido += generarParEtiquetasLote(idCorto, descripcion);
    }

    await fs.writeFile(nombreArchivo, contenido, { encoding: 'utf8' });
    console.log('Archivo ZPL creado exitosamente:', nombreArchivo);

    try {
      await despacharZplAZebra({
        zplContent: contenido,
        zplFilePath: nombreArchivo,
        tipoEtiqueta: 'ETIQUETA_LOTE',
        descripcion: `Lote (${cantidad}x): ${descripcion} [${idCorto}]`,
        nombreImpresora
      });
      console.log('Impresión de lote enviada correctamente a Zebra.');
    } finally {
      try {
        if (fsSync.existsSync(nombreArchivo)) fsSync.unlinkSync(nombreArchivo);
      } catch (_) {}
    }
    if (require.main === module) {
      process.exit(0);
    }
  } catch (error) {
    console.error('Error en el proceso de impresión de lote:', error.message);
    process.exit(1);
  }
}

if (require.main === module) {
  main();
}

module.exports = {
  main,
  generarParEtiquetasLote,
  imprimirEtiquetaLote
};
