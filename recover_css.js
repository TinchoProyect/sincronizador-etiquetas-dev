const fs = require('fs');

let css = fs.readFileSync('src/produccion/css/ingredientes-panel.css', 'utf8');
const script = fs.readFileSync('fix_css.js', 'utf8');

const anchorStart = '/* ============================================\r\n * TABLA DE INGREDIENTES';

// The original table block start index
const sIdx = css.indexOf('/* ============================================\r\n * TABLA DE INGREDIENTES');
const _sIdx = css.indexOf('/* ============================================\n * TABLA DE INGREDIENTES');
const trueStart = sIdx !== -1 ? sIdx : _sIdx;

const eIdx = css.indexOf('/* ============================================\r\n * RESPONSIVE');
const _eIdx = css.indexOf('/* ============================================\n * RESPONSIVE');
const trueEnd = eIdx !== -1 ? eIdx : _eIdx;

if (trueStart !== -1 && trueEnd !== -1) {
    const match = script.match(/const newCss = `([\s\S]*?)`;/);
    if(match) {
        let newCss = match[1];
        const finalCss = css.substring(0, trueStart) + newCss + '\n\n' + css.substring(trueEnd);
        fs.writeFileSync('src/produccion/css/ingredientes-panel.css', finalCss, 'utf8');
        console.log('Successfully injected CSS cards from fix_css.js!');
    } else {
        console.log('Could not find newCss block in fix_css.js');
    }
} else {
    console.log('Could not find trueStart or trueEnd in css', trueStart, trueEnd);
}
