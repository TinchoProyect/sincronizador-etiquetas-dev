const fs = require('fs').promises;
const fsSync = require('fs');
const { exec } = require('child_process');
const path = require('path');

function generarParEtiquetas({ textoPrincipal, textoSecundario, textoAdicional }) {
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
    const jsonPath = path.join(tempDir, 'temp-texto.json');
    console.log('Leyendo archivo JSON:', jsonPath);
    
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
      contenido += generarParEtiquetas(datos);
    }

    // Escribir archivo
    const nombreArchivo = path.join(tempDir, 'etiqueta_texto.zpl');
    try {
      await fs.writeFile(nombreArchivo, contenido);
      console.log('Archivo ZPL creado exitosamente en:', nombreArchivo);
      
      // Verificar archivo
      const stats = await fs.stat(nombreArchivo);
      console.log('Tamaño del archivo:', stats.size, 'bytes');
      
      // Listar archivos
      const files = await fs.readdir(tempDir);
      console.log('Archivos en el directorio temporal:', files);
    } catch (err) {
      throw new Error(`Error al escribir archivo: ${err.message}`);
    }

    // Enviar a impresora
    const nombreImpresora = 'Zebra';
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
