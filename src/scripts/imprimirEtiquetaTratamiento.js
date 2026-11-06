const fs = require('fs').promises;
const fsSync = require('fs');
const path = require('path');
const { despacharZplAZebra } = require('../services/zebraPrintBridgeService');

function generarParEtiquetasTratamiento(etiquetaIzq, etiquetaDer) {
  const encabezadoZPL = '^XA^CI28';
  const fuenteFechas = '^CF0,40';
  const fuenteTitulos = '^CF0,25';
  const fuentePaginacion = '^CF0,30';
  const fuenteDetalles = '^CF0,20';

  const generarMitad = (datos, offsetX) => {
    if (!datos) return ''; // Mitad en blanco si es impar

    let nombreCorto = datos.item_nombre || '';
    if (nombreCorto.length > 35) {
      nombreCorto = nombreCorto.substring(0, 35) + '...';
    }

    return `${fuenteFechas}
^FO${offsetX},20^FD${datos.fecha_sellado || ''}^FS
${fuentePaginacion}
^FO${offsetX},70^FDBulto ${datos.bulto_actual} de ${datos.bultos_totales}^FS
${fuenteTitulos}
^FO${offsetX},115^FB380,2,0,L^FD${nombreCorto}^FS
${fuenteDetalles}
^FO${offsetX},170^FB380,1,0,L^FD${datos.cantidad_text || ''}^FS
^CF0,18
^FO${offsetX + 200},25^FD${(datos.tipo_tratamiento || '').substring(0, 25)}^FS
^CF0,18
^FO${offsetX + 200},50^FDResp: ${(datos.responsable || '').substring(0, 12)}^FS`;
  };

  const izq = generarMitad(etiquetaIzq, 23);
  const der = generarMitad(etiquetaDer, 443);

  return `${encabezadoZPL}
^LH0,0
^LT0
${izq}
${der}
^XZ`;
}

async function imprimirEtiquetaTratamiento(etiquetasMatrizOrDatos) {
  const matriz = Array.isArray(etiquetasMatrizOrDatos)
    ? etiquetasMatrizOrDatos
    : [etiquetasMatrizOrDatos];

  let contenido = '';
  for (let i = 0; i < matriz.length; i += 2) {
    const izq = matriz[i];
    const der = (i + 1 < matriz.length) ? matriz[i + 1] : null;
    contenido += generarParEtiquetasTratamiento(izq, der);
  }

  return despacharZplAZebra({
    zplContent: contenido,
    tipoEtiqueta: 'ETIQUETA_TRATAMIENTO',
    descripcion: `Tratamiento (${matriz.length} bultos): ${matriz[0]?.item_nombre || matriz[0]?.nombre || ''}`,
    nombreImpresora: 'Zebra'
  });
}

async function main() {
  try {
    const tempDir = path.resolve(__dirname, '../app-etiquetas/temp');
    const jsonPath = path.join(tempDir, 'temp-tratamiento.json');

    const jsonContent = await fs.readFile(jsonPath, 'utf8');
    const etiquetasMatriz = JSON.parse(jsonContent);

    if (!Array.isArray(etiquetasMatriz) || etiquetasMatriz.length === 0) {
      console.log('No hay etiquetas para imprimir.');
      process.exit(0);
    }

    try {
      await fs.mkdir(tempDir, { recursive: true });
    } catch (_) {}

    let contenido = '';
    for (let i = 0; i < etiquetasMatriz.length; i += 2) {
      const izq = etiquetasMatriz[i];
      const der = (i + 1 < etiquetasMatriz.length) ? etiquetasMatriz[i + 1] : null;
      contenido += generarParEtiquetasTratamiento(izq, der);
    }

    const nombreArchivo = path.join(tempDir, 'etiqueta_tratamiento.zpl');
    await fs.writeFile(nombreArchivo, contenido, { encoding: 'utf8' });

    const nombreImpresora = 'Zebra';
    try {
      await despacharZplAZebra({
        zplContent: contenido,
        zplFilePath: nombreArchivo,
        tipoEtiqueta: 'ETIQUETA_TRATAMIENTO',
        descripcion: `Tratamiento (${etiquetasMatriz.length} bultos): ${etiquetasMatriz[0]?.item_nombre || ''}`,
        nombreImpresora
      });
      console.log(`Etiquetas de Tratamiento (Total: ${etiquetasMatriz.length}) enviadas a Zebra.`);
    } finally {
      try {
        if (fsSync.existsSync(nombreArchivo)) fsSync.unlinkSync(nombreArchivo);
      } catch (_) {}
    }
  } catch (error) {
    console.error('Error en el script de tratamientos:', error.message);
    process.exit(1);
  }
}

if (require.main === module) {
  main();
}

module.exports = {
  main,
  generarParEtiquetasTratamiento,
  imprimirEtiquetaTratamiento
};
