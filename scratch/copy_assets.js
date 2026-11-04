const fs = require('fs');
const path = require('path');

const srcIcon = path.join(__dirname, '../src/app-etiquetas/img/isotipo_L_LAMDA.png');
const publicDir = path.join(__dirname, '../b2b-portal/public');

const targets = [
  'favicon.png',
  'icon-192.png',
  'icon-512.png',
  'logo_LAMDA.png'
];

try {
  if (fs.existsSync(srcIcon)) {
    console.log(`🔍 Icono origen encontrado en: ${srcIcon}`);
    
    // Asegurarse de que exista el directorio destino
    if (!fs.existsSync(publicDir)) {
      fs.mkdirSync(publicDir, { recursive: true });
    }

    targets.forEach(target => {
      const destPath = path.join(publicDir, target);
      fs.copyFileSync(srcIcon, destPath);
      console.log(`✅ Copiado a: ${destPath}`);
    });
  } else {
    console.error(`❌ Icono origen NO encontrado en: ${srcIcon}`);
  }
} catch (err) {
  console.error('💥 Error durante el copiado:', err);
}
