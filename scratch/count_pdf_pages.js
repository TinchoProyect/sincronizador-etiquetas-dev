const fs = require('fs');
const path = require('path');

function countPages() {
    const pdfPath = path.join(__dirname, 'output_test.pdf');
    const content = fs.readFileSync(pdfPath, 'utf8');
    
    // Buscar ocurrencias de '/Type /Page'
    const matches = content.match(/\/Type\s*\/Page\b/g);
    console.log(`Número de páginas encontradas: ${matches ? matches.length : 0}`);
}
countPages();
