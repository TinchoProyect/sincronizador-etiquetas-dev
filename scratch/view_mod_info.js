const fs = require('fs');

const modPath = 'C:/Users/Martin/Documents/sincronizador-etiquetas - copia/scratch/html_modifications.txt';
if (fs.existsSync(modPath)) {
    const stats = fs.statSync(modPath);
    console.log('File size:', stats.size);
    const content = fs.readFileSync(modPath, 'utf8');
    console.log('File content preview (first 1000 chars):');
    console.log(content.substring(0, 1000));
} else {
    console.log('File not found!');
}
