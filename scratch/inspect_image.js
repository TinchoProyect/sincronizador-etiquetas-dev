const fs = require('fs');
const path = require('path');

const imgPath1 = path.join(__dirname, '../src/logistica/img/logo_LAMDA_grande.png');
const imgPath2 = path.join(__dirname, '../src/app-etiquetas/img/logo_LAMDA.png');

const buf1 = fs.readFileSync(imgPath1);
console.log(`Dimensions of logo_LAMDA_grande.png: ${buf1.readInt32BE(16)}x${buf1.readInt32BE(20)}`);

if (fs.existsSync(imgPath2)) {
    const buf2 = fs.readFileSync(imgPath2);
    console.log(`Dimensions of logo_LAMDA.png: ${buf2.readInt32BE(16)}x${buf2.readInt32BE(20)}`);
}

