const fs = require('fs');
const path = 'src/produccion/pages/pendientes-compra.html';

try {
    let content = fs.readFileSync(path, 'utf8');
    let modified = false;

    // Fix 1: Typo in toggleCliente
    if (content.includes("cisplay = 'none'")) {
        content = content.replace("cisplay = 'none'", "contenido.style.display = 'none'");
        console.log("Fixed 'cisplay' typo.");
        modified = true;
    }

    // Fix 2: Malformed console.log in imprimirPendiente
    // The broken line looks like: console.log(`📄 [IMPRIMIR-PENDIENTE] Cliente: ${clienteILocal: ${idPresupuestoLocal}, Ext: ${idPresupuestoExt});
    // We will look for a substring that identifies it uniquely.
    const brokenLogPart = "Cliente: ${clienteILocal";
    console.log("Looking for broken log part:", brokenLogPart);

    // We'll replace the whole line if we find a rough match.
    // Finding the start of the line "console.log" and the end ");"
    const logIdx = content.indexOf(brokenLogPart);
    if (logIdx !== -1) {
        // Find start of this line (approx)
        const lineStart = content.lastIndexOf("console.log", logIdx);
        const lineEnd = content.indexOf(");", logIdx);

        if (lineStart !== -1 && lineEnd !== -1) {
            const badLine = content.substring(lineStart, lineEnd + 2);
            const goodLine = "console.log(`📄 [IMPRIMIR-PENDIENTE] Cliente: ${clienteId}, Presupuesto Local: ${idPresupuestoLocal}, Ext: ${idPresupuestoExt}`);";
            content = content.replace(badLine, goodLine);
            console.log("Fixed malformed console.log in imprimirPendiente.");
            modified = true;
        } else {
            console.log("Could not isolate bad line boundaries.");
        }
    } else {
        console.log("Broken log part not found. Maybe different?");
    }

    // Fix 3: Malformed comment "/ 1. Marcar"
    if (content.includes("/ 1. Marcar")) {
        // Check if it's already Correct "// 1. Marcar"
        if (!content.includes("// 1. Marcar")) {
            content = content.replace("/ 1. Marcar", "// 1. Marcar");
            console.log("Fixed comment syntax.");
            modified = true;
        }
    }

    if (modified) {
        fs.writeFileSync(path, content, 'utf8');
        console.log("Success: File syntax errors repaired.");
    } else {
        console.log("No changes made. File might be already fixed or patterns didn't match.");
    }

} catch (err) {
    console.error("Error:", err);
    process.exit(1);
}
