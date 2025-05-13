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

    const generarParEtiquetas = (datos) => {
      const { nombre, numero, codigo_barras, fechas } = datos;
      let fuenteDescripcion = '^CF0,40'; // fuente grande por defecto

      if (nombre.length > 30) {
        fuenteDescripcion = '^CF0,25'; // fuente más chica
      } else if (nombre.length > 20) {
        fuenteDescripcion = '^CF0,30'; // fuente mediana
      }

      // Ajustar altura del código de barras si hay fechas
      const alturaCodigoBarras = fechas ? 60 : 80;
      
      // Generar línea de fechas si están presentes
      let lineaFechas = '';
      if (fechas) {
        lineaFechas = `\n^CF0,20
^FO23,70^FDENV: ${fechas.elaboracion}  VTO: ${fechas.vencimiento}^FS
^FO443,70^FDENV: ${fechas.elaboracion}  VTO: ${fechas.vencimiento}^FS`;
      }

      const etiqueta1 = `${fuenteDescripcion}
^FO23,10^FD${nombre}^FS
^CF0,20
^FO23,45^FD${numero}^FS
^BY2,2,40
^FO23,90^BCN,${alturaCodigoBarras},Y,N,N
^FD${codigo_barras}^FS`;

      const etiqueta2 = `${fuenteDescripcion}
^FO443,10^FD${nombre}^FS
^CF0,20
^FO443,45^FD${numero}^FS
^BY2,2,40
^FO443,90^BCN,${alturaCodigoBarras},Y,N,N
^FD${codigo_barras}^FS`;

      return `^XA
^LH0,0
^LT0
${etiqueta1}
${etiqueta2}${lineaFechas}
^XZ`;
    };

    // Generar contenido ZPL
    let contenido = '';
    const paresNecesarios = Math.ceil(cantidadPar / 2);
    for (let i = 0; i < paresNecesarios; i++) {
      contenido += generarParEtiquetas(articulo);
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
