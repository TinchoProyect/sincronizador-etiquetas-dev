 crear:', nombreArchivo);

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