const fs = require('fs');
const path = require('path');

function walk(dir, fileList = []) {
  const files = fs.readdirSync(dir);
  files.forEach(file => {
    const filePath = path.join(dir, file);
    if (filePath.includes('node_modules') || filePath.includes('.git') || filePath.includes('.gemini') || filePath.includes('b2b-portal')) {
      return;
    }
    const stat = fs.statSync(filePath);
    if (stat.isDirectory()) {
      walk(filePath, fileList);
    } else {
      if (file.toLowerCase().endsWith('.html')) {
        fileList.push(filePath);
      }
    }
  });
  return fileList;
}

try {
  const root = path.join(__dirname, '..');
  console.log(`🔍 Escaneando archivos HTML en: ${root}`);
  const htmlFiles = walk(root);
  console.log(`📌 Encontrados ${htmlFiles.length} archivos HTML.`);

  let updatedCount = 0;

  htmlFiles.forEach(filePath => {
    let content = fs.readFileSync(filePath, 'utf8');
    let modified = false;

    // Caso 1: Tiene un link de favicon.ico, le agregamos el cache buster ?v=2
    const regexFavicon = /<link\s+[^>]*rel=["'](?:shortcut\s+)?icon["'][^>]*href=["']([^"']+)["'][^>]*>/gi;
    
    if (regexFavicon.test(content)) {
      // Reemplazar href con la versión con cache-buster
      content = content.replace(regexFavicon, (match, href) => {
        if (!href.includes('?v=')) {
          const separator = href.includes('?') ? '&' : '?';
          const newHref = `${href}${separator}v=2`;
          modified = true;
          return match.replace(href, newHref);
        }
        return match;
      });
    } else {
      // Caso 2: No tiene favicon (ej. loading.html). Lo insertamos debajo de <head>
      if (content.includes('<head>')) {
        // Calcular ruta relativa adecuada a src/app-etiquetas/favicon.ico
        let relativeFaviconPath = '';
        const dirName = path.dirname(filePath);
        if (dirName.endsWith('scripts')) {
          relativeFaviconPath = '../src/app-etiquetas/favicon.ico?v=2';
        } else {
          relativeFaviconPath = '/favicon.ico?v=2';
        }

        const tag = `\n  <link rel="icon" type="image/png" href="${relativeFaviconPath}" />`;
        content = content.replace('<head>', `<head>${tag}`);
        modified = true;
      }
    }

    if (modified) {
      fs.writeFileSync(filePath, content, 'utf8');
      console.log(`   - ✅ Archivo actualizado: ${filePath}`);
      updatedCount++;
    }
  });

  console.log(`🎉 Se actualizaron con éxito ${updatedCount} archivos HTML.`);
} catch (err) {
  console.error('💥 Error durante el proceso:', err);
}
