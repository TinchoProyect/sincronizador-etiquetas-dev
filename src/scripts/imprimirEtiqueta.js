const fs = require('fs').promises;
const fsSync = require('fs');
const { exec } = require('child_process');
const path = require('path');

async function main() {
  let articulo;
  let cantidad;

  try {
    if (process.argv.length < 3) {
      throw new Error('Falta el argumento de cantidad');
    }

    // Obtener la ruta del directorio temporal de app-etiquetas
    const tempDir = path.resolve(__dirname, '../app-etiquetas/temp');
    console.log('Directorio temporal:', tempDir);

    // Leer datos del archivo JSON
    const jsonPath = path.join(tempDir, 'temp-data.json');
    console.log('Leyendo archivo JSON:', jsonPath);
    
    const jsonContent = await fs.readFile(jsonPath, 'utf8');
    console.log('Contenido JSON leído:', jsonContent);
    
    const datos = JSON.parse(jsonContent);
    console.log('JSON parseado:', datos);
    
    articulo = datos.articulo || datos;
    cantidad = parseInt(process.argv[2], 10);
    fechas = datos.fechas || null;
    const lote = datos.lote || null;
    
    if (isNaN(cantidad) || cantidad < 1) {
      throw new Error('Cantidad inválida');
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

    // Verificar que el directorio existe
    try {
      const tempDirStats = await fs.stat(tempDir);
      if (!tempDirStats.isDirectory()) {
        throw new Error('La ruta temporal no es un directorio');
      }
      console.log('Directorio temporal verificado');
    } catch (err) {
      console.error('Error al verificar directorio temporal:', err);
      throw err;
    }

    // Verificar permisos de escritura
    try {
      await fs.access(tempDir, fsSync.constants.W_OK);
      console.log('Permisos de escritura verificados');
    } catch (err) {
      console.error('Error de permisos:', err);
      throw new Error(`No hay permisos de escritura en ${tempDir}: ${err.message}`);
    }

    const nombreArchivo = path.join(tempDir, 'etiqueta.zpl');
    console.log('Archivo a crear:', nombreArchivo);

    const nombreImpresora = 'Zebra';
    const cantidadPar = cantidad % 2 === 0 ? cantidad : cantidad + 1;

    const generarParEtiquetas = (datos, lote = null) => {
      const { nombre, numero, codigo_barras } = datos;
      const tieneFechas = datos.fechas || fechas || null;
      let fuenteDescripcion = '^CF0,40'; // fuente grande por defecto

      if (nombre.length > 30) {
        fuenteDescripcion = '^CF0,25'; // fuente más chica
      } else if (nombre.length > 20) {
        fuenteDescripcion = '^CF0,30'; // fuente mediana
      }

      // Función para calcular X centrado del código de barras en BY2 (ancho estimado)
      const getBarcodeX = (text, startX, labelWidth = 360) => {
        const n = String(text).length;
        const width = 22 * n + 110; // Ancho estimado en BY2
        const leftover = labelWidth - width;
        return Math.max(startX, Math.round(startX + leftover / 2));
      };

      // Ajustar Y y altura del código de barras según presencia de fechas
      const yBarcode = tieneFechas ? 90 : 75;
      const alturaCodigoBarras = tieneFechas ? 50 : 60;
      
      const barcodeX1 = getBarcodeX(codigo_barras, 23);
      const barcodeX2 = lote ? getBarcodeX(lote, 443) : getBarcodeX(codigo_barras, 443);

      // Generar línea de fechas si están presentes
      let lineaFechas = '';
      if (tieneFechas) {
        if (lote) {
          lineaFechas = `\n^CF0,20
^FO23,68^FDENV: ${tieneFechas.elaboracion}  VTO: ${tieneFechas.vencimiento}^FS`;
        } else {
          lineaFechas = `\n^CF0,20
^FO23,68^FDENV: ${tieneFechas.elaboracion}  VTO: ${tieneFechas.vencimiento}^FS
^FO443,68^FDENV: ${tieneFechas.elaboracion}  VTO: ${tieneFechas.vencimiento}^FS`;
        }
      }

      const etiqueta1 = `${fuenteDescripcion}
^FO23,10^FD${nombre}^FS
^CF0,20
^FO23,45^FD${numero}^FS
^BY2,2,40
^FO${barcodeX1},${yBarcode}^BCN,${alturaCodigoBarras},Y,N,N
^FD${codigo_barras}^FS`;

      let etiqueta2;
      if (lote) {
        // Etiqueta derecha es el lote interno (código de lote centrado arriba y código de barras centrado abajo)
        etiqueta2 = `^CF0,40
^FO443,30^FB360,1,0,C,0^FD${lote}^FS
^BY2,2,40
^FO${barcodeX2},80^BCN,60,Y,N,N
^FD${lote}^FS`;
      } else {
        // Duplicación normal del artículo
        etiqueta2 = `${fuenteDescripcion}
^FO443,10^FD${nombre}^FS
^CF0,20
^FO443,45^FD${numero}^FS
^BY2,2,40
^FO${barcodeX2},${yBarcode}^BCN,${alturaCodigoBarras},Y,N,N
^FD${codigo_barras}^FS`;
      }

      return `^XA
^LH0,0
^LT0
${etiqueta1}
${etiqueta2}${lineaFechas}
^XZ`;
    };

    // Generar contenido ZPL
    let contenido = '';
    const paresNecesarios = lote ? cantidad : Math.ceil(cantidadPar / 2);
    for (let i = 0; i < paresNecesarios; i++) {
      contenido += generarParEtiquetas(articulo, lote);
    }

    // Escribir archivo
    try {
      await fs.writeFile(nombreArchivo, contenido, { encoding: 'utf8' });
      console.log('Archivo ZPL creado exitosamente');
      
      // Verificar que el archivo existe y su tamaño
      const stats = await fs.stat(nombreArchivo);
      console.log('Tamaño del archivo:', stats.size, 'bytes');
      
      // Listar contenido del directorio
      const files = await fs.readdir(tempDir);
      console.log('Archivos en el directorio temporal:', files);
    } catch (err) {
      console.error('Error al escribir archivo:', err);
      throw new Error(`Error al escribir archivo: ${err.message}`);
    }

    // Enviar a impresora
    exec(`COPY /B "${nombreArchivo}" \\\\localhost\\${nombreImpresora}`, (error, stdout, stderr) => {
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
