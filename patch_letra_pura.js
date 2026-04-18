const fs = require('fs');

let file = fs.readFileSync('src/produccion/js/ingredientes.js', 'utf8');

const regexViejo = /window\.extraerLetraPura = function\(descripcion\) \{[\s\S]*?return '';\s*\}/;

const nuevaFunc = `window.extraerLetraPura = function(descripcion) {
    if (!descripcion) return '';
    const texto = descripcion.replace(/["']/g, '').trim();
    if (!texto) return '';

    // Nivel 1: Regex permisivo que soporta errores como "Sectro G"
    const matchSector = texto.match(/Sect[a-z]*\\s+([A-Z0-9]{1,2})/i);
    if (matchSector) {
        return matchSector[1].toUpperCase();
    }

    // Nivel 2: Texto de longitud exacta (Ej: "G")
    if (texto.length > 0 && texto.length <= 2) {
        return texto.toUpperCase();
    }

    // Nivel 3: Aislado, una letra o 2 en el contexto de la oracion
    const matchLetra = texto.match(/\\b([A-Z0-9]{1,2})\\b/i);
    if (matchLetra) {
        return matchLetra[1].toUpperCase();
    }

    // Nivel 4: Ultima instancia, primer character de "Mix Salado" -> "M"
    return texto.charAt(0).toUpperCase();
}`;

if (file.match(regexViejo)) {
    file = file.replace(regexViejo, nuevaFunc);
    fs.writeFileSync('src/produccion/js/ingredientes.js', file, 'utf8');
    console.log('Script safely executed.');
} else {
    console.log('Could not find target to replace.');
}
