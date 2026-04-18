const fs = require('fs');
let js = fs.readFileSync('src/produccion/js/ingredientes.js', 'utf8');

const regexViejo = /<div class="tarjeta-stats">[\s\S]*?<div class="stat-item \$\{ingrediente\.stock_actual <= 0 \? 'stock-cero' : ''\}">[\s\S]*?<span class="stat-label">STOCK FÍSICO<\/span>[\s\S]*?<span class="stat-value">\$\{window\.formatearStock \? window\.formatearStock\(ingrediente\.stock_actual\) : ingrediente\.stock_actual\} <small>\$\{ingrediente\.unidad_medida\}<\/small><\/span>[\s\S]*?<\/div>[\s\S]*?<div class="stat-item">[\s\S]*?<span class="stat-label">STOCK POTENCIAL<\/span>[\s\S]*?<span class="stat-value">\$\{window\.formatearStock \? window\.formatearStock\(ingrediente\.stock_potencial\) : ingrediente\.stock_potencial\} <small>\$\{ingrediente\.unidad_medida\}<\/small><\/span>[\s\S]*?<\/div>[\s\S]*?<\/div>/;

const newStyle = `<div class="tarjeta-stats" style="display: flex; flex-direction: column; gap: 0;">
                        <!-- STOCK FÍSICO: Mayor jerarquía, tamaño prominente, fuente gruesa y color principal (azul) -->
                        <div class="stat-item \${ingrediente.stock_actual <= 0 ? 'stock-cero' : ''}" style="margin-bottom: 2px;">
                            <span class="stat-label" style="font-size: 0.75rem; color: #64748b; font-weight: 700; letter-spacing: 0.5px;">STOCK FÍSICO</span>
                            <span class="stat-value" style="display: block; font-size: 2rem; font-weight: 900; color: \${ingrediente.stock_actual <= 0 ? '#ef4444' : '#2563eb'}; line-height: 1.1; margin-top: 2px;">
                                \${window.formatearStock ? window.formatearStock(ingrediente.stock_actual) : ingrediente.stock_actual} 
                                <small style="font-size: 1rem; font-weight: 600; color: #64748b;">\${ingrediente.unidad_medida}</small>
                            </span>
                        </div>
                        <!-- STOCK POTENCIAL: Marginal, tamaño miniatura, layout horizontal tenue, borde divisor sutil -->
                        <div class="stat-item" style="display: flex; align-items: center; justify-content: space-between; padding-top: 6px; margin-top: 8px; border-top: 1px dashed #cbd5e1;">
                            <span class="stat-label" style="font-size: 0.65rem; color: #94a3b8; font-weight: 600;">STOCK POTENCIAL</span>
                            <span class="stat-value" style="font-size: 0.8rem; font-weight: 500; color: #94a3b8;">
                                \${window.formatearStock ? window.formatearStock(ingrediente.stock_potencial) : ingrediente.stock_potencial} 
                                <small style="font-size: 0.65rem;">\${ingrediente.unidad_medida}</small>
                            </span>
                        </div>
                    </div>`;

if (js.match(regexViejo)) {
    js = js.replace(regexViejo, newStyle);
    fs.writeFileSync('src/produccion/js/ingredientes.js', js, 'utf8');
    console.log('UI/UX Cards aesthetics updated successfully.');
} else {
    console.log('Regex did not match.');
}
