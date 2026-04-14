const fs = require('fs');

// DASHBOARD
let dash = fs.readFileSync('src/logistica/js/dashboard.js', 'utf8');

// The replacement for dashboard.js (pedidos pool)
dash = dash.replace(
    /\$\{esRetiro \? `<button onclick="event\.stopPropagation\(\); window\.descartarRetiro/g,
    `\${esRetiro && pedido.tiene_checkin ? \`<button onclick="event.stopPropagation(); window.open(\\\`\${API_BASE_URL || ''}/api/logistica/tratamientos/print/\${pedido.hash}\\\`, '_blank')" class="btn-sm" style="padding: 2px 6px; font-size: 0.75rem; background-color: #2563eb; color:white; border:none; border-radius:3px; cursor:pointer; margin-right: 2px;" title="Ver Reporte PDF">🖨️ PDF</button>\` : ''}
                        \${esRetiro ? \`<button onclick="event.stopPropagation(); window.descartarRetiro`
);

// The replacement for dashboard.js (rutas)
dash = dash.replace(
    /\$\{esRetiroDentro \? `<button(.*?)onclick="event\.stopPropagation\(\); window\.descartarRetiro/g,
    `\${esRetiroDentro && p.tiene_checkin ? \`<button onclick="event.stopPropagation(); window.open(\\\`\${API_BASE_URL || ''}/api/logistica/tratamientos/print/\${p.hash}\\\`, '_blank')" style="background-color: #2563eb; padding: 0.1rem 0.3rem; font-size: 0.7rem; color: white; border: none; border-radius: 0.25rem; cursor: pointer; margin-right: 2px;" title="Ver Reporte PDF">🖨️ PDF</button>\` : ''}
                                        \${esRetiroDentro ? \`<button$1onclick="event.stopPropagation(); window.descartarRetiro`
);

fs.writeFileSync('src/logistica/js/dashboard.js', dash);


// RUTA ACTIVA (MOBILE)
let mob = fs.readFileSync('src/logistica/public/mobile/js/controllers/RutaActivaUI.js', 'utf8');

// The replacement in renderPedidosHibridos (where the edit button is rendered)
const mobSearch = /\<button class="btn-primary" onclick="abrirModalContingencia\('\\$\{\w+\.hash\}', true\)">\s*<span class="icon">✏️<\/span> Modificar\s*<\/button>/g;

mob = mob.replace(mobSearch, match => {
    // Extract the hash variable from the match (either pedido.hash or p.hash)
    const hashVarMatch = match.match(/\$\{(\w+\.hash)\}/);
    const hashVar = hashVarMatch ? hashVarMatch[1] : 'pedido.hash';
    return `${match}
                            <button class="btn-secondary" onclick="window.open(\`\${API_BASE_URL || ''}/api/logistica/tratamientos/print/\${${hashVar}}\`, '_blank')" style="background: #2563eb; color: white; margin-left: 5px;">
                                <span class="icon">🖨️</span> PDF
                            </button>`;
});

fs.writeFileSync('src/logistica/public/mobile/js/controllers/RutaActivaUI.js', mob);

console.log('PDF buttons injected in Desktop and Mobile UI.');
