const fs = require('fs');
const path = require('path');
const { despacharZplAZebra } = require('../services/zebraPrintBridgeService');

async function imprimirEtiquetaIngredienteLote(datos) {
    console.log('🖨️ Datos recibidos para etiqueta de lote de ingrediente:', datos);
    const {
        nombre,
        codigo,
        sectorLetra,
        lote,
        fechaVencimiento,
        fechaElaboracion,
        peso,
        importador,
        origen,
        cantidad = 1
    } = datos;

    if (!nombre || !codigo || !lote || !fechaVencimiento) {
        throw new Error('Faltan datos obligatorios (nombre, codigo, lote, fechaVencimiento) para imprimir la etiqueta.');
    }

    function dividirTexto(texto, maxLinea = 22) {
        const palabras = texto.trim().split(/\s+/);
        let linea1 = '';
        let linea2 = '';

        for (const palabra of palabras) {
            if ((linea1 + ' ' + palabra).trim().length <= maxLinea) {
                linea1 = (linea1 + ' ' + palabra).trim();
            } else if ((linea2 + ' ' + palabra).trim().length <= maxLinea) {
                linea2 = (linea2 + ' ' + palabra).trim();
            } else {
                break;
            }
        }
        return [linea1, linea2];
    }

    const [linea1, linea2] = dividirTexto(nombre, 20);
    const letra = sectorLetra || '-';

    const formatFecha = (fechaStr) => {
        if (!fechaStr) return '';
        const partes = fechaStr.split('-');
        if (partes.length === 3) {
            return `${partes[2]}/${partes[1]}/${partes[0]}`;
        }
        return fechaStr;
    };

    const vtoFormateado = formatFecha(fechaVencimiento);
    const elabFormateado = formatFecha(fechaElaboracion);

    let zpl = `
^XA
^CI28
^PW650
^LL320
^LH20,15

^FX --- SECCIÓN SUPERIOR IZQUIERDA: NOMBRE DEL INGREDIENTE ---
^FO10,5^A0N,34,34^FB450,1,0,L^FD${linea1}^FS
`;

    if (linea2) {
        zpl += `^FO10,42^A0N,30,30^FB450,1,0,L^FD${linea2}^FS\n`;
    }

    zpl += `^FO10,78^GB450,2,2^FS\n`;
    zpl += `^FO10,88^A0N,26,26^FDLOTE: ${lote}^FS\n`;
    zpl += `^FO250,88^A0N,28,28^FDVTO: ${vtoFormateado}^FS\n`;

    let yActual = 120;

    if (elabFormateado || peso) {
        let lineaExtra1 = '';
        if (elabFormateado) lineaExtra1 += `ELAB: ${elabFormateado}   `;
        if (peso) lineaExtra1 += `PESO: ${peso} Kg`;
        zpl += `^FO10,${yActual}^A0N,22,22^FD${lineaExtra1.trim()}^FS\n`;
        yActual += 26;
    }

    if (origen || importador) {
        let lineaExtra2 = '';
        if (origen) lineaExtra2 += `ORIG: ${origen}   `;
        if (importador) lineaExtra2 += `IMP: ${importador}`;
        if (lineaExtra2.length > 45) lineaExtra2 = lineaExtra2.substring(0, 45) + '...';
        zpl += `^FO10,${yActual}^A0N,20,20^FD${lineaExtra2.trim()}^FS\n`;
    }

    zpl += `
^FX --- SECCIÓN SUPERIOR DERECHA: LETRA DEL SECTOR DESTACADA ---
^FO480,5^GB120,105,105^FS
^FO480,18^FR^A0N,85,85^FB120,1,0,C^FD${letra}^FS

^FX --- SECCIÓN INFERIOR: CÓDIGO DE BARRAS ---
^FO80,175^BY3,2,75
^BCN,75,N,N,N
^FD${codigo}^FS

^FO0,260^A0N,28,28^FB600,1,0,C^FD${codigo}^FS

^PQ${cantidad},0,1,Y
^XZ
`.trim();

    const nombreArchivo = path.join(__dirname, `../../temp_ing_lote_${Date.now()}.zpl`);
    fs.writeFileSync(nombreArchivo, zpl, 'utf8');

    return despacharZplAZebra({
        zplContent: zpl,
        zplFilePath: nombreArchivo,
        tipoEtiqueta: 'ETIQUETA_INGREDIENTE_LOTE',
        descripcion: `Lote Ingrediente (${cantidad}x): ${nombre} Lote ${lote} [${codigo}]`,
        nombreImpresora: 'Zebra'
    });
}

module.exports = { imprimirEtiquetaIngredienteLote };
