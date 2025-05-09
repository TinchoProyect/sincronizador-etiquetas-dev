const fs = require('fs');
const { exec } = require('child_process');
const path = require('path');

function generarParEtiquetas({ textoPrincipal, textoSecundario, textoAdicional }) {
  // Configuración de fuentes según importancia
  const fuentePrincipal = '^CF0,80';    // Fuente más grande para texto principal
  const fuenteSecundaria = '^CF0,30';   // Fuente mediana para texto secundario
  const fuenteAdicional = '^CF0,20';    // Fuente pequeña para texto adicional

  // Calcular posiciones verticales
  let posY1 = 40;  // Posición inicial para texto principal (ajustada para texto más grande)
  let posY2 = 120; // Posición inicial para texto secundario (ajustada)
  let posY3 = 160; // Posición inicial para texto adicional (ajustada)

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

  // Generar etiqueta derecha (ajustada 10 puntos a la izquierda)
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

  // Retornar el ZPL completo para el par de etiquetas
  return `^XA
^LH0,0
^LT0
${etiqueta1}
${etiqueta2}
^XZ`;
}

// Procesar argumentos de línea de comando
const datos = JSON.parse(process.argv[2]);
const cantidad = parseInt(process.argv[3], 10) || 2; // Default a 2 si no es válido
const cantidadPar = cantidad % 2 === 0 ? cantidad : cantidad + 1;

// Validar cantidad
if (isNaN(cantidad) || cantidad < 2) {
  console.error('Cantidad inválida. Usando valor por defecto: 2');
}

// Generar contenido ZPL
let contenido = '';
const paresDeEtiquetas = cantidadPar / 2; // Convertir a pares ya que cada generación produce 2 etiquetas
for (let i = 0; i < paresDeEtiquetas; i++) {
  contenido += generarParEtiquetas(datos);
}

// Escribir archivo ZPL
const tempDir = path.join('app-etiquetas', 'temp');
if (!fs.existsSync(tempDir)) {
  fs.mkdirSync(tempDir);
}
const nombreArchivo = path.join('app-etiquetas', 'temp', 'etiqueta_texto.zpl');
fs.writeFileSync(nombreArchivo, contenido);

// Enviar a la impresora
const nombreImpresora = 'Zebra';
exec(`COPY /B "${nombreArchivo}" \\\\localhost\\${nombreImpresora}`, (error, stdout, stderr) => {
  if (error) {
    console.error(`Error al imprimir: ${error.message}`);
    process.exit(1);
  }
  console.log('Impresión enviada correctamente.');
});
