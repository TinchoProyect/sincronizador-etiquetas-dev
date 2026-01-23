const fs = require('fs');
const path = 'src/produccion/pages/pendientes-compra.html';

try {
    let content = fs.readFileSync(path, 'utf8');

    // Look for the pattern where the brace is missing
    // return;
    // try {

    // We use a regex that matches "return;" followed by optional whitespace/newlines and then "try {"
    const regex = /(return;)(\s+)(try \{)/;

    if (regex.test(content)) {
        // Replace with:
        // return;
        // }
        // try {
        content = content.replace(regex, '$1\n            }$2$3');
        console.log("Fixed missing closing brace '}' before 'try'.");
        fs.writeFileSync(path, content, 'utf8');
        console.log("Success: File patched.");
    } else {
        console.log("Pattern not found. File might be already fixed.");
    }

} catch (err) {
    console.error("Error:", err);
    process.exit(1);
}
