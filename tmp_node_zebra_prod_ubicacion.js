const fs = require('fs');
const path = require('path');

function searchFiles(dir, term, found = []) {
    if (!fs.existsSync(dir)) return found;
    let files = fs.readdirSync(dir);
    for (let f of files) {
        let fullPath = path.join(dir, f);
        if (fs.statSync(fullPath).isDirectory()) {
            searchFiles(fullPath, term, found);
        } else {
            if (f.endsWith('.js') || f.endsWith('.html')) {
                let content = fs.readFileSync(fullPath, 'utf8');
                if (content.includes(term)) {
                    found.push(fullPath);
                }
            }
        }
    }
    return found;
}

let result = searchFiles('src/produccion', '/imprimir');
fs.writeFileSync('tmp_diag_zebra_prod_ubicacion.txt', result.join('\n'));
