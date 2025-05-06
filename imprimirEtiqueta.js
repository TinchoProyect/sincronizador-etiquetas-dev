const fs = require('fs');
const { exec } = require('child_process');
const path = require('path');

let articulo;
let cantidad;

try {
  if (process.argv.length < 4) {
    throw new Error('Faltan argumentos: datos JSON y cantidad');
  }
  const datos = JSON.parse(process.argv[2]);
  articulo = datos.articulo || datos; // Si no viene como datos.articulo, usar datos directamente
  cantidad = parseInt(process.argv[3], 10);
  fechas = datos.fechas || null;
  if (isNaN(cantidad) || cantidad < 1) {
    throw new Error('Cantidad inválida');
  }
} catch (error) {
  console.error('Error al procesar argumentos:', error.message);
  process.exit(1);
}

const nombreArchivo = path.join('app-etiquetas', 'etiqueta.zpl');
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
  const alturaCodigoBarras = fechas ? 60 : 80; // Reducir altura general y cuando hay fechas
  
  // Generar línea de fechas si están presentes
  let lineaFechas = '';
  if (fechas) {
    lineaFechas = `\n^CF0,20
^FO15,70^FDENV: ${fechas.elaboracion}  VTO: ${fechas.vencimiento}^FS
^FO435,70^FDENV: ${fechas.elaboracion}  VTO: ${fechas.vencimiento}^FS`;
  }

  const etiqueta1 = `${fuenteDescripcion}
^FO15,10^FD${nombre}^FS
^CF0,20
^FO15,45^FD${numero}^FS
^BY2,2,40
^FO15,90^BCN,${alturaCodigoBarras},Y,N,N
^FD${codigo_barras}^FS`;

  const etiqueta2 = `${fuenteDescripcion}
^FO435,10^FD${nombre}^FS
^CF0,20
^FO435,45^FD${numero}^FS
^BY2,2,40
^FO435,90^BCN,${alturaCodigoBarras},Y,N,N
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
const paresNecesarios = Math.ceil(cantidadPar / 2); // Dividir entre 2 porque cada generación produce 2 etiquetas
for (let i = 0; i < paresNecesarios; i++) {
  contenido += generarParEtiquetas(articulo);
}

fs.writeFileSync(nombreArchivo, contenido);

exec(`COPY /B "${nombreArchivo}" \\\\localhost\\${nombreImpresora}`, (error, stdout, stderr) => {
  if (error) {
    console.error(`Error al imprimir: ${error.message}`);
    process.exit(1);
  }
  console.log('Impresión enviada correctamente.');
});