const fs = require('fs');
const code = fs.readFileSync('src/produccion/controllers/mantenimiento.js', 'utf8');

const regex = /async function ([a-zA-Z0-9_]+)\(req/g;
let match;
console.log("=== FUNCIONES ===");
while((match = regex.exec(code)) !== null) {
  if (match[1].toLowerCase().includes("final") || match[1].toLowerCase().includes("trata")) {
     console.log(match[1]);
  }
}
