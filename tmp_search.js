const fs = require('fs');
const path = require('path');

function walkDir(dir, callback) {
  fs.readdirSync(dir).forEach(f => {
    let dirPath = path.join(dir, f);
    let isDirectory = fs.statSync(dirPath).isDirectory();
    isDirectory ? walkDir(dirPath, callback) : callback(path.join(dir, f));
  });
}

walkDir('./src', function(filePath) {
  if(filePath.endsWith('.html') || filePath.endsWith('.js')) {
    const data = fs.readFileSync(filePath, 'utf8');
    if(data.toLowerCase().includes('esperando reparto')) {
      console.log('Encontrado en:', filePath);
    }
    if(data.toLowerCase().includes('avellana arrollada')) {
        console.log('Avellana hardcodeada en:', filePath);
    }
  }
});
