const fs = require('fs');
const path = require('path');
const { createCanvas, loadImage } = require('canvas');

async function crop() {
    try {
        const logoPath = path.join(__dirname, '../src/logistica/img/logo_LAMDA_grande.png');
        const outputPathLogistica = path.join(__dirname, '../src/logistica/img/isotipo_L_LAMDA.png');
        const outputPathFacturacion = path.join(__dirname, '../src/facturacion/img/isotipo_L_LAMDA.png');
        const outputPathAppEtiquetas = path.join(__dirname, '../src/app-etiquetas/img/isotipo_L_LAMDA.png');

        console.log(`Cargando logo original desde: ${logoPath}`);
        const image = await loadImage(logoPath);
        
        // Creamos un canvas cuadrado de 268x268 (la altura del logo original)
        const size = 268;
        const canvas = createCanvas(size, size);
        const ctx = canvas.getContext('2d');
        
        // Dibujamos la imagen original en el canvas desplazada 0px
        // Dado que la "L" está a la izquierda, dibujamos la imagen entera comenzando en 0, 0
        ctx.drawImage(image, 0, 0, 1024, 268);
        
        // Guardamos a buffer y escribimos a los archivos
        const buffer = canvas.toBuffer('image/png');
        
        fs.writeFileSync(outputPathLogistica, buffer);
        console.log(`✅ Isotipo guardado en Logística: ${outputPathLogistica}`);
        
        fs.writeFileSync(outputPathFacturacion, buffer);
        console.log(`✅ Isotipo guardado en Facturación: ${outputPathFacturacion}`);

        fs.writeFileSync(outputPathAppEtiquetas, buffer);
        console.log(`✅ Isotipo guardado en App Etiquetas: ${outputPathAppEtiquetas}`);
        
    } catch (err) {
        console.error("Error recortando imagen:", err);
    }
}

crop();
