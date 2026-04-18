const fs = require('fs');
let content = fs.readFileSync('src/produccion/js/ingredientes.js', 'utf8');
if (content.includes('\\n')) {
    content = content.replace(/\\n/g, '\n');
    fs.writeFileSync('src/produccion/js/ingredientes.js', content, 'utf8');
    console.log('Restored \\n correctly.');
} else {
    console.log('No literal \\n found.');
}
