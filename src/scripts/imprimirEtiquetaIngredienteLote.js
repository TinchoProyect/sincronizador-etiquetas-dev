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

    console.log(`[PRINT-INGREDIENTE-LOTE] Leyendo archivo JSON de datos temporales: ${jsonPath}`);
    const jsonContent = await fs.readFile(jsonPath, 'utf8');
    const datos = JSON.parse(jsonContent);
    console.log('[PRINT-INGREDIENTE-LOTE] Datos leídos:', datos);

    let { nombre, codigo, sector, lote_id, lote_codigo_corto, factor_pack } = datos;
    let factorNum = parseFloat(factor_pack);

    // Fallback en caliente: si el servidor en memoria aún no envió factor_pack, consultarlo de bunker_lotes_destinos
    if ((isNaN(factorNum) || factorNum <= 0) && (lote_id || lote_codigo_corto)) {
      try {
        const { pool } = require('../logistica/config/database');
        const resDest = await pool.query(`
          SELECT d.cantidad_asignada, d.kilos_asignados
          FROM public.bunker_lotes_destinos d
          JOIN public.bunker_lotes_vinculos v ON d.vinculo_id = v.id
          LEFT JOIN public.ingredientes i ON d.destino_id = i.id::text
          WHERE (v.lote_id_supabase = $1 OR v.lote_codigo_corto = $2)
            AND d.tipo_destino = 'INGREDIENTE_PRODUCCION'
            AND ($3 = '' OR i.codigo::text = $3 OR i.nombre = $4)
          ORDER BY d.id DESC
          LIMIT 1
        `, [lote_id || '', lote_codigo_corto || '', String(codigo || ''), String(nombre || '')]);
        if (resDest.rows.length > 0) {
          const cAsig = parseFloat(resDest.rows[0].cantidad_asignada || 0);
          const kAsig = parseFloat(resDest.rows[0].kilos_asignados || 0);
          if (cAsig > 0 && kAsig > 0) {
            factorNum = kAsig / cAsig;
          }
        }
      } catch (dbErr) {
        console.warn('[PRINT-INGREDIENTE-LOTE] No se pudo consultar factor_pack en fallback:', dbErr.message);
      }
    }

    if (!isNaN(factorNum) && factorNum > 1) {
      const factorStr = factorNum % 1 === 0 ? factorNum.toFixed(0) : factorNum.toFixed(2);
      nombre = (nombre || 'Sin Descripción').trim();
      const matchPorUno = nombre.match(/^(.*?)\s+(x\s*1(?:\s*(?:u|un|unid|unidad|unidades|kg|kilos))?)\s*$/i);
      const esTerceraDimension = matchPorUno && /\d+\s*x\s*\d+\s*$/i.test(matchPorUno[1]) && !/\d+\s*x\s*\d+\s*x\s*\d+\s*$/i.test(matchPorUno[1]);
      if (matchPorUno && !esTerceraDimension) {
        nombre = `${matchPorUno[1]} x ${factorStr}`;
      } else {
        const regexYaTiene = new RegExp(`(\\bx\\s*${factorStr}|\\(x\\s*${factorStr}\\))\\s*$`, 'i');
        if (!regexYaTiene.test(nombre)) {
          nombre = `${nombre} x ${factorStr}`;
        }
      }
    }

    const factorSuffix = (!isNaN(factorNum) && factorNum > 1)
      ? ` (x${factorNum % 1 === 0 ? factorNum.toFixed(0) : factorNum.toFixed(2)})`
      : '';

    const tempDir = path.dirname(jsonPath);
    const nombreArchivo = path.join(tempDir, `etiqueta-ing-lote-${Date.now()}.zpl`);
    console.log('[PRINT-INGREDIENTE-LOTE] Generando archivo ZPL:', nombreArchivo);

    const nombreImpresora = 'Zebra';
    const cantidadPar = cantidad % 2 === 0 ? cantidad : cantidad + 1;

    const generarParEtiquetas = () => {
      // Ajuste dinámico de tamaño de fuente para el nombre del ingrediente
      let fuenteDescripcion = '^CF0,40';
      if (nombre.length > 34) {
        fuenteDescripcion = '^CF0,20';
      } else if (nombre.length > 26) {
        fuenteDescripcion = '^CF0,23';
      } else if (nombre.length > 20) {
        fuenteDescripcion = '^CF0,30';
      }

      // Etiqueta 1 (Izquierda): Ingrediente de Producción
      const etiqueta1 = `${fuenteDescripcion}
^FO23,15^FB400,2,2,L^FD${nombre}^FS
^BY2,2,40
^FO23,60^BCN,65,Y,N,N
^FD${codigo || '00000000'}^FS
${sector ? `^CF0,60^FO320,60^FD${sector}^FS` : ''}
^CF0,20
^FO23,160^FB400,1,0,C^FDINGREDIENTE DE PRODUCCION^FS`;

      // Etiqueta 2 (Derecha): Trazabilidad de Lote
      let barcodeZplRight = '';
      let textSecondaryRight = '';

      if (lote_codigo_corto) {
        barcodeZplRight = `^BY2,2,40
^FO443,55^BCN,65,N,N,N
^FD${lote_codigo_corto}^FS`;
        textSecondaryRight = `^CF0,25
^FO443,20^FDL: ${lote_codigo_corto}${factorSuffix}^FS`;
      } else {
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
    console.log('[PRINT-INGREDIENTE-LOTE] Archivo ZPL escrito con éxito.');

    // Enviar a la impresora Zebra (COPY /B)
    const copyCmd = `COPY /B "${nombreArchivo}" \\\\localhost\\${nombreImpresora}`;
    console.log(`[PRINT-INGREDIENTE-LOTE] Ejecutando comando de impresión: ${copyCmd}`);
    
    exec(copyCmd, (error, stdout, stderr) => {
      // Limpieza del archivo ZPL creado
      try {
        if (fsSync.existsSync(nombreArchivo)) {
          fsSync.unlinkSync(nombreArchivo);
          console.log('[PRINT-INGREDIENTE-LOTE] Archivo ZPL temporal eliminado.');
        }
      } catch (e) {
        console.error("[PRINT-INGREDIENTE-LOTE] Error borrando ZPL temporal:", e);
      }

      if (error) {
        console.error(`[PRINT-INGREDIENTE-LOTE] Error al imprimir en Zebra: ${error.message}`);
        process.exit(1);
      }
      console.log('[PRINT-INGREDIENTE-LOTE] Impresión enviada a la impresora Zebra con éxito.');
      process.exit(0);
    });

  } catch (error) {
    console.error('[PRINT-INGREDIENTE-LOTE] Error en el proceso de impresión:', error.message);
    process.exit(1);
  }
}

main();
