const fs = require('fs').promises;
const fsSync = require('fs');
const { exec } = require('child_process');
const path = require('path');

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

    const { articulo_id, descripcion_generada, codigo_barras, lote_id, lote_codigo_corto } = datos;

    const tempDir = path.dirname(jsonPath);
    const nombreArchivo = path.join(tempDir, `etiqueta-bunker-${Date.now()}.zpl`);
    console.log('[PRINT-BUNKER] Generando archivo ZPL:', nombreArchivo);

    const nombreImpresora = 'Zebra';
    const cantidadPar = cantidad % 2 === 0 ? cantidad : cantidad + 1;

    const generarParEtiquetas = () => {
      // Ajuste dinámico de tamaño de fuente para la descripción comercial
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
        // Lote activo: dibujar código de barras lineal Code 128 (sin texto abajo para evitar duplicados)
        barcodeZplRight = `^BY2,2,40
^FO443,55^BCN,65,N,N,N
^FD${loteImprimir}^FS`;
        textSecondaryRight = `^CF0,25
^FO443,20^FDL: ${loteImprimir}^FS`;
      } else {
        // Sin lote: texto de advertencia
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
    };

    let contenido = '';
    const paresNecesarios = Math.ceil(cantidadPar / 2);
    for (let i = 0; i < paresNecesarios; i++) {
      contenido += generarParEtiquetas();
    }

    await fs.writeFile(nombreArchivo, contenido, { encoding: 'utf8' });
    console.log('[PRINT-BUNKER] Archivo ZPL escrito con éxito.');

    // Enviar a la impresora Zebra (COPY /B)
    const copyCmd = `COPY /B "${nombreArchivo}" \\\\localhost\\${nombreImpresora}`;
    console.log(`[PRINT-BUNKER] Ejecutando comando de impresión: ${copyCmd}`);
    
    exec(copyCmd, (error, stdout, stderr) => {
      // Limpieza del archivo ZPL creado
      try {
        if (fsSync.existsSync(nombreArchivo)) {
          fsSync.unlinkSync(nombreArchivo);
          console.log('[PRINT-BUNKER] Archivo ZPL temporal eliminado.');
        }
      } catch (e) {
        console.error("[PRINT-BUNKER] Error borrando ZPL temporal:", e);
      }

      if (error) {
        console.error(`[PRINT-BUNKER] Error al imprimir en Zebra: ${error.message}`);
        process.exit(1);
      }
      console.log('[PRINT-BUNKER] Impresión enviada a la impresora Zebra con éxito.');
      process.exit(0);
    });

  } catch (error) {
    console.error('[PRINT-BUNKER] Error en el proceso de impresión:', error.message);
    process.exit(1);
  }
}

main();
