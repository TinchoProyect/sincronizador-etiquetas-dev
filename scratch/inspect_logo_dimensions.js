const { loadImage } = require('canvas');
const path = require('path');

async function inspect() {
    try {
        const logoPath = path.join(__dirname, '../src/logistica/img/logo_LAMDA_grande.png');
        const image = await loadImage(logoPath);
        console.log(`Ancho: ${image.width}, Alto: ${image.height}`);
    } catch (err) {
        console.error(err);
    }
}
inspect();
