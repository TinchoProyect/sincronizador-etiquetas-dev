const fs = require('fs');
const FILE_PATH = 'src/produccion/pages/ingredientes.html';
let content = fs.readFileSync(FILE_PATH, 'utf8');

const tableStart = `<!-- Tabla de ingredientes -->`;
const tableEnd = `</table>`;
const idxStart = content.indexOf(tableStart);
const idxEnd = content.indexOf(tableEnd, idxStart) + tableEnd.length;

if(idxStart !== -1 && idxEnd !== -1) {
    const newDiv = `<!-- Contenedor de tarjetas de ingredientes -->
                        <div id="tarjetas-ingredientes-container" class="tarjetas-container">
                            <!-- Las tarjetas se cargarán dinámicamente aquí -->
                        </div>`;
    content = content.substring(0, idxStart) + newDiv + content.substring(idxEnd);
    fs.writeFileSync(FILE_PATH, content, 'utf8');
    console.log('Replaced table with div in HTML!');
} else {
    console.log('Table not found in HTML!');
}
