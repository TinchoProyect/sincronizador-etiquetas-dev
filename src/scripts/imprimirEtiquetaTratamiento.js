const fs = require('fs');
const path = require('path');
const { despacharZplAZebra } = require('../services/zebraPrintBridgeService');

async function imprimirEtiquetaTratamiento(datos) {
    console.log('🖨️ Datos recibidos para etiqueta de TRATAMIENTO:', datos);
    const {
        nombre,
        fechaInicio,
        fechaFin,
        kilos,
        operador,
        cantidad = 1
    } = datos;

    if (!nombre || !fechaInicio || !fechaFin) {
        throw new Error('Faltan datos obligatorios (nombre, fechaInicio, fechaFin) para imprimir la etiqueta de tratamiento.');
    }

    function dividirTexto(texto, maxLinea = 26) {
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

    const [linea1, linea2] = dividirTexto(nombre.toUpperCase(), 26);

    const formatFecha = (fechaStr) => {
        if (!fechaStr) return '';
        const partes = fechaStr.split('-');
        if (partes.length === 3) {
            return `${partes[2]}/${partes[1]}/${partes[0]}`;
        }
        return fechaStr;
    };

    const inicioFormateado = formatFecha(fechaInicio);
    const finFormateado = formatFecha(fechaFin);

    let zpl = `
^XA
^CI28
^PW650
^LL320
^LH20,15

^FX --- ENCABEZADO DESTACADO (INVERSO NEGRO) ---
^FO10,0^GB590,45,45^FS
^FO10,8^FR^A0N,32,32^FB590,1,0,C^FDEN TRATAMIENTO (FREEZER)^FS

^FX --- NOMBRE DE LA MERCADERÍA ---
^FO10,55^A0N,34,34^FB590,1,0,C^FD${linea1}^FS
`;

    if (linea2) {
        zpl += `^FO10,92^A0N,30,30^FB590,1,0,C^FD${linea2}^FS\n`;
    }

    zpl += `^FO10,128^GB590,3,3^FS\n`;
    zpl += `^FO15,142^A0N,28,28^FDINICIO: ${inicioFormateado}^FS\n`;
    zpl += `^FO310,142^A0N,28,28^FDFIN: ${finFormateado}^FS\n`;

    zpl += `^FO10,180^GB590,55,2^FS\n`;
    zpl += `^FO15,194^A0N,32,32^FB580,1,0,C^FDLIBERAR EL: ${finFormateado}^FS\n`;

    let pieTexto = '';
    if (kilos) pieTexto += `CANT: ${kilos} Kg`;
    if (operador) {
        if (pieTexto) pieTexto += '   |   ';
        pieTexto += `RESP: ${operador.toUpperCase()}`;
    }

    if (pieTexto) {
        zpl += `^FO10,250^A0N,26,26^FB590,1,0,C^FD${pieTexto}^FS\n`;
    }

    zpl += `
^PQ${cantidad},0,1,Y
^XZ
`.trim();

    const nombreArchivo = path.join(__dirname, `../../temp_trat_${Date.now()}.zpl`);
    fs.writeFileSync(nombreArchivo, zpl, 'utf8');

    return despacharZplAZebra({
        zplContent: zpl,
        zplFilePath: nombreArchivo,
        tipoEtiqueta: 'ETIQUETA_TRATAMIENTO',
        descripcion: `Tratamiento Freezer (${cantidad}x): ${nombre} (Liberar ${finFormateado})`,
        nombreImpresora: 'Zebra'
    });
}

module.exports = { imprimirEtiquetaTratamiento };
