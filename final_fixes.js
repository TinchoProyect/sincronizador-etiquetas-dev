const fs = require('fs');

// 1. Modificar html: Collapse accordion and add resize persistence
let htmlFile = 'src/produccion/pages/ingredientes.html';
let html = fs.readFileSync(htmlFile, 'utf8');

// Accordion collapse
html = html.replace(/<div class="accordion-header"\s*onclick="toggleAccordion\('sectores-depositos'\)">/, '<div class="accordion-header collapsed" onclick="toggleAccordion(\'sectores-depositos\')">');
html = html.replace(/<div class="accordion-content"\s*id="sectores-depositos">/, '<div class="accordion-content collapsed" id="sectores-depositos">');

// Resizer logic replacement
const resizerOld = /const resizer = document\.getElementById\('panel-resizer'\);[\s\S]*?resizer\.classList\.remove\('resizing'\);\s*document\.body\.style\.cursor = '';\s*document\.body\.style\.userSelect = '';\s*\}\s*\}\);\s*\}\);/;

const resizerNew = `const resizer = document.getElementById('panel-resizer');
            const panel = document.getElementById('panel-config');
            let isResizing = false;

            // Load saved width
            const savedWidth = localStorage.getItem('lamda_panel_width');
            if (savedWidth && panel) {
                panel.style.width = savedWidth;
            }

            resizer.addEventListener('mousedown', (e) => {
                isResizing = true;
                resizer.classList.add('resizing');
                document.body.style.cursor = 'col-resize';
                document.body.style.userSelect = 'none';
            });

            document.addEventListener('mousemove', (e) => {
                if (!isResizing) return;

                const newWidth = e.clientX;
                if (newWidth >= 250 && newWidth <= 600) {
                    panel.style.width = newWidth + 'px';
                }
            });

            document.addEventListener('mouseup', () => {
                if (isResizing) {
                    isResizing = false;
                    resizer.classList.remove('resizing');
                    document.body.style.cursor = '';
                    document.body.style.userSelect = '';
                    if (panel.style.width) {
                        localStorage.setItem('lamda_panel_width', panel.style.width);
                    }
                }
            });
        });`;

if (resizerOld.test(html)) {
    html = html.replace(resizerOld, resizerNew);
} else {
    console.log("Could not find resizer regex in HTML");
}
fs.writeFileSync(htmlFile, html, 'utf8');


// 2. Modificar CSS para el fondo
let cssFile = 'src/produccion/css/ingredientes-panel.css';
let css = fs.readFileSync(cssFile, 'utf8');
css = css.replace(/background:\s*#[^;]+;(?=\s*\n\s*backdrop-filter:\s*none;\s*\n\s*border:\s*1px solid #d1d5db;)/, 'background: #e3f2fd;');

// Añadir :hover oscuro y estilos para la nueva badge sector
if (!css.includes('.badge-sector-clickable')) {
    css += `\n.badge-sector-clickable {
    background: #ffeb3b; 
    color: #333; 
    cursor: pointer; 
    transition: all 0.2s; 
    border: 1px solid #fbc02d;
    box-shadow: 0 1px 2px rgba(0,0,0,0.1);
}
.badge-sector-clickable:hover {
    background: #fdd835;
    transform: translateY(-1px);
    box-shadow: 0 2px 4px rgba(0,0,0,0.15);
}`;
}
fs.writeFileSync(cssFile, css, 'utf8');


// 3. Modificar JS
let jsFile = 'src/produccion/js/ingredientes.js';
let js = fs.readFileSync(jsFile, 'utf8');

// Eliminar el gear button viejo del header // Añadir botón discreto...
const gearRegex = /\/\/ Añadir botón discreto de engranaje[\s\S]*?if\s*\(containerSelector\)\s*containerSelector\.remove\(\);/;

const selectorNuevo = `
                // Cleanup old container si existe por legacy
                const containerSelector = card.querySelector('.sector-cell-container');
                if (containerSelector) containerSelector.remove();

                const badgesContainer = card.querySelector('.tarjeta-badges');
                if (badgesContainer) {
                    const letra = (window.obtenerLetraSector) ? window.obtenerLetraSector(ingrediente.sector_id) : '?';
                    const editSectorBadge = document.createElement('span');
                    editSectorBadge.innerHTML = \`📍 Sec. \${letra || '?'} ⚙️\`;
                    editSectorBadge.className = 'badge-sutil badge-sector-clickable';
                    editSectorBadge.title = 'Reasignar Sector';
                    editSectorBadge.onclick = () => window.abrirModalCambioSector(ingrediente.id, ingrediente.sector_id, ingrediente.nombre);
                    badgesContainer.appendChild(editSectorBadge);
                }
`;

if (gearRegex.test(js)) {
    js = js.replace(gearRegex, selectorNuevo);
} else {
    console.log("Could not find gear button regex in JS");
}
fs.writeFileSync(jsFile, js, 'utf8');
console.log('Script aplicado a HTML, CSS y JS exitosamente.');
