const fs = require('fs');
const path = require('path');

const srcIcon = path.join(__dirname, '../src/app-etiquetas/img/isotipo_L_LAMDA.png');
const destFavicon = path.join(__dirname, '../src/facturacion/favicon.ico');

try {
  if (fs.existsSync(srcIcon)) {
    if (fs.existsSync(destFavicon)) {
      fs.unlinkSync(destFavicon);
    }
    fs.copyFileSync(srcIcon, destFavicon);
    console.log(`✅ Favicon copiado con éxito en facturacion: ${destFavicon}`);
  } else {
    console.error(`❌ Icono origen NO encontrado en: ${srcIcon}`);
  }
} catch (err) {
  console.error('💥 Error:', err);
}
