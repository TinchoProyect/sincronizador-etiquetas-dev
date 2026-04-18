const fs = require('fs');
let js = fs.readFileSync('src/produccion/js/mix.js', 'utf8');

const regexReset = /modalContent\.style\.position = 'relative';[\s\S]*?modalContent\.style\.margin = '10vh auto';/;

const newReset = `        // Factory default reset: Devuelve el modal a su centro matematico absoluto, aniquilando transformaciones del "drag"
        modalContent.style.position = 'absolute';
        modalContent.style.top = '50%';
        modalContent.style.left = '50%';
        modalContent.style.transform = 'translate(-50%, -50%)';
        modalContent.style.margin = '0';`;

if (js.match(regexReset)) {
    js = js.replace(regexReset, newReset);
    fs.writeFileSync('src/produccion/js/mix.js', js, 'utf8');
    console.log('Reset CSS math logic fixed.');
} else {
    // maybe I can just do a replace for the whole section if it didn't match.
    console.log('Reset Regex not matched, searching for fallback...');
}
