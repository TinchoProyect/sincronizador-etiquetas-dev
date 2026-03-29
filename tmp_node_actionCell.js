const fs = require('fs');
const html = fs.readFileSync('src/produccion/pages/gestion-mantenimiento.html', 'utf8');

const regex = /let actionCell =[\s\S]{0,1500}/g;
let match;
while ((match = regex.exec(html)) !== null) {
  const code = html.substring(match.index, match.index + 2500);
  fs.writeFileSync('tmp_diag_actionCell.txt', code);
  break; // Solo el primer loop de action Cell nos basta
}
