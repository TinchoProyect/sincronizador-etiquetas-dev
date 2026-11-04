const fs = require('fs');
const path = require('path');

const srcIcon = path.join(__dirname, '../src/app-etiquetas/img/isotipo_L_LAMDA.png');

const targets = [
  path.join(__dirname, '../public/favicon.ico'),
  path.join(__dirname, '../src/app-etiquetas/favicon.ico'),
  path.join(__dirname, '../src/logistica/favicon.ico'),
  path.join(__dirname, '../src/presupuestos/favicon.ico'),
  path.join(__dirname, '../src/produccion/favicon.ico')
];

try {
  if (fs.existsSync(srcIcon)) {
    console.log(`🔍 Icono origen encontrado: ${srcIcon}`);
    
    targets.forEach(target => {
      // Intentar eliminar si existe y luego copiar
      if (fs.existsSync(target)) {
        fs.unlinkSync(target);
      }
      fs.copyFileSync(srcIcon, target);
      console.log(`✅ Favicon reemplazado en: ${target}`);
    });
    
    console.log('🎉 Todos los favicons locales fueron actualizados con éxito.');
  } else {
    console.error(`❌ Icono origen NO encontrado en: ${srcIcon}`);
  }
} catch (err) {
  console.error('💥 Error actualizando favicons:', err);
}
