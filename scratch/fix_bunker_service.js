const fs = require('fs');

const filePath = 'C:/Users/Martin/Documents/sincronizador-etiquetas - copia/src/logistica/services/bunkerService.js';
console.log('Modifying:', filePath);

if (!fs.existsSync(filePath)) {
    console.error('File not found:', filePath);
    process.exit(1);
}

let code = fs.readFileSync(filePath, 'utf8');

// Normalize line endings to LF for safe manipulation
const hasCrlf = code.includes('\r\n');
code = code.replace(/\r\n/g, '\n');

const target = `* COALESCE((SELECT kilos_unidad FROM public.bunker_articulos WHERE articulo_id = la.articulo_numero), 1.00)`;
const replacement = `* (SELECT CASE WHEN COALESCE(kilos_unidad, 0) > 0 THEN kilos_unidad ELSE 1.00 END FROM public.bunker_articulos WHERE articulo_id = la.articulo_numero)`;

if (code.includes(target)) {
    // Replace all occurrences of target
    let count = 0;
    while (code.includes(target)) {
        code = code.replace(target, replacement);
        count++;
    }
    console.log(`Replaced ${count} occurrences of kilos_unidad calculation.`);
} else {
    console.error('Target query pattern not found in bunkerService.js!');
}

// Convert back to CRLF if required
if (hasCrlf) {
    code = code.replace(/\n/g, '\r\n');
}

fs.writeFileSync(filePath, code, 'utf8');
console.log('Finished modifying bunkerService.js.');
