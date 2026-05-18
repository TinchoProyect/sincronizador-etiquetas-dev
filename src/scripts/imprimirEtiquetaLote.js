const fs = require('fs').promises;
const fsSync = require('fs');
const { exec } = require('child_process');
const path = require('path');

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

    // Leer datos del archivo JSON temporal
    console.log('Leyendo archivo JSON:', jsonPath);
    const jsonContent = await fs.readFile(jsonPath, 'utf8');
    const datos = JSON.parse(jsonContent);
    console.log('Datos del lote parseados:', datos);

    const idCorto = datos.id_corto;
    const descripcion = datos.descripcion || 'S/D';

    // Directorio temporal en app-etiquetas
    const tempDir = path.resolve(__dirname, '../app-etiquetas/temp');
    
    // Crear directorio temporal si no existe
    try {
      await fs.mkdir(tempDir, { recursive: true });
    } catch (err) {}

    const nombreArchivo = path.join(tempDir, `etiqueta_lote_${Date.now()}.zpl`);
    const nombreImpresora = 'Zebra';
    
    // Imprimimos por duplicado en el mismo papel para aprovechar el ancho (Zebra imprime doble)
    const cantidadPar = cantidad % 2 === 0 ? cantidad : cantidad + 1;

    const generarParEtiquetasLote = (id, desc) => {
      // Ajuste de fuente según el largo de la descripción
      let fuenteDescripcion = '^CF0,30'; // fuente grande por defecto
      if (desc.length > 30) {
        fuenteDescripcion = '^CF0,20'; // fuente chica
      } else if (desc.length > 20) {
        fuenteDescripcion = '^CF0,25'; // fuente mediana
      }

      // Diseño térmico
      // Arriba: Descripción del producto.
      // Centro: El ID corto del lote en formato de Código de Barras grande
      // Abajo: El texto legible del ID corto del lote.

      const etiqueta1 = `${fuenteDescripcion}
^FO23,20^FD${desc}^FS
^BY3,2,60
^FO23,70^BCN,60,N,N,N
^FD${id}^FS
^CF0,25
^FO120,140^FDLOTE: ${id}^FS`;

      const etiqueta2 = `${fuenteDescripcion}
^FO443,20^FD${desc}^FS
^BY3,2,60
^FO443,70^BCN,60,N,N,N
^FD${id}^FS
^CF0,25
^FO540,140^FDLOTE: ${id}^FS`;

      return `^XA
^LH0,0
^LT0
${etiqueta1}
${etiqueta2}
^XZ`;
    };

    let contenido = '';
    const paresNecesarios = Math.ceil(cantidadPar / 2);
    for (let i = 0; i < paresNecesarios; i++) {
      contenido += generarParEtiquetasLote(idCorto, descripcion);
    }

    // Escribir archivo ZPL
    await fs.writeFile(nombreArchivo, contenido, { encoding: 'utf8' });
    console.log('Archivo ZPL creado exitosamente:', nombreArchivo);

    // Enviar a impresora
    exec(`COPY /B "${nombreArchivo}" \\\\localhost\\${nombreImpresora}`, (error, stdout, stderr) => {
      // Limpiar archivo temporal ZPL después de enviarlo a la impresora
      try {
        if (fsSync.existsSync(nombreArchivo)) fsSync.unlinkSync(nombreArchivo);
      } catch(e) {}

      if (error) {
        console.error(`Error al imprimir lote: ${error.message}`);
        process.exit(1);
      }
      console.log('Impresión de lote enviada correctamente a Zebra.');
    });

  } catch (error) {
    console.error('Error en el proceso de impresión de lote:', error.message);
    process.exit(1);
  }
}

main();
