const fs = require('fs').promises;
const fsSync = require('fs');
const path = require('path');
const { despacharZplAZebra } = require('../services/zebraPrintBridgeService');

function generarParEtiquetasIngrediente(datos) {
  const nombre = String(datos?.nombre || 'INGREDIENTE').trim();
  const codigo = String(datos?.codigo || datos?.id || '0000').trim();
  const sector = String(datos?.sector || datos?.sectorLetra || '').trim();

  // Configuración de codificación para caracteres especiales
  const encabezadoZPL = '^XA^CI28'; // CI28 para Latin-1/Windows-1252

  // Lógica de adaptación de fuente basada en la longitud del nombre
  let fuenteDescripcion = '^CF0,40'; // fuente grande por defecto

  if (nombre.length > 30) {
    fuenteDescripcion = '^CF0,25'; // fuente más chica para nombres largos
  } else if (nombre.length > 20) {
    fuenteDescripcion = '^CF0,30'; // fuente mediana para nombres medianos
  }

  // Configuración del código de barras
  const alturaCodigoBarras = 60; // Altura reducida para ingredientes

  // Título identificador
  const fuenteTitulo = '^CF0,20';
  const textoTitulo = 'INGREDIENTE DE PRODUCCION';

  // Etiqueta izquierda
  const etiqueta1 = `${fuenteDescripcion}
^FO23,10^FD${nombre}^FS
^BY2,2,40
^FO23,50^BCN,${alturaCodigoBarras},Y,N,N
^FD${codigo}^FS
${sector ? `^CF0,60^FO320,60^FD${sector}^FS` : ''}
${fuenteTitulo}
^FO23,160^FB400,1,0,C^FD${textoTitulo}^FS`;

  // Etiqueta derecha
  const etiqueta2 = `${fuenteDescripcion}
^FO443,10^FD${nombre}^FS
^BY2,2,40
^FO443,50^BCN,${alturaCodigoBarras},Y,N,N
^FD${codigo}^FS
${sector ? `^CF0,60^FO740,60^FD${sector}^FS` : ''}
${fuenteTitulo}
^FO443,160^FB400,1,0,C^FD${textoTitulo}^FS`;

  return `${encabezadoZPL}
^LH0,0
^LT0
${etiqueta1}
${etiqueta2}
^XZ`;
}

async function imprimirEtiquetaIngrediente(ingrediente, sectorLetra, cantidadArg = 2) {
  const datos = {
    ...(ingrediente || {}),
    sector: sectorLetra || ingrediente?.sector || ingrediente?.sectorLetra || ''
  };
  const cantidad = Math.max(1, Math.ceil(parseFloat(cantidadArg) || 1));
  const cantidadPar = cantidad % 2 === 0 ? cantidad : cantidad + 1;
  const paresNecesarios = Math.ceil(cantidadPar / 2);

  let contenido = '';
  for (let i = 0; i < paresNecesarios; i++) {
    contenido += generarParEtiquetasIngrediente(datos);
  }

  return despacharZplAZebra({
    zplContent: contenido,
    tipoEtiqueta: 'ETIQUETA_INGREDIENTE',
    descripcion: `Ingrediente (${cantidad}x): ${datos.nombre || ''} [${datos.codigo || ''}]`,
    nombreImpresora: 'Zebra'
  });
}

async function main() {
  try {
    if (process.argv.length < 3) {
      throw new Error('Falta el argumento de cantidad');
    }

    const tempDir = path.resolve(__dirname, '../app-etiquetas/temp');
    console.log('Directorio temporal:', tempDir);

    const customJsonPath = process.argv[3] ? path.resolve(process.argv[3]) : null;
    const jsonPath = customJsonPath || path.join(tempDir, 'temp-ingrediente.json');
    console.log('Leyendo archivo JSON:', jsonPath);

    const jsonContent = await fs.readFile(jsonPath, 'utf8');
    console.log('Contenido JSON leído:', jsonContent);

    const datos = JSON.parse(jsonContent);
    console.log('JSON parseado:', datos);

    const cantidad = Math.max(1, Math.ceil(parseFloat(process.argv[2]) || 1));
    const cantidadPar = cantidad % 2 === 0 ? cantidad : cantidad + 1;

    await fs.mkdir(tempDir, { recursive: true });
    await fs.access(tempDir, fsSync.constants.W_OK);

    let contenido = '';
    const paresNecesarios = Math.ceil(cantidadPar / 2);
    for (let i = 0; i < paresNecesarios; i++) {
      contenido += generarParEtiquetasIngrediente(datos);
    }

    const uniqueSuffix = `${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
    const nombreArchivo = path.join(tempDir, `etiqueta_ingrediente_${uniqueSuffix}.zpl`);
    const nombreArchivoDebug = path.join(tempDir, 'etiqueta_ingrediente.zpl');

    await fs.writeFile(nombreArchivo, contenido, { encoding: 'utf8' });
    await fs.writeFile(nombreArchivoDebug, contenido, { encoding: 'utf8' }).catch(() => {});
    console.log('Archivo ZPL creado exitosamente');

    const nombreImpresora = 'Zebra';
    try {
      await despacharZplAZebra({
        zplContent: contenido,
        zplFilePath: nombreArchivo,
        tipoEtiqueta: 'ETIQUETA_INGREDIENTE',
        descripcion: `Ingrediente (${cantidad}x): ${datos.nombre || ''} [${datos.codigo || ''}]`,
        nombreImpresora
      });
      console.log('Etiqueta de ingrediente enviada a imprimir correctamente.');
    } finally {
      try { await fs.unlink(nombreArchivo); } catch (_) {}
      if (customJsonPath) {
        try { await fs.unlink(customJsonPath); } catch (_) {}
      }
    }
    if (require.main === module) {
      process.exit(0);
    }
  } catch (error) {
    console.error('Error en el proceso:', error.message);
    console.error('Stack:', error.stack);
    process.exit(1);
  }
}

if (require.main === module) {
  main();
}

module.exports = {
  main,
  generarParEtiquetasIngrediente,
  imprimirEtiquetaIngrediente
};
