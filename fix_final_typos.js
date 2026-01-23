const fs = require('fs');
const path = 'src/produccion/pages/pendientes-compra.html';

try {
    let content = fs.readFileSync(path, 'utf8');
    let modified = false;

    // Fix garbled console.log at line 666
    // Pattern: "consoog" or "Recargando acordeones"
    if (content.includes("consoog")) {
        console.log("Found 'consoog' corruption.");
        // We'll replace the line containing 'Recargando acordeones' to be safe
        const lines = content.split('\n');
        const newLines = lines.map(line => {
            if (line.includes("Recargando acordeones") && (line.includes("consoog") || !line.trim().startsWith("console.log"))) {
                console.log("Fixing line:", line.trim());
                return `                    console.log(\`🔄 [IMPRIMIR-PENDIENTE] Recargando acordeones...\`);`;
            }
            return line;
        });
        content = newLines.join('\n');
        modified = true;
    }

    if (modified) {
        fs.writeFileSync(path, content, 'utf8');
        console.log("Success: File fixed.");
    } else {
        console.log("No 'consoog' corruption found (or already fixed).");
    }

} catch (err) {
    console.error("Error:", err);
    process.exit(1);
}
