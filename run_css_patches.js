const fs = require('fs');

let cssFile = 'src/produccion/css/ingredientes-panel.css';
let css = fs.readFileSync(cssFile, 'utf8');

// From fix_bug_css.js
const oldTarjeta = /\.tarjeta-ingrediente\s*\{[\s\S]*?border-radius:\s*8px;/;
const newTarjeta = `.tarjeta-ingrediente {
    background: #ffffff;
    backdrop-filter: blur(10px); /* fallback removed later */
    border: 1px solid rgba(255, 255, 255, 0.4);
    border-radius: 8px;`;

if(oldTarjeta.test(css)) {
    css = css.replace(oldTarjeta, newTarjeta);
}

// From fix_css_cards_style.js
const oldTarjetaRegex = /\.tarjeta-ingrediente\s*\{[\s\S]*?box-shadow:\s*[^;]*;/;
const newTarjetaDef = `.tarjeta-ingrediente {
    background: #ffffff;
    backdrop-filter: none;
    border: 1px solid #d1d5db;
    border-left: 4px solid #475569;
    border-radius: 8px;
    padding: 16px 18px;
    box-shadow: 0 2px 4px rgba(0, 0, 0, 0.05);`;
css = css.replace(oldTarjetaRegex, newTarjetaDef);

const hoverRegex = /\.tarjeta-ingrediente:hover\s*\{/;
const nthChildRules = `
.tarjeta-ingrediente:nth-child(even) {
    background: #f8fafc;
}

.tarjeta-ingrediente:hover {`;
css = css.replace(hoverRegex, nthChildRules);

// From final_fixes.js
css = css.replace(/\.ingredientes-container\s*\{[\s\S]*?\}/, `.ingredientes-container {
    display: flex;
    height: calc(100vh - 120px);
    gap: 0;
    margin: 0;
    padding: 0;
    background: #f1f5f9;
}`);
css = css.replace(/\.sector-group-header h3\s*\{/, `.sector-group-header h3 {
    margin: 0;
    font-size: 1.1rem;
    color: #334155;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.5px;`);

// From ux_fix_final.js
css = css.replace(/background:\s*#e3f2fd;/, 'background: #f5f6fa;');
const yellowBadgeRegex = /\.badge-sector-clickable\s*\{[\s\S]*?\}\s*\.badge-sector-clickable:hover\s*\{[\s\S]*?\}/;
if (yellowBadgeRegex.test(css)) {
    css = css.replace(yellowBadgeRegex, '');
}

// From apply_fixes.js
const classList = 'body.modo-impresion-cartel .container,\n    body.modo-impresion-cartel .ingredientes-container,\n    body.modo-impresion-cartel header,\n    body.modo-impresion-cartel footer,';
css = css.replace(/body\.modo-impresion-cartel \.app-container,/, classList);

fs.writeFileSync(cssFile, css, 'utf8');
console.log('Finished applying all CSS patches successfully!');
