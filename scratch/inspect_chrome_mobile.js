const path = require('path');
const http = require('http');
const { execSync } = require('child_process');

async function inspectChrome() {
  const adbPath = path.join(__dirname, 'platform-tools', 'adb.exe');
  
  console.log('🔗 Estableciendo reenvío de puerto 9222 con Chrome en el S22 Ultra...');
  execSync(`"${adbPath}" forward tcp:9222 localabstract:chrome_devtools_remote`);

  console.log('🔍 Consultando pestañas y procesos web abiertos en Chrome del celular...');
  
  http.get('http://localhost:9222/json', (res) => {
    let raw = '';
    res.on('data', chunk => raw += chunk);
    res.on('end', () => {
      try {
        const pages = JSON.parse(raw);
        console.log(`📱 Se encontraron ${pages.length} procesos/pestañas abiertas en el celular:`);
        pages.forEach((p, idx) => {
          console.log(`\n--- [${idx + 1}] ${p.title || 'Sin Título'} ---`);
          console.log(`   URL: ${p.url}`);
          console.log(`   Type: ${p.type}`);
          console.log(`   WebSocket Inspector: ${p.webSocketDebuggerUrl}`);
        });
      } catch (err) {
        console.error('❌ Error parseando JSON:', err.message, raw);
      }
    });
  }).on('error', (err) => {
    console.error('❌ Error conectando a Chrome DevTools:', err.message);
  });
}

inspectChrome();
