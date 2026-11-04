const { loadImage, createCanvas } = require('canvas');
const path = require('path');

async function analyze() {
    try {
        const logoPath = path.join(__dirname, '../src/logistica/img/logo_LAMDA_grande.png');
        const image = await loadImage(logoPath);
        
        const canvas = createCanvas(image.width, image.height);
        const ctx = canvas.getContext('2d');
        ctx.drawImage(image, 0, 0);
        
        const imgData = ctx.getImageData(0, 0, image.width, image.height);
        const data = imgData.data;
        
        // Vamos a analizar cada columna x de 0 a 1024
        // Encontrar columnas que tengan píxeles no transparentes / no blancos
        const colActive = [];
        for (let x = 0; x < image.width; x++) {
            let hasContent = false;
            for (let y = 0; y < image.height; y++) {
                const idx = (y * image.width + x) * 4;
                const r = data[idx];
                const g = data[idx+1];
                const b = data[idx+2];
                const a = data[idx+3];
                
                // Si no es transparente y no es blanco puro (o casi blanco)
                if (a > 10 && !(r > 245 && g > 245 && b > 245)) {
                    hasContent = true;
                    break;
                }
            }
            colActive.push(hasContent);
        }
        
        // Busquemos el primer bloque de contenido (la "L") y el espacio vacío que le sigue
        let inBlock = false;
        let blocks = [];
        let currentBlock = null;
        
        for (let x = 0; x < image.width; x++) {
            if (colActive[x]) {
                if (!inBlock) {
                    inBlock = true;
                    currentBlock = { start: x };
                }
            } else {
                if (inBlock) {
                    inBlock = false;
                    currentBlock.end = x - 1;
                    blocks.push(currentBlock);
                }
            }
        }
        if (inBlock) {
            currentBlock.end = image.width - 1;
            blocks.push(currentBlock);
        }
        
        console.log("Bloques de contenido encontrados en el eje X:");
        console.log(blocks);
        
    } catch (err) {
        console.error(err);
    }
}

analyze();
