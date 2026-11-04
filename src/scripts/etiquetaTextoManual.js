const fs = require('fs').promises;
const fsSync = require('fs');
const { exec } = require('child_process');
const path = require('path');
const { createCanvas, loadImage } = require('canvas');

async function obtenerLogoZpl(targetWidth) {
  try {
    const logoPath = path.resolve(__dirname, '../../b2b-portal/public/logo_LAMDA.png');
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
    console.error("❌ Error al rasterizar el logo de LAMDA:", err);
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
      
      let etiqueta1 = `^FO${posX1},30${logoInfo.zpl}^FS
^FO15,130^FB400,1,0,C^A0N,32,24^FD${tel}^FS`;

      let etiqueta2 = `^FO${posX2},30${logoInfo.zpl}^FS
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
  let posY1 = 40;  // Posición inicial para texto principal
  let posY2 = 120; // Posición inicial para texto secundario
  let posY3 = 160; // Posición inicial para texto adicional

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

async function main() {
  try {
    // Validar argumentos
    if (process.argv.length < 3) {
      throw new Error('Falta el argumento de cantidad');
    }

    // Obtener la ruta del directorio temporal de app-etiquetas
    const tempDir = path.resolve(__dirname, '../app-etiquetas/temp');
    console.log('Directorio temporal:', tempDir);

    // Leer datos del archivo JSON
    // OJO: Nuevo soporte para argumento opcional con el path del archivo unico
    let jsonPath = path.join(tempDir, 'temp-texto.json'); // Default legacy

    if (process.argv[3]) {
      // Si viene un 4to argumento (indice 3), es el path del archivo especifico
      jsonPath = process.argv[3];
    }

    console.log('Leyendo archivo JSON desde:', jsonPath);

    const jsonContent = await fs.readFile(jsonPath, 'utf8');
    console.log('Contenido JSON leído:', jsonContent);

    const datos = JSON.parse(jsonContent);
    console.log('JSON parseado:', datos);

    // Procesar cantidad
    const cantidad = parseInt(process.argv[2], 10) || 2;
    const cantidadPar = cantidad % 2 === 0 ? cantidad : cantidad + 1;

    if (isNaN(cantidad) || cantidad < 2) {
      console.warn('Cantidad inválida. Usando valor por defecto: 2');
    }

    // El directorio temporal ya está configurado arriba

    // Crear directorio temporal si no existe
    try {
      await fs.mkdir(tempDir, { recursive: true });
      console.log('Directorio temporal creado/verificado');
    } catch (err) {
      console.error('Error al crear directorio temporal:', err);
      throw err;
    }

    // Verificar permisos de escritura
    try {
      await fs.access(tempDir, fsSync.constants.W_OK);
      console.log('Permisos de escritura verificados');
    } catch (err) {
      throw new Error(`No hay permisos de escritura en ${tempDir}: ${err.message}`);
    }

    // Generar contenido ZPL
    let contenido = '';
    const paresDeEtiquetas = cantidadPar / 2;
    for (let i = 0; i < paresDeEtiquetas; i++) {
      contenido += await generarParEtiquetas(datos);
    }

    // Escribir archivo
    // FIX: Usar nombre unico basado en el input para evitar colisiones
    const uniqueId = path.basename(jsonPath, '.json').replace('temp-texto-', '') || Date.now();
    const nombreArchivo = path.join(tempDir, `etiqueta_texto_${uniqueId}.zpl`);

    try {
      await fs.writeFile(nombreArchivo, contenido);
      console.log('Archivo ZPL creado exitosamente en:', nombreArchivo);

      // Verificar archivo
      const stats = await fs.stat(nombreArchivo);
      console.log('Tamaño del archivo:', stats.size, 'bytes');
    } catch (err) {
      throw new Error(`Error al escribir archivo: ${err.message}`);
    }

    // Enviar a impresora
    const nombreImpresora = 'Zebra';
    // COPY es un comando de cmd, necesitamos comillas alrededor de los paths
    exec(`COPY /B "${nombreArchivo}" \\\\localhost\\${nombreImpresora}`, async (error, stdout, stderr) => {
      // Limpieza: borrar ZPL despues de enviar
      try {
        await fs.unlink(nombreArchivo);
        console.log("Archivo ZPL temporal eliminado.");
      } catch (e) { console.error("Error borrando ZPL:", e); }

      if (error) {
        console.error(`Error al imprimir: ${error.message}`);
        process.exit(1);
      }
      console.log('Impresión enviada correctamente.');
    });

  } catch (error) {
    console.error('Error en el proceso:', error.message);
    console.error('Stack:', error.stack);
    process.exit(1);
  }
}

main();
