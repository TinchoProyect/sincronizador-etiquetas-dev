const fs = require('fs');

function fixAPIUrl(filePath) {
    let js = fs.readFileSync(filePath, 'utf8');
    js = js.replace(/\$\{API_BASE_URL \|\| ''\}/g, '');
    fs.writeFileSync(filePath, js);
    console.log('Fixed API_BASE_URL in:', filePath);
}

fixAPIUrl('src/logistica/js/dashboard.js');
fixAPIUrl('src/logistica/public/mobile/js/controllers/RutaActivaUI.js');
