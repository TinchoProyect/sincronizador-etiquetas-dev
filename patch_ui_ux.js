const fs = require('fs');

let fileHTML = fs.readFileSync('src/produccion/pages/ingredientes.html', 'utf8');

// Fixing close button and inputs
const searchWrapper = `                    <div class="input-ingrediente-wrapper" style="flex: 1; position: relative;">
                        <input type="text" id="buscar-ingrediente-mix" placeholder="Buscar ingrediente..." autocomplete="off" style="width: 100%; border: 1px solid #cbd5e1; border-radius: 8px; padding: 12px; font-size: 1rem; box-sizing: border-box;">
                        <ul id="lista-resultados-mix" class="lista-resultados-mix" style="display: none; position: absolute; top: calc(100% + 5px); left: 0; width: 100%; max-height: 250px; overflow-y: auto; background: white; border: 1px solid #cbd5e1; border-radius: 8px; box-shadow: 0 10px 15px -3px rgba(0,0,0,0.1); padding: 5px; box-sizing: border-box; z-index: 1000; list-style: none; margin: 0;"></ul>
                    </div>
                    <input type="number" id="cantidad-ingrediente-mix" placeholder="Kilos" step="0.001" min="0.001" style="width: 120px; border: 1px solid #cbd5e1; border-radius: 8px; padding: 12px; font-size: 1rem; box-sizing: border-box; text-align: center;">`;

fileHTML = fileHTML.replace(/<div class="input-ingrediente-wrapper"[^>]*>[\s\S]*?<input type="number"[^>]*id="cantidad-ingrediente-mix"[^>]*>/, searchWrapper);

// Modifying the header and modal content
const oldHeader = `<div class="modal-content" style="max-width: 600px; border-radius: 12px; border: 1px solid #e2e8f0; box-shadow: 0 10px 25px -5px rgba(0,0,0,0.1), 0 8px 10px -6px rgba(0,0,0,0.1);">
                <div class="modal-header" style="border-bottom: 2px solid #f1f5f9; padding-bottom: 15px; margin-bottom: 20px;">
                    <h5 id="modal-mix-titulo" style="font-weight: 800; color: #1e293b; font-size: 1.5rem; margin: 0;">Composición de Fórmula</h5>
                    <span class="close-modal" style="font-size: 1.5rem; color: #94a3b8; cursor: pointer;">&times;</span>
                </div>`;

const newHeader = `<div class="modal-content" style="position: relative; max-width: 600px; border-radius: 12px; border: 1px solid #e2e8f0; box-shadow: 0 10px 25px -5px rgba(0,0,0,0.1), 0 8px 10px -6px rgba(0,0,0,0.1);">
                <span class="close-modal" style="position: absolute; top: 15px; right: 20px; font-size: 1.8rem; color: #64748b; cursor: pointer; line-height: 1; transition: color 0.2s;" onmouseover="this.style.color='#ef4444';" onmouseout="this.style.color='#64748b';">&times;</span>
                <div class="modal-header" style="border-bottom: 2px solid #f1f5f9; padding-bottom: 15px; margin-bottom: 20px; padding-right: 30px;">
                    <h5 id="modal-mix-titulo" style="font-weight: 800; color: #1e293b; font-size: 1.5rem; margin: 0;">Composición de Fórmula</h5>
                </div>`;

fileHTML = fileHTML.replace(oldHeader, newHeader);

// Force cursor:default on title/header
fileHTML = fileHTML.replace('class="modal modal-new-ui"', 'class="modal modal-new-ui" style="cursor: default;"');

fs.writeFileSync('src/produccion/pages/ingredientes.html', fileHTML, 'utf8');

// --------
// Mix.js
let mixJS = fs.readFileSync('src/produccion/js/mix.js', 'utf8');

// Remove window.onclick handling Backdrop click
const blurHandlerRegex = /window\.onclick = \(event\) => \{[\s|]*?if \(event\.target === modal\) modal\.style\.display = 'none';[\s|]*?\};/g;
mixJS = mixJS.replace(blurHandlerRegex, "");

// Style li rows 
const oldLi = `            li.textContent = \`\${ing.nombre} - Stock: \${stock}\${sectorDisplay}\`;`;
const newLi = `            li.textContent = \`\${ing.nombre} - Stock: \${stock}\${sectorDisplay}\`;
            li.style.padding = '10px 15px';
            li.style.borderBottom = '1px solid #f1f5f9';
            li.style.cursor = 'pointer';
            li.style.borderRadius = '6px';
            li.style.transition = 'background 0.2s';
            li.onmouseover = () => { li.style.background = '#f8fafc'; li.style.color = '#2563eb'; li.style.fontWeight = '600'; };
            li.onmouseout = () => { li.style.background = 'transparent'; li.style.color = '#1e293b'; li.style.fontWeight = '400'; };`;
mixJS = mixJS.replace(oldLi, newLi);

// Fix no results style
const oldNoResults = `        listaResultados.innerHTML = '<li>No se encontraron ingredientes</li>';`;
const newNoResults = `        listaResultados.innerHTML = '<li style="padding: 10px 15px; color: #94a3b8; font-style: italic; text-align: center;">No se encontraron ingredientes</li>';`;
mixJS = mixJS.replace(oldNoResults, newNoResults);

fs.writeFileSync('src/produccion/js/mix.js', mixJS, 'utf8');
console.log('UI/UX Refinements complete');
