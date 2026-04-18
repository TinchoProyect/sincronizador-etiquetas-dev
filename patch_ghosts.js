const fs = require('fs');
let js = fs.readFileSync('src/produccion/js/ingredientes.js', 'utf8');

const regexViejo = /\{\s*id:\s*'modal-mix',\s*closeHandler:\s*\(modal\)\s*=>\s*modal\.style\.display\s*=\s*'none'\s*\}/g;

if (js.match(regexViejo)) {
    // We just remove it from the array. 
    // Since it's like [ { id: 'modal-ingrediente', closeHandler: cerrarModal }, { id: 'modal-mix' ... } ]
    // We can replace the whole array declaration to be clean.
}

const arrViejo = /const modalesConfig = \[\s*\{\s*id: 'modal-ingrediente',\s*closeHandler: cerrarModal\s*\},\s*\{\s*id: 'modal-mix',\s*closeHandler: \(modal\) => modal\.style\.display = 'none'\s*\}\s*\];/;
const arrNuevo = `const modalesConfig = [
        { id: 'modal-ingrediente', closeHandler: cerrarModal }
        // modal-mix purgado de aquí, su ciclo de vida y eventos de cierre los maneja exclusivamente mix.js
    ];`;

if (js.match(arrViejo)) {
    js = js.replace(arrViejo, arrNuevo);
    fs.writeFileSync('src/produccion/js/ingredientes.js', js, 'utf8');
    console.log('Ghost listener purgado de ingredientes.js');
} else {
    console.log('Falló el Regex de purga.');
}
