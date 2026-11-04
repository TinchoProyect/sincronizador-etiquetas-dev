const fs = require('fs');
const path = require('path');
const { createCanvas, loadImage } = require('canvas');
const jsQR = require('jsqr'); // O decodificador con canvas

async function decodeQrImage() {
    console.log('================================================================================');
    console.log('🔬 AUDITORÍA FÍSICA: DECODIFICACIÓN DEL QR EN LA FOTO SUBIDA POR EL USUARIO');
    console.log('================================================================================\n');

    try {
        // Buscar la imagen más reciente en .user_uploaded o tempmediaStorage
        const brainDir = path.resolve(__dirname, '../../../../.system_generated');
        const userUploadedDir = path.resolve(__dirname, '../../../../.user_uploaded');
        
        const mediaDirs = [
            'C:\\Users\\Martin\\.gemini\\antigravity\\brain\\tempmediaStorage',
            'C:\\Users\\Martin\\.gemini\\antigravity\\brain\\61490487-6902-4d79-af22-adae4a2011c5\\.user_uploaded'
        ];

        let targetImgPath = null;
        let latestTime = 0;

        for (const dir of mediaDirs) {
            if (fs.existsSync(dir)) {
                const files = fs.readdirSync(dir);
                for (const f of files) {
                    if (f.endsWith('.jpg') || f.endsWith('.png')) {
                        const fullP = path.join(dir, f);
                        const stat = fs.statSync(fullP);
                        if (stat.mtimeMs > latestTime) {
                            latestTime = stat.mtimeMs;
                            targetImgPath = fullP;
                        }
                    }
                }
            }
        }

        console.log(`1. Imagen física analizada: ${targetImgPath}`);

        if (!targetImgPath) {
            console.error('❌ No se encontró la imagen subida.');
            process.exit(1);
        }

        const image = await loadImage(targetImgPath);
        const canvas = createCanvas(image.width, image.height);
        const ctx = canvas.getContext('2d');
        ctx.drawImage(image, 0, 0);

        const imageData = ctx.getImageData(0, 0, image.width, image.height);
        
        // Usar jsqr o decodificar pixeles
        let jsqrLib;
        try {
            jsqrLib = require('jsqr');
        } catch (e) {
            // Si jsqr no está, probar con zxing
        }

        if (jsqrLib) {
            const code = jsqrLib(imageData.data, imageData.width, imageData.height);
            if (code) {
                console.log(`\n🎯 CONTENIDO EXACTO EXTRAÍDO DEL QR:\n"${code.data}"\n`);
            } else {
                console.log('⚠️ jsQR no pudo leer directamente, intentando recorte o escala...');
            }
        } else {
            console.log('jsqr no disponible.');
        }

        process.exit(0);
    } catch (e) {
        console.error('❌ Error en decodificación:', e);
        process.exit(1);
    }
}

decodeQrImage();
