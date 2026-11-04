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
        
        // Creamos un canvas cuadrado de 268x268
        const size = 268;
        const canvas = createCanvas(size, size);
        const ctx = canvas.getContext('2d');
        
        // El isologo "L" está entre x = 0 y x = 187.
        // Vamos a tomar de 0 a 195 (para dar un pequeño margen de seguridad)
        const sWidth = 195;
        const sHeight = 268;
        
        // Para centrarlo horizontalmente en la caja de 268:
        const dx = Math.round((size - sWidth) / 2); // (268 - 195)/2 = 36.5 -> 37
        const dy = 0;
        
        ctx.drawImage(
            image,
            0, 0, sWidth, sHeight, // Origen
            dx, dy, sWidth, sHeight // Destino
        );
        
        // Guardamos a buffer y escribimos a los archivos
        const buffer = canvas.toBuffer('image/png');
        
        fs.writeFileSync(outputPathLogistica, buffer);
        console.log(`✅ Isotipo limpio guardado en Logística: ${outputPathLogistica}`);
        
        fs.writeFileSync(outputPathFacturacion, buffer);
        console.log(`✅ Isotipo limpio guardado en Facturación: ${outputPathFacturacion}`);

        fs.writeFileSync(outputPathAppEtiquetas, buffer);
        console.log(`✅ Isotipo limpio guardado en App Etiquetas: ${outputPathAppEtiquetas}`);
        
    } catch (err) {
        console.error("Error recortando imagen:", err);
    }
}

crop();
