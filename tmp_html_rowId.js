const fs = require('fs');
const html = fs.readFileSync('src/produccion/pages/gestion-mantenimiento.html', 'utf8');

const regex = /rowId[\s\S]{0,100}/g;
let match;
const shown = [];
while ((match = regex.exec(html)) !== null) {
  const code = html.substring(Math.max(0, match.index - 50), match.index + 150).trim();
  if (!shown.includes(code)) {
    console.log(code);
    shown.push(code);
  }
}
