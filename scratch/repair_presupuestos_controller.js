const fs = require('fs');

const filePath = 'C:/Users/Martin/Documents/sincronizador-etiquetas - copia/src/presupuestos/controllers/presupuestos.js';
console.log('Modifying:', filePath);

if (!fs.existsSync(filePath)) {
    console.error('File not found:', filePath);
    process.exit(1);
}

let code = fs.readFileSync(filePath, 'utf8');

// Normalize line endings to LF
const hasCrlf = code.includes('\r\n');
code = code.replace(/\r\n/g, '\n');

// 1. Fix barcode push
code = code.replace(
    "whereParts.push(`${barcodeField} = ${p}`);",
    "whereParts.push(barcodeField + ' = $' + p);"
);

// 2. Fix token map placeholder
code = code.replace(
    "const ph = `${p}`;",
    "const ph = '$' + p;"
);

// 3. Fix params percentage wrapper
code = code.replace(
    "params.push(`%${t}%`);",
    "params.push('%' + t + '%');"
);

// 4. Fix clientPId inside the SQL query template literal
code = code.replace(
    "bc.lomas_soft_id = ${clientPId}",
    "bc.lomas_soft_id = $${clientPId}"
);

// 5. Fix LIMIT inside the SQL query template literal
code = code.replace(
    "LIMIT ${p + 1}",
    "LIMIT $${p + 1}"
);

// Convert back to CRLF if required
if (hasCrlf) {
    code = code.replace(/\n/g, '\r\n');
}

fs.writeFileSync(filePath, code, 'utf8');
console.log('Finished repairing presupuestos.js.');
