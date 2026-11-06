const fs = require('fs').promises;
const fsSync = require('fs');
const path = require('path');
const { createCanvas, loadImage } = require('canvas');
const { despacharZplAZebra } = require('../services/zebraPrintBridgeService');

async function obtenerLogoZpl(targetWidth) {
  try {
    const candidate1 = path.resolve(__dirname, '../../b2b-portal/public/logo_LAMDA.png');
    const candidate2 = path.resolve(__dirname, '../app-etiquetas/img/logo_LAMDA.png');
    const logoPath = fsSync.existsSync(candidate1) ? candidate1 : candidate2;
    const img = await loadImage(logoPath);

    const w = targetWidth || 280;
    const h = Math.round((img.height / img.width) * w);

    const canvas = createCanvas(w, h);
    const ctx = canvas.getContext('2d');

    ctx.fillStyle = '#FFFFFF';
    ctx.fillRect(0, 0, w, h);
    ctx.drawImage(img, 0, 0, w, h);

    const imgData = ctx.getImageData(0, 0, w, h);
    const pixels = imgData.data;

    const bytesPerRow = Math.ceil(w / 8);
    const totalBytes = bytesPerRow * h;

    let hexString = '';
    for (let y = 0; y < h; y++) {
      for (let xByte = 0; xByte < bytesPerRow; xByte++) {
        let byteVal = 0;
        for (let bit = 0; bit < 8; bit++) {
          const x = xByte * 8 + bit;
          let isBlack = false;
          if (x < w) {
            const idx = (y * w + x) * 4;
            const r = pixels[idx];
            const g = pixels[idx + 1];
            const b = pixels[idx + 2];
            const a = pixels[idx + 3];

            if (a >= 50) {
              const luma = 0.299 * r + 0.587 * g + 0.114 * b;
              isBlack = luma < 180;
            }
          }
          if (isBlack) {
            byteVal |= (1 << (7 - bit));
          }
        }
        hexString += byteVal.toString(16).padStart(2, '0').toUpperCase();
      }
    }

    return {
      zpl: `^GFA,${totalBytes},${totalBytes},${bytesPerRow},${hexString}`,
      w,
      h
    };
  } catch (err) {
    console.error('❌ Error al rasterizar el logo de LAMDA:', err);
    return null;
  }
}

async function generarParEtiquetas({ textoPrincipal, textoSecundario, textoAdicional }) {
  const esLogoLamda = textoPrincipal && (textoPrincipal.toUpperCase() === 'LAMDA' || textoPrincipal.toUpperCase() === 'LAMBDA');

  if (esLogoLamda) {
    const logoInfo = await obtenerLogoZpl(280);
    if (logoInfo) {
      const tel = textoSecundario || '221-6615746';
      const posX1 = Math.round((400 - logoInfo.w) / 2);
      const posX2 = 425 + posX1;

      const etiqueta1 = `^FO${posX1},30${logoInfo.zpl}^FS
^FO15,130^FB400,1,0,C^A0N,32,24^FD${tel}^FS`;

      const etiqueta2 = `^FO${posX2},30${logoInfo.zpl}^FS
^FO425,130^FB400,1,0,C^A0N,32,24^FD${tel}^FS`;

      return `^XA
^LH0,0
^LT0
${etiqueta1}
${etiqueta2}
^XZ`;
    }
  }

  // Configuración de fuentes según importancia
  const fuentePrincipal = '^CF0,80';    // Fuente más grande para texto principal
  const fuenteSecundaria = '^CF0,30';   // Fuente mediana para texto secundario
  const fuenteAdicional = '^CF0,20';    // Fuente pequeña para texto adicional

  // Calcular posiciones verticales
  const posY1 = 40;  // Posición inicial para texto principal
  const posY2 = 120; // Posición inicial para texto secundario
  const posY3 = 160; // Posición inicial para texto adicional

  // Generar etiqueta izquierda
  let etiqueta1 = `${fuentePrincipal}
^FO15,${posY1}^FB400,1,0,C^FD${textoPrincipal}^FS`;

  if (textoSecundario) {
    etiqueta1 += `\n${fuenteSecundaria}
^FO15,${posY2}^FB400,1,0,C^FD${textoSecundario}^FS`;
  }

  if (textoAdicional) {
    etiqueta1 += `\n${fuenteAdicional}
^FO15,${posY3}^FB400,1,0,C^FD${textoAdicional}^FS`;
  }

  // Generar etiqueta derecha
  let etiqueta2 = `${fuentePrincipal}
^FO425,${posY1}^FB400,1,0,C^FD${textoPrincipal}^FS`;

  if (textoSecundario) {
    etiqueta2 += `\n${fuenteSecundaria}
^FO425,${posY2}^FB400,1,0,C^FD${textoSecundario}^FS`;
  }

  if (textoAdicional) {
    etiqueta2 += `\n${fuenteAdicional}
^FO425,${posY3}^FB400,1,0,C^FD${textoAdicional}^FS`;
  }

  return `^XA
^LH0,0
^LT0
${etiqueta1}
${etiqueta2}
^XZ`;
}

