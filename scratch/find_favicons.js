const fs = require('fs');
const path = require('path');

function walk(dir, results = []) {
  const list = fs.readdirSync(dir);
  list.forEach(file => {
    const fullPath = path.join(dir, file);
    if (fullPath.includes('node_modules') || fullPath.includes('.git') || fullPath.includes('.gemini')) {
      return;
    }
    const stat = fs.statSync(fullPath);
    if (stat && stat.isDirectory()) {
      walk(fullPath, results);
    } else {
      if (file.toLowerCase() === 'favicon.ico') {
        results.push(fullPath);
      }
    }
  });
  return results;
}

try {
  const root = path.join(__dirname, '..');
  console.log(`🔍 Buscando todos los favicon.ico bajo: ${root}`);
  const favicons = walk(root);
  console.log(`📌 Encontrados ${favicons.length} archivos favicon.ico:`);
  favicons.forEach(f => console.log(`   - ${f}`));
} catch (err) {
  console.error('💥 Error:', err);
}
