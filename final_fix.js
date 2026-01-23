const fs = require('fs');
const path = 'src/produccion/pages/pendientes-compra.html';

try {
    let content = fs.readFileSync(path, 'utf8');

    // 1. Fix the syntax error in togglePresupuesto
    // Look for the broken line: "const icon = header ? header.querySelector('.null;"
    const brokenLine = "const icon = header ? header.querySelector('.null;";
    const fixedLine = "const icon = header ? header.querySelector('.toggle-icon') : null;";

    if (content.includes(brokenLine)) {
        content = content.replace(brokenLine, fixedLine);
        console.log('Fixed syntax error in togglePresupuesto.');
    } else {
        console.log('Syntax error pattern not found (might be already fixed or different).');
        // Fallback: Force replace the whole function if needed, but let's try specific fix first.
    }

    // 2. Ensure "display: block" (Expanded) is set for client-content
    // The user wants to "Retrotraer", implies going back to expanded state.
    const collapsedStyle = 'display: none;';
    const expandedStyle = 'display: block;';

    // We target the specific line in the template literal
    // <div id="cli-${cliente.id}" class="cliente-content" style="display: none;">

    if (content.includes(collapsedStyle)) {
        content = content.replace(new RegExp('style="display: none;"', 'g'), 'style="display: block;"');
        console.log('Reverted to Expanded Accordions (display: block).');
    } else {
        console.log('Accordions might already be expanded or pattern matches display: block.');
    }

    fs.writeFileSync(path, content, 'utf8');
    console.log('Success: File patched.');

} catch (err) {
    console.error('Error:', err);
    process.exit(1);
}