async function imprimirEtiquetaManual(datos = {}) {
  const textoPrincipal = datos.textoPrincipal || datos.linea1 || '';
  const textoSecundario = datos.textoSecundario || datos.linea2 || '';
  const textoAdicional = datos.textoAdicional || '';
  const cantidad = parseInt(datos.cantidad, 10) || 2;
  const cantidadPar = cantidad % 2 === 0 ? cantidad : cantidad + 1;
  const paresDeEtiquetas = Math.max(1, cantidadPar / 2);

  let contenido = '';
  for (let i = 0; i < paresDeEtiquetas; i++) {
    contenido += await generarParEtiquetas({ textoPrincipal, textoSecundario, textoAdicional });
  }

  return despacharZplAZebra({
    zplContent: contenido,
    tipoEtiqueta: 'ETIQUETA_MANUAL',
    descripcion: `Manual (${cantidad}x): ${textoPrincipal} ${textoSecundario}`.trim(),
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

    let jsonPath = path.join(tempDir, 'temp-texto.json');
    if (process.argv[3]) {
      jsonPath = process.argv[3];
    }

    console.log('Leyendo archivo JSON desde:', jsonPath);
    const jsonContent = await fs.readFile(jsonPath, 'utf8');
    console.log('Contenido JSON leído:', jsonContent);

    const datos = JSON.parse(jsonContent);
    console.log('JSON parseado:', datos);

    const cantidad = parseInt(process.argv[2], 10) || 2;
    const cantidadPar = cantidad % 2 === 0 ? cantidad : cantidad + 1;

    await fs.mkdir(tempDir, { recursive: true });
    await fs.access(tempDir, fsSync.constants.W_OK);

    let contenido = '';
    const paresDeEtiquetas = Math.max(1, cantidadPar / 2);
    for (let i = 0; i < paresDeEtiquetas; i++) {
      contenido += await generarParEtiquetas(datos);
    }

    const uniqueId = path.basename(jsonPath, '.json').replace('temp-texto-', '') || Date.now();
    const nombreArchivo = path.join(tempDir, `etiqueta_texto_${uniqueId}.zpl`);

    await fs.writeFile(nombreArchivo, contenido, 'utf8');
    console.log('Archivo ZPL creado exitosamente en:', nombreArchivo);

    const nombreImpresora = 'Zebra';
    try {
      await despacharZplAZebra({
        zplContent: contenido,
        zplFilePath: nombreArchivo,
        tipoEtiqueta: 'ETIQUETA_MANUAL',
        descripcion: `Manual (${cantidad}x): ${datos.textoPrincipal || ''} ${datos.textoSecundario || ''}`.trim(),
        nombreImpresora
      });
      console.log('Impresión enviada correctamente.');
    } finally {
      try { await fs.unlink(nombreArchivo); } catch (_) {}
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
  generarParEtiquetas,
  imprimirEtiquetaManual
};
