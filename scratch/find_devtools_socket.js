const path = require('path');
const { execSync } = require('child_process');

function findSockets() {
  const adbPath = path.join(__dirname, 'platform-tools', 'adb.exe');
  console.log('🔍 Buscando sockets de DevTools en el Moto G06...');
  
  const output = execSync(`"${adbPath}" shell cat /proc/net/unix`, { encoding: 'utf8' });
  const lines = output.split('\n').filter(line => line.includes('devtools_remote'));
  console.log('📋 Sockets DevTools encontrados:\n', lines);
}

findSockets();
